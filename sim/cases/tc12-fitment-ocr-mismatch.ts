import { runReport } from '../scenes/admin';
import { expectStatus, placeOrder } from '../scenes/orders';
import { phoneFitment, phoneInward } from '../scenes/phone';
import { createChallan, issueJobCard, qcPass, stickerSkipped, uploadPlatePhotos } from '../scenes/station';
import type { TestCase } from '../core/types';

export const tc12: TestCase = {
  id: 'TC-12',
  title: 'Fitment photo shows another number → fitment refused → retaken → completed',
  kind: 'error',
  goal: "OCR at fitment refuses a fitment whose plate photo does not read the order's registration number (wrong vehicle or wrong plate).",
  expected: [
    'The fitment is refused; the dealer app lists it as failed with the reason; the order stays Inwarded',
    'With the right photos the fitment is recorded and the order completes',
    'Plate photo checks (OCR) report: the refused fitment reading and the passing one',
  ],
  vehicles: [{ name: 'bike', category: '2WN', title: 'Two-wheeler first photographed with another vehicle\'s plate' }],
  steps: [
    placeOrder('bike', 'CONFIRMED'),
    issueJobCard(),
    uploadPlatePhotos(),
    qcPass,
    stickerSkipped,
    createChallan(),
    phoneInward(),
    phoneFitment('REFUSED'),
    phoneFitment(),
    expectStatus('COMPLETED', 'Completed'),
    runReport('Plate photo checks (OCR)', (c) => ({ 'Order or registration': c.data.orderNo }), 'Plate photo checks (OCR): the refused fitment photo and the accepted ones'),
  ],
};
