import type { Ctx, Step } from '../core/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Shows the order's page in the dealer window and points at its status badge. */
async function showOrderStatus(c: Ctx, label: string) {
  const w = await c.web.as('dealer');
  if (!w.page.url().includes(`/orders/${c.data.orderId}`)) {
    await w.nav('Orders');
    await w.click(w.row(c.data.orderNo).getByRole('link').first());
  }
  await w.page.getByText(label, { exact: true }).first().waitFor({ timeout: 15_000 });
  await w.show(w.page.locator('.page-head, h1').first());
}

/** Dealer places a new-vehicle order on the web for the case's vehicle; waits for validation to finish. */
export function placeOrder(vehicle: string, expect: 'CONFIRMED' | 'REJECTED'): Step {
  return {
    who: 'dealer',
    say: `Dealer places a new-vehicle order for the ${vehicle}; validation ${expect === 'CONFIRMED' ? 'passes and the order is confirmed' : 'rejects it'}`,
    async run(c) {
      const v = c.vehicle(vehicle);
      const w = await c.web.as('dealer');
      await w.nav('Place order');
      await w.select('Order type', 'New vehicle');
      await w.select('OEM (optional)', v.oem === 'ZENMO' ? 'Zenmo' : 'Kranti');
      await w.type('Registration number', v.regnNo);
      await w.type('Chassis number', v.chassisNo);
      await w.type('Engine number', v.orderEngineNo);
      await w.type('Owner name', `Demo owner ${c.case.id}`);
      await w.type('Owner mobile', '9000099001');
      await w.clickButton('Place order');
      await w.page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 15_000 });
      c.data.orderId = w.page.url().split('/').pop();
      const o = await c.api.waitStatus(c.data.orderId, [expect, expect === 'CONFIRMED' ? 'REJECTED' : 'CONFIRMED']);
      c.data.orderNo = o.orderNo;
      if (o.status !== expect) throw new Error(`Order ${o.orderNo} is ${o.status}, expected ${expect}${o.rejectionReason ? `: ${o.rejectionReason}` : ''}`);
      await c.say(`${o.orderNo} is ${expect === 'CONFIRMED' ? 'Confirmed' : `Rejected: ${o.rejectionReason}`}`);
      await w.page.getByText(expect === 'CONFIRMED' ? 'Confirmed' : 'Rejected', { exact: true }).first().waitFor({ timeout: 15_000 });
    },
  };
}

/** Opens the order's Validation tab and keeps the step results on screen. */
export const showValidation: Step = {
  who: 'dealer',
  say: 'The Validation tab shows each check: OEM vehicle data, VAHAN, state rules and pricing',
  async run(c) {
    const w = await c.web.as('dealer');
    await w.click(w.page.getByRole('tab', { name: /Validation/ }));
    await w.show(w.page.locator('table').last(), c.pace.read * 1.5);
  },
};

/** Keeps the order page on screen once it reaches `status` (asynchronous steps such as the VAHAN post). */
export function expectStatus(status: string, label: string, timeoutMs = 60_000): Step {
  return {
    who: 'dealer',
    say: `The order reaches "${label}"`,
    async run(c) {
      await c.api.waitStatus(c.data.orderId, [status], timeoutMs);
      await showOrderStatus(c, label);
    },
  };
}

export const cancelOrder: Step = {
  who: 'dealer',
  say: 'Dealer cancels the confirmed order with a reason; the wallet hold is released',
  async run(c) {
    const w = await c.web.as('dealer');
    await w.clickButton('Cancel order');
    await w.type(w.field('Reason', w.modal()), 'Customer changed the booking');
    await w.clickButton('Cancel order', w.modal());
    await c.api.waitStatus(c.data.orderId, ['CANCELLED']);
    await w.waitText('Cancelled', 15_000);
    await w.show(w.page.getByText(/^Cancelled:/).first());
  },
};

export const showWallet: Step = {
  who: 'dealer',
  say: 'My wallet: the hold for the order and the refund of the same amount',
  async run(c) {
    const w = await c.web.as('dealer');
    await w.nav('My wallet');
    await w.waitText('Statement');
    await sleep(300);
    await w.show(w.page.locator('tbody tr').filter({ hasText: 'REFUND' }).first(), c.pace.read * 1.5);
  },
};

/** Fitment details (photos, VAHAN reply) on the order page. */
export const showFitment: Step = {
  who: 'dealer',
  say: 'The order page shows the fitment photos and the VAHAN reply',
  async run(c) {
    const w = await c.web.as('dealer');
    await showOrderStatus(c, 'Completed');
    await w.click(w.page.getByRole('tab', { name: /Fitment & VAHAN/ }));
    await w.show(w.page.locator('.card').last(), c.pace.read * 1.5);
  },
};
