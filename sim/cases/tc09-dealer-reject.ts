import { runReport } from '../scenes/admin';
import { expectStatus, placeOrder } from '../scenes/orders';
import { phoneFitment, phoneInward } from '../scenes/phone';
import { approveRejection, createChallan, issueJobCard, qcPass, stickerSkipped, uploadPlatePhotos } from '../scenes/station';
import type { TestCase } from '../core/types';

export const tc09: TestCase = {
  id: 'TC-09',
  title: 'Dealer rejects a plate at inward → new challan → completed',
  kind: 'error',
  goal: 'A plate damaged in transit is rejected by the dealer at inward, re-issued on a new challan and fitted.',
  expected: ['Rejection review after inward', 'Two challans for the order', 'Completed; the Plate rejections report shows the dealer-inward rejection approved'],
  vehicles: [{ name: 'bike', category: '2WN', title: 'Two-wheeler whose rear plate arrives damaged' }],
  steps: [
    placeOrder('bike', 'CONFIRMED'),
    issueJobCard(),
    uploadPlatePhotos(),
    qcPass,
    stickerSkipped,
    createChallan(),
    phoneInward({ REAR: 'Bent in transit' }),
    approveRejection('dealer inward'),
    issueJobCard('re-issues the rejected rear plate on a new job card'),
    uploadPlatePhotos(),
    qcPass,
    createChallan('creates a new challan with only the re-issued rear plate'),
    phoneInward(),
    phoneFitment(),
    expectStatus('COMPLETED', 'Completed'),
    runReport('Plate rejections', () => ({}), 'Plate rejections: the dealer-inward rejection of this order, approved'),
  ],
};
