/**
 * pnpm demo:e2e — runs acceptance flows A–L (handover section 8) against a running API.
 *   API_BASE_URL   default http://localhost:3000
 *   SEED_PASSWORD  read from the repo-root .env when not set
 * Re-runnable: each run uses fresh demo vehicles from the mock VAHAN table.
 */
import { createHmac, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const rootEnv = path.resolve(__dirname, '../../../.env');
if (!process.env.SEED_PASSWORD && fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const BASE = (process.env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = process.env.SEED_PASSWORD ?? '';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

// ------------------------------------------------------------------------------------------ helpers

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Res {
  status: number;
  body: Json;
  headers: Headers;
  text: string;
}

class Fail extends Error {}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Fail(msg);
}

async function call(method: string, url: string, opts: { token?: string; body?: unknown; form?: FormData | URLSearchParams; headers?: Record<string, string>; idem?: string; raw?: string; device?: string; redirect?: RequestRedirect } = {}): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  if (opts.device) headers['x-device-id'] = opts.device;
  let body: BodyInit | undefined;
  if (opts.raw !== undefined) {
    body = opts.raw;
    headers['content-type'] = 'application/json';
  } else if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(url.startsWith('http') ? url : `${BASE}${url}`, { method, headers, body, redirect: opts.redirect ?? 'follow' });
  const text = await res.text();
  let parsed: Json = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed, headers: res.headers, text };
}

async function ok(method: string, url: string, opts: Parameters<typeof call>[2] = {}, expect: number[] = [200, 201, 202]) {
  const r = await call(method, url, opts);
  assert(expect.includes(r.status), `${method} ${url} → ${r.status}: ${typeof r.body === 'object' ? JSON.stringify(r.body).slice(0, 400) : r.text.slice(0, 200)}`);
  return r.body;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
async function waitFor<T>(what: string, fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await fn();
    if (done(last)) return last;
    await sleep(400);
  } while (Date.now() < until);
  throw new Fail(`Timed out waiting for ${what} (last: ${JSON.stringify(last!).slice(0, 300)})`);
}

const tokens: Record<string, string> = {};
async function login(username: string, deviceId?: string) {
  const b = await ok('POST', '/api/v1/auth/login', { body: { username, password: PASSWORD, deviceId, deviceName: deviceId ? 'demo-e2e' : undefined } });
  tokens[username] = b.token;
  return b.token as string;
}

const DEVICE = 'e2e-android-emulator';
const as = (user: string) => ({ token: tokens[user], device: user.startsWith('dealer') ? DEVICE : undefined });
const order = (id: string, user = 'admin') => ok('GET', `/api/v1/orders/${id}`, as(user));
const waitStatus = (id: string, statuses: string[], user = 'admin', timeoutMs = 30_000) =>
  waitFor(`order ${id} → ${statuses.join('|')}`, () => order(id, user), (o) => statuses.includes(o.status), timeoutMs);

async function otpFor(mobile: string, sinceIso: string) {
  const msgs = await waitFor(
    `OTP SMS to ${mobile}`,
    () => ok('GET', `/api/v1/simulator/messages?to=${mobile}&channel=SMS`, as('admin')),
    (m: Json[]) => m.some((x) => /verification code/.test(x.body) && x.createdAt >= sinceIso),
  );
  return (msgs.find((x: Json) => /verification code/.test(x.body) && x.createdAt >= sinceIso).body as string).match(/^(\d{6})/)![1];
}

/** Places a dealer order on the first demo vehicle that has no open order and passes validation. */
async function dealerOrder(user: string, pool: string, state: string, extra: Record<string, unknown> = {}, want = ['CONFIRMED']) {
  const vehicles: Json[] = await ok('GET', `/api/v1/simulator/vahan-vehicles?scenario=${pool}&state=${state}`, as('admin'));
  // Skip vehicles an earlier run already plated (VAHAN shows laser codes), except for replacement demos.
  const usable = pool === 'demo-has-plates' ? vehicles : vehicles.filter((v) => !v.hsrpFrontLaserCode);
  for (const v of usable.reverse()) {
    const r = await call('POST', '/api/v1/orders', { ...as(user), idem: randomUUID(), body: { regnNo: v.regnNo, chassisNo: v.chassisNo, engineNo: v.engineNo, mobile: '9000099001', ...extra } });
    if (r.status === 409) continue;
    assert(r.status === 201, `create order → ${r.status} ${JSON.stringify(r.body)}`);
    const o = await waitStatus(r.body.id, [...want, 'REJECTED'], user);
    if (o.status === 'REJECTED') continue; // vehicle already used by an earlier run (VAHAN now shows plates)
    return { order: o, vehicle: v };
  }
  throw new Fail(`No usable ${pool} vehicle left in ${state}; reseed (SEED_RESET=true)`);
}

