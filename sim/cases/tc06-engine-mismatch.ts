import { placeOrder, showValidation } from '../scenes/orders';
import type { TestCase } from '../core/types';

export const tc06: TestCase = {
  id: 'TC-06',
  title: 'Chassis and engine do not match → rejected',
  kind: 'error',
  goal: "An order whose engine number differs from the OEM's record for that chassis is rejected.",
  expected: ['Rejected at "OEM vehicle data": engine … does not match the record for chassis …', 'No wallet hold'],
  vehicles: [{ name: 'car', category: 'LMV', engineMismatch: true, title: 'Car ordered with a wrong engine number' }],
  steps: [placeOrder('car', 'REJECTED'), showValidation],
};
