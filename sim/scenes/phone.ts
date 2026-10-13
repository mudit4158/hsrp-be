import type { PNode } from '../core/phone';
import type { Ctx, Step } from '../core/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** After a submit the app opens its Sync tab; "Sync now" sends at once instead of waiting for WorkManager. */
async function syncNow(c: Ctx) {
  const btn = await c.phone.find('Sync now');
  if (btn) await c.phone.tapNode(btn);
}

/**
 * Dealer app: inward the case's latest challan plate by plate. `reject` maps a plate position to the reason the
 * dealer gives; every other plate is accepted.
 */
export function phoneInward(reject: Partial<Record<'FRONT' | 'REAR', string>> = {}): Step {
  const rejected = Object.keys(reject);
  return {
    who: 'phone',
    say: rejected.length
      ? `Dealer app: inward the challan, rejecting the ${rejected.join(' and ').toLowerCase()} plate ("${Object.values(reject).join('; ')}")`
      : 'Dealer app: inward the challan and accept every plate',
    async run(c) {
      const ch = await c.api.latestChallan(c.data.orderId);
      if (!ch) throw new Error('No challan in transit for this order');
      const detail = await c.api.get(`/dispatch/challans/${ch.challanId}`);
      const p = c.phone;
      await p.ensureSignedIn();
      await p.tab('Inward');
      await p.tap('Refresh');
      await p.tap((n) => n.text === ch.challanNo || (n.text ?? '').startsWith(`${ch.challanNo} `), `challan ${ch.challanNo}`, 20_000);
      await p.waitFor('Submit inward', 'the challan screen');
      for (const line of detail.lines as Array<{ laserCode: string; position: 'FRONT' | 'REAR' }>) {
        const anchor = (n: PNode) => (n.text ?? '').startsWith(`Laser code ${line.laserCode}`);
        const decision = reject[line.position] ? 'Reject' : 'Accept';
        await p.reveal(anchor, `plate ${line.laserCode}`);
        // The Accept / Reject chips sit just below the plate's laser-code line.
        const chip = async () => {
          const nodes = await p.nodes();
          const a = nodes.find(anchor)!;
          return nodes.filter((n) => n.text === decision && n.y > a.y).sort((x, y) => x.y - y.y)[0];
        };
        await p.tapNode(await chip());
        if (decision === 'Reject') {
          const field = await p.waitFor((n) => n.editable && /Reason/.test(n.text ?? ''), 'reason field');
          await p.tapNode(field);
          await p.type(reject[line.position]!, (n) => n.editable && /Reason/.test(n.text ?? ''));
          await p.hideKeyboard();
        }
      }
      await p.tap('Submit inward');
      await sleep(c.pace.phoneAfterTap);
      await syncNow(c);
      await c.api.waitStatus(c.data.orderId, rejected.length ? ['REJECTION_REVIEW'] : ['INWARDED'], 60_000);
      await sleep(c.pace.read);
    },
  };
}

/** Dealer app: find the vehicle, confirm the laser codes, take front and rear photos, submit the fitment. */
export function phoneFitment(expect: 'COMPLETED' | 'FITTED' | 'REFUSED' = 'COMPLETED'): Step {
  const refused = expect === 'REFUSED';
  return {
    who: 'phone',
    say: refused
      ? 'Dealer app: the front photo shows another vehicle\'s number; the server reads it (OCR) and refuses the fitment'
      : 'Dealer app: search the vehicle, confirm the laser codes, take the front and rear photos and submit the fitment',
    async run(c) {
      const o = await c.api.order(c.data.orderId);
      const p = c.phone;
      await p.ensureSignedIn();
      await p.tab('Fitment');
      const regnField = (n: PNode) => n.editable && /Registration number/.test(n.text ?? '');
      await p.tap(regnField, 'registration field');
      await p.type(o.regnNo, regnField);
      await p.hideKeyboard();
      await p.tap('Search');
      await p.tap('Record fitment', 'Record fitment', 20_000);
      // The checkbox has no text of its own: it is the toggle on the confirmation sentence's row.
      const sentence = await p.reveal((n) => (n.text ?? '').startsWith('The plates on the vehicle carry'), 'laser-code confirmation');
      const nodes = await p.nodes();
      const box = nodes.filter((n) => n.clickable && !n.text && Math.abs(n.y + n.h / 2 - (sentence.y + sentence.h / 2)) < 60).sort((a, b) => a.x - b.x)[0];
      await p.tapNode(box ?? sentence);
      for (const kind of ['Front plate', 'Rear plate']) {
        const section = (n: PNode) => (n.text ?? '').startsWith(`${kind} photo`);
        if (!(await p.find(section))) continue; // single-plate replacement orders have one section
        await p.reveal(section, `${kind} photo`);
        const all = await p.nodes();
        const head = all.find(section)!;
        const take = all.filter((n) => n.text === 'Take photo' && n.y > head.y).sort((a, b) => a.y - b.y)[0];
        await p.tapNode(take);
        // Refused case: the front photo shows another number (debug "wrong number" test photo).
        const button = refused && kind === 'Front plate' ? 'Test photo (wrong number)' : 'Test photo';
        await p.tap(button, `camera ${button} button`, 20_000);
        await p.waitFor((n) => (n.text ?? '').startsWith('The plates on the vehicle carry') || n.text === 'Submit fitment', 'back on the fitment screen');
      }
      await p.tap('Submit fitment');
      await sleep(c.pace.phoneAfterTap);
      await syncNow(c);
      if (refused) {
        // The app keeps the fitment in its Sync list as failed, with the server's reason; the order stays inwarded.
        await c.api.waitFor(
          'fitment refused by OCR',
          () => c.api.orderDetail(c.data.orderId),
          (d: any) => d.plateChecks.some((x: any) => x.stage === 'FITMENT' && x.result === 'FAIL') && d.order.status === 'INWARDED',
          60_000,
        );
        await p.waitFor((n) => /refused|does not match|order is for/i.test(n.text ?? ''), 'the refusal reason in the Sync list', 30_000);
        await sleep(c.pace.read * 2);
        return;
      }
      await c.api.waitStatus(c.data.orderId, expect === 'COMPLETED' ? ['FITTED', 'COMPLETED'] : ['FITTED'], 60_000);
      await sleep(c.pace.read);
    },
  };
}