async function stationIssue(orderIds: string[], dealerId: string, stationId: string, user = 'station.kol') {
  const pending = await ok('GET', `/api/v1/station/issuance/pending?dealerId=${dealerId}`, as(user));
  for (const id of orderIds) assert(pending.orders.some((o: Json) => o.id === id), `order ${id} not in pending issuance`);
  const need = new Set<string>(pending.orders.filter((o: Json) => orderIds.includes(o.id)).flatMap((o: Json) => o.pendingPositions.map((p: string) => (p === 'FRONT' ? o.frontProductCode : o.rearProductCode))));
  const boxes: Json[] = await ok('GET', `/api/v1/inventory/boxes?status=OPEN`, as(user));
  const boxNos = [...need].map((code) => boxes.find((b) => b.productCode === code && b.available > 4)?.boxNo).filter(Boolean);
  assert(boxNos.length === need.size, `no open box for ${[...need].join(', ')}`);
  await ok('POST', '/api/v1/inventory/boxes/lock', { ...as(user), body: { stationId, boxNos } });
  const jc = await ok('POST', '/api/v1/station/issuance', { ...as(user), body: { stationId, dealerId, orderIds, boxNos } });
  const pdf = await call('GET', `/api/v1/station/job-cards/${jc.id}/pdf`, as(user));
  assert(pdf.status === 200 && pdf.text.startsWith('%PDF'), 'job card PDF');
  return jc;
}

async function qcPassAndSticker(orderId: string, user = 'station.kol') {
  await ok('POST', `/api/v1/station/qc/${orderId}`, { ...as(user), body: { result: 'PASS' } });
  const o = await order(orderId);
  if (o.status === 'QC_PASSED') {
    const r = await call('POST', `/api/v1/station/stickers/${orderId}/print`, { ...as(user), body: { reprint: false } });
    assert(r.status === 201 && r.text.startsWith('%PDF'), `sticker print → ${r.status}`);
  }
  return waitStatus(orderId, ['STICKER_PRINTED']);
}

async function challanFor(orderIds: string[], dealerId: string, stationId: string, user = 'station.kol') {
  const c = await ok('POST', '/api/v1/dispatch/challans', { ...as(user), body: { stationId, dealerId, orderIds } });
  const pdf = await call('GET', `/api/v1/dispatch/challans/${c.id}/pdf`, as(user));
  assert(pdf.status === 200 && pdf.text.startsWith('%PDF'), 'challan PDF');
  return c;
}

async function decideApprovalFor(subjectId: string, type: string, decision: 'APPROVE' | 'REJECT', user: string, remarks: string) {
  const list: Json[] = await waitFor(`${type} approval for ${subjectId}`, () => ok('GET', `/api/v1/approvals?type=${type}&status=PENDING`, as(user)), (l: Json[]) => l.some((a) => a.subjectId === subjectId || a.details?.orderId === subjectId));
  const a = list.find((x) => x.subjectId === subjectId || x.details?.orderId === subjectId);
  const noRemarks = await call('POST', `/api/v1/approvals/${a.id}/decision`, { ...as(user), body: { decision, remarks: '' } });
  assert(noRemarks.status === 400, 'decision without remarks must be refused');
  return ok('POST', `/api/v1/approvals/${a.id}/decision`, { ...as(user), body: { decision, remarks } });
}

async function fitment(orderId: string, user: string, idem = randomUUID()) {
  const o = await order(orderId, user);
  const found: Json[] = await ok('GET', `/api/v1/fitments/search?regnNo=${o.regnNo}`, as(user));
  const hit = found.find((x) => x.order.id === orderId);
  assert(hit?.canRecord, 'fitment search should offer the order');
  const fd = new FormData();
  fd.set('orderId', orderId);
  for (const a of hit.allocations) fd.set(a.position === 'FRONT' ? 'frontLaserCode' : 'rearLaserCode', a.laserCode);
  fd.set('fittedAt', new Date().toISOString());
  fd.set('front', new Blob([PNG], { type: 'image/png' }), 'front.png');
  fd.set('rear', new Blob([PNG], { type: 'image/png' }), 'rear.png');
  return { res: await call('POST', '/api/v1/fitments', { ...as(user), idem, form: fd }), idem, fd };
}

