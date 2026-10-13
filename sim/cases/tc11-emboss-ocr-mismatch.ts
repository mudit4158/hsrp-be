import { runReport } from '../scenes/admin';
import { expectStatus, placeOrder } from '../scenes/orders';
import { phoneFitment, phoneInward } from '../scenes/phone';
import { approveRejection, createChallan, issueJobCard, qcPass, qcReject, stickerSkipped, uploadPlatePhotos } from '../scenes/station';
import type { TestCase } from '../core/types';

export const tc11: TestCase = {
  id: 'TC-11',
  title: 'Embossed plate shows another number → OCR fails → re-issued → completed',
  kind: 'error',
  goal: 'The photo check after embossing catches a plate embossed with the wrong number: QC cannot pass it, the plate is rejected and re-issued.',
  expected: [
    'OCR reads a different number on the front plate; QC "Pass" stays disabled',
    'QC rejects the front plate; after approval it is re-issued and its photo reads the right number',
    'Completed; the Plate photo checks (OCR) report shows the failed and the passed reading',
  ],
  vehicles: [{ name: 'bike', category: '2WN', title: 'Two-wheeler whose front plate is embossed with a wrong number' }],
  steps: [
    placeOrder('bike', 'CONFIRMED'),
    issueJobCard(),
    uploadPlatePhotos(['FRONT']),
    qcReject('FRONT', 'Wrong registration number embossed (photo OCR)'),
    approveRejection('QC'),
    issueJobCard('re-issues the front plate on a new job card'),
    uploadPlatePhotos(),
    qcPass,
    stickerSkipped,
    createChallan(),
    phoneInward(),
    phoneFitment(),
    expectStatus('COMPLETED', 'Completed'),
    runReport('Plate photo checks (OCR)', (c) => ({ 'Order or registration': c.data.orderNo }), 'Plate photo checks (OCR): the failed reading of the wrongly embossed plate, then the passing ones'),
  ],
};
