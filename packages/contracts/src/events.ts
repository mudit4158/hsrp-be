/**
 * Domain events. Core modules publish these through the transactional outbox.
 * Utility modules publish generic events that carry subjectType/subjectId only.
 */
export const CORE_EVENTS = [
  'OrderReceived',
  'OrderValidated',
  'OrderRejected',
  'OrderConfirmed',
  'OrderCancelled',
  'OrderStatusChanged',
  'PlateIssued',
  'QcPassed',
  'PlatePhotosChecked',
  'QcRejected',
  'StickerPrinted',
  'ChallanCreated',
  'ChallanInwarded',
  'PlateRejectedByDealer',
  'FitmentRecorded',
  'FitmentPosted',
  'OrderCompleted',
  'RejectionApproved',
  'RejectionDisapproved',
] as const;
export type CoreEventType = (typeof CORE_EVENTS)[number];

export const UTILITY_EVENTS = [
  'PaymentSucceeded',
  'PaymentFailed',
  'PaymentRefunded',
  'ApprovalRequested',
  'ApprovalDecided',
  'NotificationQueued',
  'TicketCreated',
  'TicketUpdated',
  'ImportRowsReady',
  'VehicleCheckRequested',
  'ScheduledTick',
] as const;
export type UtilityEventType = (typeof UTILITY_EVENTS)[number];

export interface GenericSubjectEvent {
  subjectType: string;
  subjectId: string;
}

export interface PaymentSucceededEvent extends GenericSubjectEvent {
  paymentId: string;
  amountPaise: number;
}

export interface ApprovalDecidedEvent extends GenericSubjectEvent {
  approvalId: string;
  approvalType: string;
  decision: 'APPROVED' | 'REJECTED';
  remarks: string;
  decidedBy: string;
}

export interface OrderEvent {
  orderId: string;
  orderNo: string;
  status?: string;
  reason?: string;
}