// ------------------------------------------------------------------------------------------ flows

const ctx: Record<string, Json> = {};
const results: Array<{ flow: string; ok: boolean; note: string; ms: number }> = [];
async function flow(name: string, fn: () => Promise<string>) {
  const t = Date.now();
  try {
    const note = await fn();
    results.push({ flow: name, ok: true, note, ms: Date.now() - t });
    console.log(`  ✔ ${name} — ${note}`);
  } catch (e) {
    results.push({ flow: name, ok: false, note: (e as Error).message, ms: Date.now() - t });
    console.log(`  ✘ ${name} — ${(e as Error).message}`);
  }
}

async function main() {
  console.log(`demo:e2e against ${BASE}`);
  if (!PASSWORD) throw new Error('SEED_PASSWORD is not set (put it in the repo-root .env)');
  const health = await ok('GET', '/api/v1/health');
  assert(health.worker, 'The API must run with WORKER_ENABLED=true');
  for (const u of ['admin', 'ops', 'station.kol', 'station.bbs']) await login(u);
  await login('dealer.wb01', DEVICE);
  await ok('PUT', '/api/v1/simulator/vahan-mode', { ...as('admin'), body: { mode: 'normal' } });
  const masters = { dealers: await ok('GET', '/api/v1/masters/dealers', as('admin')), stations: await ok('GET', '/api/v1/masters/stations', as('admin')) };
  const WB01 = masters.dealers.find((d: Json) => d.code === 'WB01');
  const KOL1 = masters.stations.find((s: Json) => s.code === 'KOL1');

  await flow('A. Dealer order (app)', async () => {
    const { order: o } = await dealerOrder('dealer.wb01', 'demo-new', 'WB');
    const detail = await ok('GET', `/api/v1/orders/${o.id}/detail`, as('admin'));
    const hold = (await ok('GET', `/api/v1/wallets/${WB01.walletAccountId}/holds`, as('admin'))).find((h: Json) => h.subjectId === o.id);
    assert(hold?.status === 'CAPTURED', `wallet hold should be CAPTURED, is ${hold?.status}`);
    assert(detail.history.map((h: Json) => h.toStatus).join('>') === 'RECEIVED>VALIDATED>CONFIRMED', 'status path');
    assert(detail.order.vahanSnapshot && detail.order.priceSnapshot, 'VAHAN and price snapshots on the order');
    ctx.A = o;
    return `${o.orderNo} CONFIRMED, ₹${(o.amountPaise / 100).toFixed(2)} held then captured from the shared wallet`;
  });

  await flow('B. OEM order by API', async () => {
    const [cred] = await ok('GET', '/api/v1/simulator/oem-credentials', as('admin'));
    const pool: Json[] = await ok('GET', '/api/v1/simulator/vahan-vehicles?scenario=oem-zenmo-sample&state=OD', as('admin'));
    for (const v of pool.filter((x) => !x.hsrpFrontLaserCode).reverse()) {
      const payload = { oemOrderRef: `E2E-${Date.now()}`, dealerCode: 'OD02', regnNo: v.regnNo, chassisNo: v.chassisNo, engineNo: v.engineNo, ownerName: 'E2E Owner', mobile: '9000099002' };
      const raw = JSON.stringify(payload);
      const key = randomUUID();
      const sig = createHmac('sha256', cred.secret).update(raw).digest('hex');
      const send = (k: string, s = sig, body = raw) => call('POST', `/api/v1/oem/${cred.oemCode}/orders`, { raw: body, idem: k, headers: { 'x-api-key': cred.apiKey, 'x-signature': s } });
      const first = await send(key);
      if (first.status === 409) continue;
      assert(first.status === 202, `push → ${first.status} ${JSON.stringify(first.body)}`);
      const again = await send(key);
      assert(again.status === 202 && again.body.orderId === first.body.orderId && again.headers.get('idempotent-replayed') === 'true', 'repeated push must replay, not duplicate');
      const otherKey = await send(randomUUID());
      assert(otherKey.status === 409 && otherKey.body.type.endsWith('duplicate-oem-order'), 'same OEM ref with a new key must be refused as duplicate');
      const badSig = await send(randomUUID(), 'ab'.repeat(32));
      assert(badSig.status === 401, 'bad signature must be refused');
      const o = await waitStatus(first.body.orderId, ['CONFIRMED', 'REJECTED']);
      if (o.status === 'REJECTED') continue;
      const steps = (await ok('GET', `/api/v1/orders/${o.id}/history`, as('admin'))).validations.map((x: Json) => x.step);
      assert(steps.includes('oem-catalogue-check') && steps.includes('vahan-check'), 'Zenmo orders run the catalogue check and VAHAN');
      const cb = await waitFor('OEM status callback', () => ok('GET', '/api/v1/simulator/oem-callbacks', as('admin')), (l: Json[]) => l.some((x) => x.orderRef === payload.oemOrderRef && x.status === 'CONFIRMED'));
      return `${o.orderNo} CONFIRMED; replayed push gave the same order; duplicate ref and bad signature refused; ${cb.length} callbacks logged`;
    }
    throw new Fail('no usable Zenmo sample vehicle');
  });

  await flow('C. OEM order by CSV file', async () => {
    const job = await ok('POST', '/api/v1/simulator/oem-csv', { ...as('admin'), body: {} });
    const done = await waitFor('import job', () => ok('GET', `/api/v1/imports/${job.id}`, as('ops')), (j: Json) => j.job.status === 'DONE');
    assert(done.job.okRows >= 3 && done.job.errorRows >= 2, `expected good and bad rows, got ok=${done.job.okRows} error=${done.job.errorRows}`);
    const report = await call('GET', `/api/v1/imports/${job.id}/error-report`, as('ops'));
    assert(report.status === 200 && /Chassis No is required/.test(report.text) && /Unknown dealer/.test(report.text), 'error report lists the bad rows');
    const refs = done.rows.filter((r: Json) => r.status === 'OK').map((r: Json) => r.resultRef);
    const states = await Promise.all(refs.map((id: string) => waitStatus(id, ['CONFIRMED', 'REJECTED'])));
    assert(states.some((s) => s.status === 'REJECTED' && /VAHAN/.test(s.rejectionReason)), 'the row not in VAHAN is rejected by validation');
    return `${done.job.totalRows} rows: ${done.job.okRows} imported (${states.filter((s) => s.status === 'CONFIRMED').length} confirmed, ${states.filter((s) => s.status === 'REJECTED').length} rejected by VAHAN), ${done.job.errorRows} in the error report`;
  });

  await flow('D. Customer order (portal)', async () => {
    const pool: Json[] = await ok('GET', '/api/v1/simulator/vahan-vehicles?scenario=demo-old&state=WB', as('admin'));
    for (const v of pool.filter((x) => !x.hsrpFrontLaserCode).reverse()) {
      const chk = await ok('POST', '/api/v1/public/vehicle-checks', { body: { stateCode: 'WB', regnNo: v.regnNo, chassisLast5: v.chassisNo.slice(-5), engineLast5: v.engineNo.slice(-5) } });
      const res = await waitFor('vehicle check', () => ok('GET', `/api/v1/public/vehicle-checks/${chk.id}`), (c: Json) => c.status !== 'PENDING');
      if (res.status !== 'DONE' || res.result.orderType !== 'OLD') continue;
      const cities: string[] = await ok('GET', '/api/v1/public/cities?stateCode=WB');
      const centres: Json[] = await ok('GET', `/api/v1/public/fitment-centres?stateCode=WB&city=${encodeURIComponent(cities[0])}`);
      let slot: Json;
      let date = '';
      for (let d = 1; d < 10 && !slot; d++) {
        date = new Date(Date.now() + 5.5 * 3600_000 + d * 86400_000).toISOString().slice(0, 10);
        slot = (await ok('GET', `/api/v1/public/slots?dealerCode=${centres[0].code}&date=${date}`)).slots.find((s: Json) => s.available > 0);
      }
      assert(slot, 'a free slot');
      const mobile = `9${String(Date.now()).slice(-9)}`;
      const since = new Date(Date.now() - 50).toISOString();
      const otp = await ok('POST', '/api/v1/public/otp', { body: { purpose: 'ORDER_CONFIRM', mobile } });
      const code = await otpFor(mobile, since);
      const placed = await ok('POST', '/api/v1/public/orders', {
        idem: randomUUID(),
        body: { vehicleCheckId: chk.id, otpRef: otp.otpRef, otpCode: code, dealerCode: centres[0].code, slotDate: date, slotStart: slot.start, ownerName: 'E2E Customer', mobile, email: 'e2e@example.invalid' },
      });
      const tok = placed.token;
      await waitFor('AWAITING_PAYMENT', () => ok('GET', `/api/v1/public/orders/${placed.orderId}`, { token: tok }), (o: Json) => o.status === 'AWAITING_PAYMENT');
      const co = await ok('POST', `/api/v1/public/orders/${placed.orderId}/checkout`, { token: tok });
      const gw = await call('POST', co.action, { form: new URLSearchParams(co.fields) });
      assert(gw.status === 200 && /Mock payment gateway/.test(gw.text), 'mock gateway page');
      const tampered = await call('POST', co.action, { form: new URLSearchParams({ ...co.fields, amount: '1.00' }) });
      assert(tampered.status === 400, 'tampered amount must fail the hash check');
      const done = await call('POST', `${BASE}/mock-gateway/payu/complete`, { form: new URLSearchParams({ txnid: co.fields.txnid, outcome: 'success' }) });
      const fields = Object.fromEntries([...done.text.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
      const back = await call('POST', co.fields.surl, { form: new URLSearchParams(fields), redirect: 'manual' });
      assert(back.status === 303 && /payment-return/.test(back.headers.get('location') ?? ''), 'browser return redirects to the portal');
      const paid = await waitFor('CONFIRMED after webhook/verify', () => ok('GET', `/api/v1/public/orders/${placed.orderId}`, { token: tok }), (o: Json) => o.status === 'CONFIRMED');
      const receipt = await call('GET', `/api/v1/public/orders/${placed.orderId}/receipt`, { token: tok });
      assert(receipt.status === 200 && receipt.text.startsWith('%PDF'), 'receipt PDF');
      ctx.D = paid;
      return `${paid.orderNo} booked ${date} ${slot.start} at ${centres[0].name}, OTP confirmed, paid on the mock gateway, receipt PDF downloaded`;
    }
    throw new Fail('no usable demo-old vehicle');
  });

  await flow('E. Station production', async () => {
    const o = ctx.A;
    assert(o, 'needs flow A');
    const wrong = await call('POST', `/api/v1/station/qc/${o.id}`, { ...as('station.bbs'), body: { result: 'PASS' } });
    assert(wrong.status === 403 || wrong.status === 409, 'another station cannot act on this order');
    const jc = await stationIssue([o.id], WB01.id, KOL1.id);
    await waitStatus(o.id, ['ISSUED']);
    await qcPassAndSticker(o.id);
    const o2 = await order(o.id);
    if (o2.stickerRequired) {
      const noReason = await call('POST', `/api/v1/station/stickers/${o.id}/print`, { ...as('station.kol'), body: { reprint: true } });
      assert(noReason.status === 400, 'reprint needs a reason');
      const re = await call('POST', `/api/v1/station/stickers/${o.id}/print`, { ...as('station.kol'), body: { reprint: true, reason: 'Printer jam' } });
      assert(re.status === 201, 'reprint with reason');
    }
    const ch = await challanFor([o.id], WB01.id, KOL1.id);
    await waitStatus(o.id, ['DISPATCHED']);
    ctx.challanA = ch;
    return `job card ${jc.jobCardNo}, QC passed, sticker ${o2.stickerRequired ? 'printed + reprinted' : 'not required (skipped)'}, challan ${ch.challanNo}`;
  });

  await flow('F. Dealer inward', async () => {
    const ch = ctx.challanA;
    assert(ch, 'needs flow E');
    const pending: Json[] = await ok('GET', '/api/v1/dispatch/challans?status=CREATED', as('dealer.wb01'));
    assert(pending.some((c) => c.id === ch.id), 'challan visible to the dealer');
    const full = await ok('GET', `/api/v1/dispatch/challans/${ch.id}`, as('dealer.wb01'));
    const body = { lines: full.lines.map((l: Json) => ({ lineId: l.id, decision: 'ACCEPT' })) };
    await ok('POST', `/api/v1/dispatch/challans/${ch.id}/inward`, { ...as('dealer.wb01'), idem: randomUUID(), body });
    const again = await call('POST', `/api/v1/dispatch/challans/${ch.id}/inward`, { ...as('dealer.wb01'), idem: randomUUID(), body });
    assert(again.status === 409, 'a challan can be inwarded once');
    await waitStatus(ctx.A.id, ['INWARDED']);
    return `challan ${ch.challanNo}: ${full.lines.length} plates accepted; second inward refused`;
  });

  await flow('G. Fitment (with photos) → VAHAN → completed', async () => {
    const o = ctx.A;
    const { res, idem, fd } = await fitment(o.id, 'dealer.wb01');
    assert(res.status === 201, `fitment → ${res.status} ${JSON.stringify(res.body)}`);
    const replay = await call('POST', '/api/v1/fitments', { ...as('dealer.wb01'), idem, form: fd });
    assert(replay.status === 201 && replay.headers.get('idempotent-replayed') === 'true', 'offline re-sync with the same key replays');
    const dup = await fitment(o.id, 'dealer.wb01').catch((e) => ({ res: { status: 0, body: String(e) } }));
    assert(dup.res.status !== 201, 'fitment can be recorded once per order');
    await waitStatus(o.id, ['COMPLETED']);
    const sms = await waitFor('completion SMS', () => ok('GET', '/api/v1/simulator/messages?to=9000099001', as('admin')), (m: Json[]) => m.some((x) => x.body.includes(o.regnNo) && /fitted/.test(x.body)));
    return `${o.orderNo} FITTED → VAHAN post OK → COMPLETED; ${sms.length} SMS to the owner`;
  });

  await flow('H. Rejection and re-issue', async () => {
    // H1: QC reject → station disapproves → back to QC_PASSED (or straight to STICKER_PRINTED when no sticker is needed)
    const { order: h1 } = await dealerOrder('dealer.wb01', 'demo-new', 'WB');
    await stationIssue([h1.id], WB01.id, KOL1.id);
    const noReason = await call('POST', `/api/v1/station/qc/${h1.id}`, { ...as('station.kol'), body: { result: 'REJECT', rejectPositions: ['FRONT'] } });
    assert(noReason.status === 400, 'QC reject needs a reason');
    await ok('POST', `/api/v1/station/qc/${h1.id}`, { ...as('station.kol'), body: { result: 'REJECT', rejectPositions: ['FRONT'], reason: 'Hologram misaligned' } });
    await waitStatus(h1.id, ['REJECTION_REVIEW']);
    const cases: Json[] = await ok('GET', '/api/v1/rejections?status=PENDING', as('station.kol'));
    const c1 = cases.find((c) => c.orderId === h1.id);
    await decideApprovalFor(c1.id, 'plate-rejection', 'REJECT', 'station.kol', 'Plate is within tolerance; use it');
    const back = await waitStatus(h1.id, ['QC_PASSED', 'STICKER_PRINTED']);

    // H2: dealer rejects the rear plate at inward → station approves → only REAR re-issued on a second challan
    const { order: h2 } = await dealerOrder('dealer.wb01', 'demo-new', 'WB');
    await stationIssue([h2.id], WB01.id, KOL1.id);
    await qcPassAndSticker(h2.id);
    const ch1 = await challanFor([h2.id], WB01.id, KOL1.id);
    const full = await ok('GET', `/api/v1/dispatch/challans/${ch1.id}`, as('dealer.wb01'));
    const noReasonInward = await call('POST', `/api/v1/dispatch/challans/${ch1.id}/inward`, { ...as('dealer.wb01'), idem: randomUUID(), body: { lines: full.lines.map((l: Json) => ({ lineId: l.id, decision: 'REJECT' })) } });
    assert(noReasonInward.status === 400, 'dealer rejection needs a reason');
    await ok('POST', `/api/v1/dispatch/challans/${ch1.id}/inward`, {
      ...as('dealer.wb01'),
      idem: randomUUID(),
      body: { lines: full.lines.map((l: Json) => ({ lineId: l.id, decision: l.position === 'REAR' ? 'REJECT' : 'ACCEPT', reason: l.position === 'REAR' ? 'Corner cracked' : undefined })) },
    });
    await waitStatus(h2.id, ['REJECTION_REVIEW']);
    const cases2: Json[] = await ok('GET', '/api/v1/rejections?status=PENDING', as('station.kol'));
    const c2 = cases2.find((c) => c.orderId === h2.id);
    const oldRear = full.lines.find((l: Json) => l.position === 'REAR').laserCode;
    await decideApprovalFor(c2.id, 'plate-rejection', 'APPROVE', 'station.kol', 'Agreed, re-issue rear plate');
    const reconfirmed = await waitStatus(h2.id, ['CONFIRMED']);
    assert(reconfirmed.pendingPositions.join() === 'REAR', 'only the rejected position is re-issued');
    const hist = await ok('GET', `/api/v1/inventory/plates/${oldRear}/history`, as('admin'));
    assert(hist.plate.status === 'SCRAPPED', 'rejected plate is scrapped');
    await stationIssue([h2.id], WB01.id, KOL1.id);
    await qcPassAndSticker(h2.id);
    const ch2 = await challanFor([h2.id], WB01.id, KOL1.id);
    const full2 = await ok('GET', `/api/v1/dispatch/challans/${ch2.id}`, as('dealer.wb01'));
    assert(full2.lines.length === 1 && full2.lines[0].position === 'REAR', 'second challan holds only the re-issued plate');
    await ok('POST', `/api/v1/dispatch/challans/${ch2.id}/inward`, { ...as('dealer.wb01'), idem: randomUUID(), body: { lines: full2.lines.map((l: Json) => ({ lineId: l.id, decision: 'ACCEPT' })) } });
    await waitStatus(h2.id, ['INWARDED']);
    ctx.H2 = h2;
    return `QC reject on ${h1.orderNo} disapproved → ${back.status}; dealer reject on ${h2.orderNo} approved → rear re-issued on ${ch2.challanNo} → INWARDED`;
  });

  await flow('I. Replacement order with evidence', async () => {
    const pool: Json[] = await ok('GET', '/api/v1/simulator/vahan-vehicles?scenario=demo-has-plates&state=WB', as('admin'));
    const noEvidence = await call('POST', '/api/v1/orders', { ...as('dealer.wb01'), idem: randomUUID(), body: { regnNo: pool[0].regnNo, chassisNo: pool[0].chassisNo, engineNo: pool[0].engineNo, orderType: 'REPLACEMENT', replacementReason: 'DAMAGED' } });
    assert(noEvidence.status === 400, 'replacement without evidence is refused');
    const fd = new FormData();
    fd.set('file', new Blob([PNG], { type: 'image/png' }), 'damaged-plate.png');
    fd.set('purpose', 'replacement-evidence');
    const file = await ok('POST', '/api/v1/files', { ...as('dealer.wb01'), form: fd });
    const { order: o } = await dealerOrder('dealer.wb01', 'demo-has-plates', 'WB', { orderType: 'REPLACEMENT', replacementReason: 'DAMAGED', plateSet: 'FRONT', evidenceFileId: file.id }, ['AWAITING_APPROVAL']);
    const hold = (await ok('GET', `/api/v1/wallets/${WB01.walletAccountId}/holds`, as('admin'))).find((h: Json) => h.subjectId === o.id);
    assert(hold?.status === 'HELD', 'wallet amount is held while waiting for approval');
    await decideApprovalFor(o.id, 'replacement-order', 'APPROVE', 'ops', 'Photo shows a cracked plate');
    const c = await waitStatus(o.id, ['CONFIRMED']);
    const hold2 = (await ok('GET', `/api/v1/wallets/${WB01.walletAccountId}/holds`, as('admin'))).find((h: Json) => h.subjectId === o.id);
    assert(hold2.status === 'CAPTURED', 'captured after approval');
    return `${c.orderNo} (front plate, damaged) waited in AWAITING_APPROVAL with ₹${(hold.amountPaise / 100).toFixed(2)} held; operations approved → CONFIRMED`;
  });

  await flow('J. VAHAN down during fitment', async () => {
    const o = ctx.H2;
    assert(o, 'needs flow H');
    await ok('PUT', '/api/v1/simulator/vahan-mode', { ...as('admin'), body: { mode: 'down' } });
    try {
      const { res } = await fitment(o.id, 'dealer.wb01');
      assert(res.status === 201, `fitment still records while VAHAN is down (${res.status})`);
      const queued = await waitFor(
        'VAHAN post in the retry queue',
        () => ok('GET', '/api/v1/integration/deliveries?subscriber=fitment.vahan-post&status=FAILED', as('admin')),
        (p: Json) => p.items.some((d: Json) => d.subjectId === o.id && d.attempts >= 1),
      );
      assert((await order(o.id)).status === 'FITTED', 'order stays FITTED');
      const d = queued.items.find((x: Json) => x.subjectId === o.id);
      await ok('PUT', '/api/v1/simulator/vahan-mode', { ...as('admin'), body: { mode: 'normal' } });
      // 409 = a scheduled retry is running right now; it will succeed on its own since VAHAN is back.
      await ok('POST', `/api/v1/integration/deliveries/${d.id}/replay`, as('admin'), [200, 201, 409]);
      await waitStatus(o.id, ['COMPLETED']);
      return `${o.orderNo} FITTED with VAHAN down; post queued (${d.lastError}); after VAHAN came back and a replay → COMPLETED`;
    } finally {
      await ok('PUT', '/api/v1/simulator/vahan-mode', { ...as('admin'), body: { mode: 'normal' } });
    }
  });

  await flow('K. Complaint', async () => {
    const mobile = `8${String(Date.now()).slice(-9)}`;
    let since = new Date(Date.now() - 50).toISOString();
    const otp = await ok('POST', '/api/v1/public/otp', { body: { purpose: 'SUPPORT', mobile } });
    const t = await ok('POST', '/api/v1/public/complaints', {
      body: { otpRef: otp.otpRef, otpCode: await otpFor(mobile, since), name: 'E2E Complainant', mobile, category: 'PLATE_DELAY', description: 'My plates have not arrived yet at the centre.' },
    });
    await waitFor('ticket SMS', () => ok('GET', `/api/v1/simulator/messages?to=${mobile}`, as('admin')), (m: Json[]) => m.some((x) => x.body.includes(t.ticketNo)));
    const list = await ok('GET', '/api/v1/tickets?status=OPEN', as('ops'));
    const mine = list.items.find((x: Json) => x.ticketNo === t.ticketNo);
    await ok('POST', `/api/v1/tickets/${mine.id}/replies`, { ...as('ops'), body: { message: 'Your plates reach the centre tomorrow.', status: 'IN_PROGRESS', isPublic: true } });
    since = new Date(Date.now() - 50).toISOString();
    const otp2 = await ok('POST', '/api/v1/public/otp', { body: { purpose: 'SUPPORT', ticketNo: t.ticketNo } });
    const st = await ok('POST', '/api/v1/public/complaints/status', { body: { ticketNo: t.ticketNo, otpRef: otp2.otpRef, code: await otpFor(mobile, since) } });
    assert(st.status === 'IN_PROGRESS' && st.events.length >= 2, 'customer sees the staff answer');
    const overdue = await ok('GET', '/api/v1/tickets?overdue=true', as('ops'));
    assert(overdue.total >= 1 && overdue.items.every((x: Json) => x.overdue), 'ageing against 15 days is visible');
    return `${t.ticketNo} raised (due ${String(t.dueAt).slice(0, 10)}), answered by staff, status checked by OTP; ${overdue.total} complaints past 15 days`;
  });

  await flow('L. Oversight', async () => {
    const dash = await ok('GET', '/api/v1/dashboard', as('ops'));
    assert(dash.ordersByStatus.COMPLETED > 0 && typeof dash.fitments.fittedToday === 'number' && dash.stock.length === 2, 'dashboard counts');
    const detail = await ok('GET', `/api/v1/orders/${ctx.A.id}/detail`, as('ops'));
    const path = detail.history.map((h: Json) => h.toStatus).join(' → ');
    assert(path.endsWith('COMPLETED') && detail.audit.length > 0 && detail.fitment.frontPhotoUrl, 'order timeline, audit, photos');
    const photo = await call('GET', detail.fitment.frontPhotoUrl);
    assert(photo.status === 200, 'signed photo link works');
    const audit = await ok('GET', '/api/v1/audit?action=auth.login', as('admin'));
    assert(audit.total > 0, 'logins are audited');
    const reports: Json[] = await ok('GET', '/api/v1/reports', as('ops'));
    const csv = await call('GET', '/api/v1/reports/orders-register/csv', as('ops'));
    assert(csv.status === 200 && csv.text.startsWith('Order no,'), 'CSV export');
    return `dashboard ok; timeline ${path}; ${reports.length} reports; orders CSV ${csv.text.split('\r\n').length - 2} rows`;
  });

  // ------------------------------------------------------------------------------------------ summary
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} flows passed in ${(results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1)} s`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
