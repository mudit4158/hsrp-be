export * from './enums';
export * from './schemas';
export * from './events';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const STATUS_LABELS: Record<string, string> = {
  RECEIVED: 'Received',
  VALIDATED: 'Validated',
  AWAITING_APPROVAL: 'Awaiting approval',
  AWAITING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  ISSUED: 'Issued',
  QC_PASSED: 'QC passed',
  STICKER_PRINTED: 'Sticker printed',
  DISPATCHED: 'Dispatched',
  INWARDED: 'Inwarded',
  FITTED: 'Fitted',
  COMPLETED: 'Completed',
  REJECTION_REVIEW: 'Rejection review',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};
