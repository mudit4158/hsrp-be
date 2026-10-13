import { renderPlate, wrongPlate } from '../core/plate-image';
import type { Ctx, Step } from '../core/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Station allocates plates: dealer WB01, tick the case's order, pick the suggested boxes, lock, allocate. */
export function issueJobCard(note = 'allocates laser-coded plates and creates the job card'): Step {
  return {
    who: 'station',
    say: `Station ${note}`,
    async run(c) {
      const o = await c.api.order(c.data.orderId);
      const w = await c.web.as('station');
      await w.nav('Issuance & job cards');
      await w.select('Dealer', 'WB01');
      const row = w.row(o.orderNo);
      await w.click(row.locator('input[type=checkbox]'));
      // One suggested box per plate size the order still needs.
      const sizes = [...new Set((o.pendingPositions as string[]).map((p) => (p === 'FRONT' ? o.frontProductCode : o.rearProductCode)))];
      for (const size of sizes) await w.click(w.page.getByRole('button', { name: new RegExp(`^BX-\\S+ \\(${size},`) }).first());
      await w.clickButton('Lock boxes');
      await w.waitText(/^Locked:/);
      await w.clickButton('Allocate & create job card');
      await c.api.waitStatus(c.data.orderId, ['ISSUED']);
      await w.waitText(/Job card JC\S+ created/);
      await w.viewPopup(() => w.clickButton('Open job card PDF'));
      await w.show(w.page.getByText(/Job card JC\S+ created/).first());
    },
  };
}

/**
 * After embossing, the station photographs each plate and OCR reads the registration number (D45). `wrong` plates
 * are photographed showing another number (an embossing mistake): OCR fails them and QC cannot pass the order.
 */
export function uploadPlatePhotos(wrong: Array<'FRONT' | 'REAR'> = []): Step {
  return {
    who: 'station',
    say: wrong.length
      ? `Station photographs the embossed plates; the ${wrong.join(' and ').toLowerCase()} plate shows another number, so OCR fails it and QC cannot pass the order`
      : 'Station photographs each embossed plate; OCR reads the registration number and it matches the order',
    async run(c) {
      const d = await c.api.orderDetail(c.data.orderId);
      const regn: string = d.order.regnNo;
      const active = (d.allocations as Array<{ id: string; position: 'FRONT' | 'REAR'; laserCode: string; status: string }>).filter((a) => a.status === 'ACTIVE');
      const w = await c.web.as('station');
      await w.nav('Quality check');
      const row = w.row(d.order.orderNo);
      await w.clickButton('Upload photos', row);
      const m = w.modal();
      for (const a of active) {
        const shows = wrong.includes(a.position) ? wrongPlate(regn) : regn;
        const photo = await renderPlate(w.page, shows, `embossed ${a.position.toLowerCase()} plate · laser code ${a.laserCode}`);
        const input = w.field(`${a.position === 'FRONT' ? 'Front' : 'Rear'} plate photo`, m);
        await w.pointAt(input);
        await input.setInputFiles({ name: `${a.position.toLowerCase()}-plate.jpg`, mimeType: 'image/jpeg', buffer: photo });
        await sleep(c.pace.afterClick);
      }
      await w.clickButton('Read the photos', m);
      await m.locator('table').waitFor({ timeout: 30_000 });
      const checks = (await c.api.orderDetail(c.data.orderId)).plateChecks.filter((x: any) => x.stage === 'EMBOSSING').slice(-active.length);
      for (const a of active) {
        const got = checks.find((x: any) => x.position === a.position)?.result;
        const want = wrong.includes(a.position) ? 'FAIL' : 'PASS';
        if (got !== want) throw new Error(`OCR of the ${a.position.toLowerCase()} plate: expected ${want}, got ${got}`);
      }
      await c.say(checks.map((x: any) => `${x.position.toLowerCase()}: read ${x.readText ?? 'nothing'} → ${x.result === 'PASS' ? 'matches' : 'does not match'} ${regn}`).join(' · '));
      await w.show(m.locator('table'), c.pace.read * 2);
      await w.clickButton('Done', m);
      if (wrong.length) await w.show(w.button('Pass', w.row(d.order.orderNo)));
    },
  };
}

export const qcPass: Step = {
  who: 'station',
  say: 'Station quality check: the embossed plates pass',
  async run(c) {
    const w = await c.web.as('station');
    await w.nav('Quality check');
    const row = w.row(c.data.orderNo);
    await w.show(row, c.pace.read / 2);
    await w.clickButton('Pass', row);
    await c.api.waitStatus(c.data.orderId, ['QC_PASSED', 'STICKER_PRINTED']);
  },
};

export function qcReject(position: 'FRONT' | 'REAR', reason: string): Step {
  return {
    who: 'station',
    say: `Station quality check rejects the ${position.toLowerCase()} plate: "${reason}"`,
    async run(c) {
      const w = await c.web.as('station');
      await w.nav('Quality check');
      const row = w.row(c.data.orderNo);
      await w.show(row, c.pace.read / 2);
      await w.clickButton('Reject', row);
      const m = w.modal();
      await w.click(m.locator('label.check', { hasText: position }).locator('input'));
      await w.type(w.field('Reason (mandatory)', m), reason);
      await w.clickButton('Reject', m);
      await c.api.waitStatus(c.data.orderId, ['REJECTION_REVIEW']);
    },
  };
}

export function approveRejection(source: string): Step {
  return {
    who: 'station',
    say: `Station reviews the ${source} rejection and approves it: the rejected plate is scrapped and re-issued`,
    async run(c) {
      const w = await c.web.as('station');
      await w.nav('Rejection approval');
      const row = w.row(c.data.orderNo);
      await w.show(row);
      await w.clickButton('Decide', row);
      const m = w.modal();
      await w.type(w.field('Remarks (mandatory)', m), 'Defect confirmed; scrap and re-issue');
      await w.clickButton('Approve (re-issue)', m);
      await c.api.waitStatus(c.data.orderId, ['CONFIRMED']);
    },
  };
}

export const printSticker: Step = {
  who: 'station',
  say: 'Station prints the third registration sticker (cars need one; BS-VI gets the green strip)',
  async run(c) {
    const w = await c.web.as('station');
    await w.nav('Sticker printing');
    const row = w.row(c.data.orderNo);
    await w.viewPopup(() => w.clickButton('Print', row));
    await c.api.waitStatus(c.data.orderId, ['STICKER_PRINTED']);
  },
};

export const stickerSkipped: Step = {
  who: 'station',
  say: 'Two-wheelers need no third sticker: the order moved on to "Sticker printed" by itself',
  async run(c) {
    await c.api.waitStatus(c.data.orderId, ['STICKER_PRINTED']);
  },
};

export function createChallan(note = 'creates the delivery challan; the plates are dispatched to the dealer'): Step {
  return {
    who: 'station',
    say: `Station ${note}`,
    async run(c: Ctx) {
      const w = await c.web.as('station');
      await w.nav('Delivery challans');
      await w.select('Dealer', 'WB01');
      const row = w.row(c.data.orderNo);
      await w.click(row.locator('input[type=checkbox]'));
      await w.viewPopup(() => w.clickButton(/^Create challan \(1\)$/));
      await c.api.waitStatus(c.data.orderId, ['DISPATCHED']);
      const ch = await c.api.latestChallan(c.data.orderId);
      c.data.challanNo = ch?.challanNo;
      await c.say(`Challan ${ch?.challanNo} is on its way to dealer WB01`);
      await w.show(w.page.locator('tbody tr', { hasText: ch?.challanNo ?? '' }).first());
    },
  };
}
