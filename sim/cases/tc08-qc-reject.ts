import { runReport } from '../scenes/admin';
import { expectStatus, placeOrder } from '../scenes/orders';
import { phoneFitment, phoneInward } from '../scenes/phone';
import { approveRejection, createChallan, issueJobCard, printSticker, qcPass, qcReject, uploadPlatePhotos } from '../scenes/station';
import type { TestCase } from '../core/types';

export const tc08: TestCase = {
  id: 'TC-08',
  title: 'QC rejects a plate → re-issued → completed',
  kind: 'error',
  goal: 'A plate that fails quality check is scrapped and re-issued; the order still completes.',
  expected: [
    'Rejection review after QC; Confirmed again after approval with only FRONT pending',
    'Completed',
    'Laser code audit: the first front plate QC REJECT and closed; the new one fitted',
  ],
  vehicles: [{ name: 'car', category: 'LMV', title: 'Car whose front plate fails QC' }],
  steps: [
    placeOrder('car', 'CONFIRMED'),
    issueJobCard(),
    uploadPlatePhotos(),
    qcReject('FRONT', 'Hologram misaligned'),
    approveRejection('QC'),
    issueJobCard('re-issues the rejected front plate on a new job card'),
    uploadPlatePhotos(),
    qcPass,
    printSticker,
    createChallan(),
    phoneInward(),
    phoneFitment(),
    expectStatus('COMPLETED', 'Completed'),
    runReport('Laser code audit', (c) => ({ 'Order or registration': c.data.orderNo }), 'Laser code audit: the rejected front plate is closed; the re-issued one is fitted'),
  ],
};
