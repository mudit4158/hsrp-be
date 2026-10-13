import { expectStatus, placeOrder } from '../scenes/orders';
import { phoneFitment, phoneInward } from '../scenes/phone';
import { createChallan, issueJobCard, qcPass, stickerSkipped, uploadPlatePhotos } from '../scenes/station';
import type { TestCase } from '../core/types';

export const tc03: TestCase = {
  id: 'TC-03',
  title: 'New two-wheeler: order to completion (sticker skipped)',
  kind: 'happy',
  goal: 'The same lifecycle for a two-wheeler; no third sticker is needed, so that step is skipped automatically.',
  expected: ['Completed', 'Plates 285×45 front and 200×100 rear', 'No sticker print'],
  vehicles: [{ name: 'bike', category: '2WN', title: 'New two-wheeler, valid' }],
  steps: [
    placeOrder('bike', 'CONFIRMED'),
    issueJobCard(),
    uploadPlatePhotos(),
    qcPass,
    stickerSkipped,
    createChallan(),
    phoneInward(),
    phoneFitment(),
    expectStatus('COMPLETED', 'Completed'),
    {
      who: 'system',
      say: 'Remember this order for the reports case',
      async run(c) {
        c.run.shared.completedBike = { orderId: c.data.orderId, orderNo: c.data.orderNo };
      },
    },
  ],
};
