import { cancelOrder, placeOrder, showWallet } from '../scenes/orders';
import type { TestCase } from '../core/types';

export const tc07: TestCase = {
  id: 'TC-07',
  title: 'Cancelled after confirmation → wallet refunded',
  kind: 'error',
  goal: 'A confirmed order cancelled before production returns its amount to the dealer wallet.',
  expected: ['Cancelled with the reason on the order', 'Wallet statement: HOLD then REFUND of the same amount'],
  vehicles: [{ name: 'car', category: 'LMV', title: 'Car, cancelled after confirmation' }],
  steps: [placeOrder('car', 'CONFIRMED'), cancelOrder, showWallet],
};
