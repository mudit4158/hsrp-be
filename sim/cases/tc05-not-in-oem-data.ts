import { placeOrder, showValidation } from '../scenes/orders';
import type { TestCase } from '../core/types';

export const tc05: TestCase = {
  id: 'TC-05',
  title: 'Chassis not in the OEM data → rejected',
  kind: 'error',
  goal: 'An order for a chassis the OEM never reported is rejected at the first validation step; no money is held.',
  expected: ["Rejected at \"OEM vehicle data\": chassis … is not in Kranti Autos (fictional)'s vehicle data", 'No wallet hold; the owner gets the rejection SMS'],
  vehicles: [{ name: 'bike', category: '2WN', inOemFile: false, title: 'Two-wheeler left out of the OEM file' }],
  steps: [placeOrder('bike', 'REJECTED'), showValidation],
};
