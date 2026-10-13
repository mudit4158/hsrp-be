import type { Ctx, Step } from '../core/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ZENMO = 'Zenmo Motors (fictional)';

/** Billing → Setup: sets who is billed for one OEM × dealer pair (D46). */
export function setBillTo(oemCode: string, dealerCode: string, to: 'OEM' | 'DEALER'): Step {
  return {
    who: 'admin',
    say: `Billing setup: ${oemCode} is postpaid; its orders from dealer ${dealerCode} are billed to ${to === 'DEALER' ? 'the dealer' : 'the OEM'}`,
    async run(c) {
      const before = (await c.api.get('/billing/setup')).find((o: any) => o.oemCode === oemCode)?.dealers.find((d: any) => d.dealerCode === dealerCode)?.billTo;
      c.data.billToBefore = before;
      const w = await c.web.as('admin');
      await w.nav('Billing');
      await w.click(w.page.getByRole('tab', { name: 'Setup' }));
      const card = w.page.locator('.card', { has: w.page.getByRole('heading', { name: oemCode === 'ZENMO' ? ZENMO : oemCode }) });
      await w.show(card.locator('.form').first(), c.pace.read);
      await w.select(card.getByLabel(`Bill to for ${dealerCode}`), to);
      await c.api.waitFor('bill-to saved', () => c.api.get('/billing/setup'), (s: any[]) => s.find((o) => o.oemCode === oemCode)?.dealers.find((d: any) => d.dealerCode === dealerCode)?.billTo === to);
      await w.show(card.locator('tbody tr', { hasText: dealerCode }));
    },
  };
}

/** Puts the bill-to of the pair back to what it was before the case (keeps runs repeatable). */
export function restoreBillTo(oemCode: string, dealerCode: string): Step {
  return {
    who: 'system',
    say: `Put ${oemCode} × ${dealerCode} billing back as it was before this case`,
    async run(c) {
      if (c.data.billToBefore) await c.api.put(`/billing/oems/${oemCode}/dealers/${dealerCode}`, { billTo: c.data.billToBefore });
    },
  };
}

/** The order's Payment tab: postpaid, and who it is billed to. */
export const showPostpaidOrder: Step = {
  who: 'dealer',
  say: 'Postpaid order: confirmed without a wallet hold; the Payment tab shows who it will be billed to',
  async run(c) {
    const w = await c.web.as('dealer');
    await w.click(w.page.getByRole('tab', { name: /Payment/ }));
    await w.waitText(/Postpaid: billed to/);
    await w.show(w.page.getByText(/Postpaid: billed to/).first(), c.pace.read * 1.5);
  },
};

/** Billing → Unbilled charges: the order's charge and its status. */
export function showCharge(status: 'PENDING' | 'BILLABLE'): Step {
  return {
    who: 'admin',
    say: status === 'PENDING' ? 'Billing: the order is a postpaid charge, not billable until its plates are dispatched' : 'Billing: the plates are dispatched, so the charge is billable in this cycle',
    async run(c) {
      await c.api.waitFor(`charge ${status}`, () => c.api.get('/billing/charges?status=PENDING,BILLABLE,BILLED'), (l: any[]) => l.some((x) => x.orderId === c.data.orderId && x.status === status));
      const w = await c.web.as('admin');
      await w.nav('Billing');
      await w.click(w.page.getByRole('tab', { name: 'Unbilled charges' }));
      await w.show(w.row(c.data.orderNo), c.pace.read * 1.5);
    },
  };
}

/** Billing → Bills → Run billing now for the OEM; opens the new bill and its PDF. */
export function runBillingNow(oemCode: string): Step {
  return {
    who: 'admin',
    say: `Billing: "Run billing now" closes ${oemCode}'s current period; one bill per party is issued, its PDF made and e-mailed`,
    async run(c) {
      const w = await c.web.as('admin');
      await w.nav('Billing');
      await w.click(w.page.getByRole('tab', { name: 'Bills' }));
      await w.select(w.page.locator('.card', { hasText: 'Bills' }).locator('select').first(), oemCode === 'ZENMO' ? ZENMO : oemCode);
      await w.clickButton('Run billing now');
      const charge = await c.api.waitFor('order billed', () => c.api.get('/billing/charges?status=BILLED'), (l: any[]) => l.some((x) => x.orderId === c.data.orderId));
      const billId = charge.find((x: any) => x.orderId === c.data.orderId).billId;
      const bill = await c.api.get(`/billing/bills/${billId}`);
      c.data.billNo = bill.billNo;
      await c.say(`Bill ${bill.billNo} to ${bill.billToName}: ${bill.lineCount} order(s), ₹${(bill.amountPaise / 100).toFixed(2)}, sent to ${bill.sentTo ?? '…'}`);
      // The bills list refreshes every few seconds; if a refresh swallowed the click, click again.
      for (let attempt = 0; attempt < 3; attempt++) {
        await w.click(w.row(bill.billNo).getByText(bill.billNo));
        if (await w.modal().locator('table').waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) break;
      }
      await w.show(w.modal().locator('table'), c.pace.read * 1.5);
      await w.viewPopup(() => w.clickButton('Open PDF', w.modal()), c.pace.read * 1.5);
      await w.click(w.modal().locator('.modal-head button').first());
    },
  };
}

/** Simulator → SMS & e-mail: the bill e-mail to the bill-to party. */
export const showBillEmail: Step = {
  who: 'admin',
  say: 'The bill was e-mailed to the billing contact with a link to view and download it',
  async run(c) {
    const w = await c.web.as('admin');
    await w.nav('Simulator');
    await w.click(w.page.getByRole('tab', { name: /SMS & e-mail/ }));
    await w.type(w.field('Recipient contains'), '@');
    await sleep(500);
    await w.show(w.page.locator('tbody tr', { hasText: c.data.billNo }).first(), c.pace.read * 1.5);
  },
};
