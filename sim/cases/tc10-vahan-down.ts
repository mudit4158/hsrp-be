import { replayVahanPosts, showVahanRetrying, vahanMode } from '../scenes/admin';
import { expectStatus, placeOrder } from '../scenes/orders';
import { phoneFitment, phoneInward } from '../scenes/phone';
import { createChallan, issueJobCard, qcPass, stickerSkipped, uploadPlatePhotos } from '../scenes/station';
import type { TestCase } from '../core/types';

export const tc10: TestCase = {
  id: 'TC-10',
  title: 'VAHAN down at fitment → retry and replay → completed',
  kind: 'error',
  goal: 'When VAHAN is unreachable the fitment is kept and the VAHAN post retried; a replay completes the order.',
  expected: ['Fitted while VAHAN is down; the post waits in the retry queue', 'Completed after VAHAN is back and the posts are replayed'],
  vehicles: [{ name: 'bike', category: '2WN', title: 'Two-wheeler fitted while VAHAN is down' }],
  steps: [
    placeOrder('bike', 'CONFIRMED'),
    issueJobCard(),
    uploadPlatePhotos(),
    qcPass,
    stickerSkipped,
    createChallan(),
    phoneInward(),
    vahanMode('down'),
    phoneFitment('FITTED'),
    showVahanRetrying,
    vahanMode('normal'),
    replayVahanPosts,
    expectStatus('COMPLETED', 'Completed'),
  ],
};
