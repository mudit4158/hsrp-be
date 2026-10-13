export const ORDER_STATUSES = [
  'RECEIVED',
  'VALIDATED',
  'AWAITING_APPROVAL',
  'AWAITING_PAYMENT',
  'CONFIRMED',
  'ISSUED',
  'QC_PASSED',
  'STICKER_PRINTED',
  'DISPATCHED',
  'INWARDED',
  'FITTED',
  'COMPLETED',
  'REJECTION_REVIEW',
  'REJECTED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_CHANNELS = ['DEALER_APP', 'STAFF_WEB', 'CUSTOMER_PORTAL', 'OEM_API', 'OEM_FILE'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** NEW = new vehicle (dealer / OEM), OLD = vehicle registered before the cut-off (customer), REPLACEMENT = plates exist already. */
export const ORDER_TYPES = ['NEW', 'OLD', 'REPLACEMENT'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const REPLACEMENT_REASONS = ['DAMAGED', 'THEFT'] as const;
export type ReplacementReason = (typeof REPLACEMENT_REASONS)[number];

export const PLATE_POSITIONS = ['FRONT', 'REAR'] as const;
export type PlatePosition = (typeof PLATE_POSITIONS)[number];

export const PLATE_SETS = ['BOTH', 'FRONT', 'REAR'] as const;
export type PlateSet = (typeof PLATE_SETS)[number];

export const VEHICLE_CLASSES = ['2W', '3W', 'LMV', 'HMV', 'TRAILER'] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const VEHICLE_TYPES = ['NON_TRANSPORT', 'TRANSPORT'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const ROLES = ['ADMIN', 'OPERATIONS', 'STATION_USER', 'DEALER', 'OEM_CLIENT', 'CUSTOMER'] as const;
export type Role = (typeof ROLES)[number];

export const PLATE_STATUSES = ['AVAILABLE', 'ALLOCATED', 'FITTED', 'SCRAPPED'] as const;
export type PlateStatus = (typeof PLATE_STATUSES)[number];

export const INWARD_DECISIONS = ['ACCEPT', 'REJECT'] as const;

export const VALIDATION_STEPS = ['oem-catalogue-check', 'oem-vehicle-data', 'vahan-check', 'state-eligibility-rules'] as const;
export type ValidationStepCode = (typeof VALIDATION_STEPS)[number];

export const VAHAN_MODES = ['normal', 'slow', 'down', 'not-found'] as const;
export type VahanMode = (typeof VAHAN_MODES)[number];

export const PAYMENT_STATUSES = ['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
