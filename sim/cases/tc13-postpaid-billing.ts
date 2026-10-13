import { restoreBillTo, runBillingNow, setBillTo, showBillEmail, showCharge, showPostpaidOrder } from '../scenes/billing';
import { placeOrder } from '../scenes/orders';
import { createChallan, issueJobCard, printSticker, qcPass, uploadPlatePhotos } from '../scenes/station';
import type { TestCase } from '../core/types';

export const tc13: TestCase = {
  id: 'TC-13',
  title: 'Postpaid OEM: dispatched plates billed to the dealer',
  kind: 'happy',
  goal: 'For a postpaid OEM the order is confirmed without a wallet hold; once its plates are dispatched it is billed in the cycle to the party set for the OEM × dealer pair.',
  expected: [
    'Zenmo is postpaid; dealer WB01 is set to be billed directly',
    'Order confirmed without a wallet hold; a charge is created (pending), billable after dispatch',
    'Run billing now: a bill to WB01 with the order, PDF opened, e-mail sent to the dealer',
  ],
  vehicles: [{ name: 'car', category: 'LMV', oem: 'ZENMO', title: 'Zenmo car (postpaid OEM)' }],
  steps: [
    setBillTo('ZENMO', 'WB01', 'DEALER'),
    placeOrder('car', 'CONFIRMED'),
    showPostpaidOrder,
    showCharge('PENDING'),
    issueJobCard(),
    uploadPlatePhotos(),
    qcPass,
    printSticker,
    createChallan(),
    showCharge('BILLABLE'),
    runBillingNow('ZENMO'),
    showBillEmail,
    restoreBillTo('ZENMO', 'WB01'),
  ],
};
