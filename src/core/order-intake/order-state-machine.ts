import type { OrderStatus } from '@hsrp/contracts';

/**
 * The order lifecycle (handover section 7). Every status change goes through `assertTransition`.
 * DISPATCHED → STICKER_PRINTED happens only when a challan is cancelled (decision D21).
 */
export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  RECEIVED: ['VALIDATED', 'REJECTED', 'CANCELLED'],
  VALIDATED: ['AWAITING_APPROVAL', 'AWAITING_PAYMENT', 'CONFIRMED', 'REJECTED', 'CANCELLED'],
  AWAITING_APPROVAL: ['AWAITING_PAYMENT', 'CONFIRMED', 'REJECTED', 'CANCELLED'],
  AWAITING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['ISSUED', 'CANCELLED'],
  ISSUED: ['QC_PASSED', 'REJECTION_REVIEW'],
  QC_PASSED: ['STICKER_PRINTED'],
  STICKER_PRINTED: ['DISPATCHED'],
  DISPATCHED: ['INWARDED', 'REJECTION_REVIEW', 'STICKER_PRINTED'],
  INWARDED: ['FITTED'],
  FITTED: ['COMPLETED'],
  REJECTION_REVIEW: ['CONFIRMED', 'QC_PASSED', 'INWARDED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const FINAL_STATUSES: readonly OrderStatus[] = ['COMPLETED', 'REJECTED', 'CANCELLED'];

/** "Any before ISSUED → CANCELLED". */
export const CANCELLABLE: readonly OrderStatus[] = ['RECEIVED', 'VALIDATED', 'AWAITING_APPROVAL', 'AWAITING_PAYMENT', 'CONFIRMED'];

export class TransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Order cannot move from ${from} to ${to}`);
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

/** Where a customer/dealer/OEM order goes once validated. */
export function routeAfterValidation(o: { orderType: string; channel: string }): OrderStatus {
  if (o.orderType === 'REPLACEMENT') return 'AWAITING_APPROVAL';
  if (o.channel === 'CUSTOMER_PORTAL') return 'AWAITING_PAYMENT';
  return 'CONFIRMED';
}

/** After operations approve a replacement: customers still pay; dealer and OEM orders are confirmed. */
export function routeAfterApproval(o: { channel: string }): OrderStatus {
  return o.channel === 'CUSTOMER_PORTAL' ? 'AWAITING_PAYMENT' : 'CONFIRMED';
}

/** Positions in a plate set. */
export function positionsOf(plateSet: string): string[] {
  if (plateSet === 'FRONT') return ['FRONT'];
  if (plateSet === 'REAR') return ['REAR'];
  return ['FRONT', 'REAR'];
}
