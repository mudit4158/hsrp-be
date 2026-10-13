import { expectStatus, placeOrder, showFitment, showValidation } from '../scenes/orders';
import { phoneFitment, phoneInward } from '../scenes/phone';
import { createChallan, issueJobCard, printSticker, qcPass, uploadPlatePhotos } from '../scenes/station';
import type { TestCase } from '../core/types';

export const tc02: TestCase = {
  id: 'TC-02',
  title: 'New car: order to completion',
  kind: 'happy',
  goal: 'The full lifecycle of a new car, including the third registration sticker.',
  expected: [
    'Received → Validated → Confirmed → Issued → QC passed → Sticker printed → Dispatched → Inwarded → Fitted → Completed',
    'Fitment photos and the VAHAN reply on the order',
  ],
  vehicles: [{ name: 'car', category: 'LMV', title: 'New car, valid' }],
  steps: [
    placeOrder('car', 'CONFIRMED'),
    showValidation,
    issueJobCard(),
    uploadPlatePhotos(),
    qcPass,
    printSticker,
    createChallan(),
    phoneInward(),
    phoneFitment(),
    expectStatus('COMPLETED', 'Completed'),
    showFitment,
    {
      who: 'system',
      say: 'Remember this order for the reports case',
      async run(c) {
        c.run.shared.completedCar = { orderId: c.data.orderId, orderNo: c.data.orderNo };
      },
    },
  ],
};
