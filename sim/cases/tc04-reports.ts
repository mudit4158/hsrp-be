import { runReport } from '../scenes/admin';
import type { Ctx, TestCase } from '../core/types';

/** The completed car of TC-02 in this run, or else the newest completed order. */
async function subject(c: Ctx): Promise<string> {
  if (c.run.shared.completedCar) return c.run.shared.completedCar.orderNo;
  const list = await c.api.get('/orders?status=COMPLETED&pageSize=1');
  return list.items[0]?.orderNo ?? '';
}

export const tc04: TestCase = {
  id: 'TC-04',
  title: 'Reports and audit trail of the completed orders',
  kind: 'happy',
  goal: 'Everything that happened to a completed order can be traced in the reports.',
  expected: [
    'Order history: every status change with time, trigger and user',
    'Laser code audit: each plate from job card to VAHAN',
    'OEM history: the vehicle file and every order checked against it',
  ],
  steps: [
    {
      who: 'system',
      say: 'Pick the order to trace (the car completed in TC-02)',
      async run(c) {
        c.data.orderNo = await subject(c);
      },
    },
    runReport('Order history', (c) => ({ 'Order or registration': c.data.orderNo }), 'Order history: every status change of the completed car, with time, trigger and user'),
    runReport('Order validation results', (c) => ({ 'Order or registration': c.data.orderNo }), 'Order validation results: OEM vehicle data, VAHAN, state rules and pricing all passed'),
    runReport('Laser code audit', (c) => ({ 'Order or registration': c.data.orderNo }), 'Laser code audit: each plate from job card, QC and challan to inward, fitment and VAHAN'),
    runReport('OEM history', () => ({ OEM: 'KRANTI' }), "OEM history: Kranti's vehicle file and every order checked against it, with the result"),
    runReport('Fitments and VAHAN posts', () => ({}), 'Fitments and VAHAN posts: the fitments, each posted to VAHAN'),
  ],
};
