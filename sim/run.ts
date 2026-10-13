/**
 * HSRP DMS on-screen simulator: runs the end-to-end test cases of docs/SIMULATION.md one by one in a real Chrome
 * window (one stacked window per role) and on the Android emulator (dealer app), with a visible cursor, a ripple
 * on every click and a caption for every step.
 *
 *   pnpm sim                      all cases, happy flows first
 *   pnpm sim --case TC-02,TC-08   only these cases
 *   pnpm sim --from TC-05         from TC-05 to the end
 *   pnpm sim --kind error         only the error flows
 *   pnpm sim --speed fast         slow | normal (default) | fast
 *   pnpm sim --pace 1.5           stretch every pause, cursor move and keystroke delay (1.5 = 50% slower)
 *   pnpm sim --manual             wait for a click on "Start" before each case
 *   pnpm sim --keep-open          leave the windows open at the end
 *   pnpm sim --list               print the run plan (cases and steps) and exit
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Api } from './core/api';
import { CONFIG, SPEEDS } from './core/config';
import { Phone } from './core/phone';
import type { Ctx, RunState, TestCase } from './core/types';
import { Web } from './core/web';
import { CASES } from './cases';
import { prepareData, showPreparedData, uploadOemFileQuietly } from './scenes/data';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const WHO: Record<string, string> = { admin: 'Operations / admin', station: 'Embossing station', dealer: 'Dealer (web)', phone: '📱 Dealer app on the phone', system: 'Simulator' };

function args() {
  const a = process.argv.slice(2);
  const val = (k: string) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    list: a.includes('--list'),
    manual: a.includes('--manual'),
    keepOpen: a.includes('--keep-open'),
    cases: val('--case')?.split(',').map((s) => s.trim().toUpperCase()),
    from: val('--from')?.toUpperCase(),
    kind: val('--kind') as 'happy' | 'error' | undefined,
    speed: (val('--speed') ?? 'normal') as keyof typeof SPEEDS,
    factor: Number(val('--pace') ?? 1),
  };
}

function select(o: ReturnType<typeof args>): TestCase[] {
  let list = CASES;
  if (o.cases) list = list.filter((c) => o.cases!.includes(c.id));
  if (o.from) list = list.slice(Math.max(0, list.findIndex((c) => c.id === o.from)));
  if (o.kind) list = list.filter((c) => c.kind === o.kind);
  return list;
}

function printPlan(list: TestCase[]) {
  console.log('\nD-00  Prepare test data (every run)');
  console.log(`      - ${showPreparedData.say}`);
  for (const c of list) {
    console.log(`\n${c.id}  [${c.kind}] ${c.title}`);
    console.log(`      ${c.goal}`);
    c.steps.forEach((s, i) => console.log(`      ${String(i + 1).padStart(2)}. (${WHO[s.who]}) ${s.say}`));
    console.log(`      Expected: ${c.expected.join(' · ')}`);
  }
  console.log('');
}

async function main() {
  const o = args();
  const list = select(o);
  if (!list.length) throw new Error('No test case matches the selection');
  if (o.list) return printPlan(list);
  if (!(o.factor > 0)) throw new Error('--pace must be a positive number, e.g. 1.5');
  const base = SPEEDS[o.speed] ?? SPEEDS.normal;
  const pace = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, Math.round(v * o.factor)])) as typeof base;

  const api = new Api();
  if (!(await api.health())) throw new Error(`API not reachable at ${CONFIG.apiUrl}: start hsrp-dms-be (docker compose up -d)`);
  const needsPhone = list.some((c) => c.steps.some((s) => s.who === 'phone'));
  const phone = new Phone(pace);
  if (needsPhone) await phone.init();
  const web = new Web(pace);
  await web.launch();

  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = join(CONFIG.outputDir, runId);
  mkdirSync(outDir, { recursive: true });
  const run: RunState = { id: runId, vehicles: {}, shared: {}, oemFileUploaded: false };
  const results: Array<{ id: string; title: string; kind: string; ok: boolean; seconds: number; note: string }> = [];
  const speedLabel = `${o.speed} speed${o.factor !== 1 ? ` × ${o.factor}` : ''}`;
  console.log(`Simulator run ${runId}: ${list.length} case(s) at ${speedLabel}`);

  try {
    // ---------------------------------------------------------------- D-00 data preparation
    await web.setCaption('D-00 · Prepare test data', 'Registering fresh fictional vehicles in mock VAHAN for every case of this run', WHO.system);
    await prepareData(api, list, run);
    await web.card({
      title: 'Prepare test data',
      badge: 'D-00 · SETUP',
      tone: '#475569',
      lines: [`${Object.keys(run.vehicles).length} new Kranti vehicles registered in mock VAHAN for this run`, 'Each case uses its own vehicle, so the run can be repeated any number of times'],
      foot: `${list.length} case(s) to run: ${list.map((c) => c.id).join(', ')}`,
      waitMs: pace.caseCard,
    });
    await web.setCaption('D-00 · Prepare test data', showPreparedData.say, WHO.admin);
    await showPreparedData.run({ web, phone, api, pace, run, data: {}, case: list[0], vehicle: () => { throw new Error('n/a'); }, say: async () => undefined, sleep });
    if (!list.some((c) => c.id === 'TC-01') && Object.keys(run.vehicles).length) await uploadOemFileQuietly(api, run);

    // ---------------------------------------------------------------- cases, one by one
    for (const [ci, tc] of list.entries()) {
      const started = Date.now();
      const tone = tc.kind === 'happy' ? '#15803d' : '#b91c1c';
      await web.card({
        title: `${tc.id} · ${tc.title}`,
        badge: `${tc.kind === 'happy' ? 'HAPPY FLOW' : 'ERROR FLOW'} · CASE ${ci + 1} OF ${list.length}`,
        tone,
        lines: [tc.goal, ...tc.expected.map((e) => `Expected: ${e}`)],
        foot: `${tc.steps.length} steps`,
        button: o.manual ? 'Start' : undefined,
        waitMs: o.manual ? 0 : pace.caseCard,
      });
      let currentStep = { i: 0, who: 'system' };
      const ctx: Ctx = {
        web,
        phone,
        api,
        pace,
        run,
        case: tc,
        data: {},
        sleep,
        vehicle(name) {
          const v = run.vehicles[`${tc.id}.${name}`];
          if (!v) throw new Error(`${tc.id} declares no vehicle "${name}"`);
          return v;
        },
        say: async (text) => {
          const cur = currentStep;
          await web.setCaption(`${tc.id} · step ${cur.i + 1} of ${tc.steps.length}`, text, WHO[cur.who]);
        },
      };
      let note = 'passed';
      let ok = true;
      for (const [i, step] of tc.steps.entries()) {
        currentStep = { i, who: step.who };
        process.stdout.write(`  ${tc.id} ${String(i + 1).padStart(2)}/${tc.steps.length} ${step.say} … `);
        await web.setCaption(`${tc.id} · step ${i + 1} of ${tc.steps.length}`, step.say, WHO[step.who]);
        try {
          await step.run(ctx);
          console.log('ok');
        } catch (e) {
          ok = false;
          note = `step ${i + 1} (${step.say}): ${(e as Error).message}`;
          console.log(`FAILED\n      ${(e as Error).message}`);
          await web.screenshot(join(outDir, `${tc.id}-web.png`));
          if (needsPhone) await phone.screenshot(join(outDir, `${tc.id}-phone.png`));
          break;
        }
      }
      // Never leave VAHAN down for the next case.
      await api.put('/simulator/vahan-mode', { mode: 'normal' }).catch(() => undefined);
      const seconds = Math.round((Date.now() - started) / 1000);
      results.push({ id: tc.id, title: tc.title, kind: tc.kind, ok, seconds, note: ok ? (ctx.data.orderNo ? `order ${ctx.data.orderNo}` : 'passed') : note });
      await web.setCaption(`${tc.id} · ${ok ? 'passed' : 'FAILED'}`, ok ? `${tc.title}: passed in ${seconds} s` : note, WHO.system);
      await web.card({
        title: `${tc.id} ${ok ? 'passed' : 'failed'}`,
        badge: ok ? 'PASSED' : 'FAILED',
        tone: ok ? '#15803d' : '#b91c1c',
        lines: [ok ? `${tc.title} (${seconds} s)` : note],
        waitMs: Math.round(pace.caseCard / 2),
      });
    }
  } finally {
    const passed = results.filter((r) => r.ok).length;
    const lines = [
      `# Simulator run ${runId}`,
      '',
      `${passed}/${results.length} cases passed at ${speedLabel}.`,
      '',
      '| Case | Kind | Title | Result | Time | Note |',
      '| --- | --- | --- | --- | --- | --- |',
      ...results.map((r) => `| ${r.id} | ${r.kind} | ${r.title} | ${r.ok ? 'passed' : '**failed**'} | ${r.seconds} s | ${r.note.replace(/\|/g, '/')} |`),
    ];
    writeFileSync(join(outDir, 'report.md'), lines.join('\n') + '\n');
    console.log(`\n${passed}/${results.length} cases passed. Report: ${join(outDir, 'report.md')}`);
    for (const r of results) console.log(`  ${r.ok ? '✔' : '✘'} ${r.id} ${r.title} (${r.seconds} s) ${r.ok ? '' : `— ${r.note}`}`);
    if (results.length) {
      await web
        .card({
          title: `Run finished: ${passed} of ${results.length} cases passed`,
          badge: 'SUMMARY',
          tone: passed === results.length ? '#15803d' : '#b91c1c',
          lines: results.map((r) => `${r.ok ? '✔' : '✘'} ${r.id} ${r.title}`),
          waitMs: o.keepOpen ? 1 : pace.caseCard * 2,
        })
        .catch(() => undefined);
    }
    if (!o.keepOpen) await web.close();
    await phone.close();
    process.exitCode = passed === results.length ? 0 : 1;
  }
}

main().catch((e) => {
  console.error(`Simulator: ${(e as Error).message}`);
  process.exit(1);
});
