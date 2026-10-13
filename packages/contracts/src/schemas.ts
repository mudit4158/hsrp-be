import { z } from 'zod';
import {
  ORDER_TYPES,
  PLATE_POSITIONS,
  PLATE_SETS,
  REPLACEMENT_REASONS,
  VAHAN_MODES,
  VEHICLE_CLASSES,
  VEHICLE_TYPES,
} from './enums';

const regnNo = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}[0-9A-Z]{4,9}$/, 'Registration number looks wrong (e.g. WB02AB1234)');
const last5 = z.string().trim().toUpperCase().min(5).max(30);
const mobile = z.string().trim().regex(/^[6-9][0-9]{9}$/, 'Ten-digit Indian mobile number');

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
});

// ---------- identity ----------
export const LoginRequest = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  deviceId: z.string().min(4).max(100).optional(),
  deviceName: z.string().max(100).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const OtpRequest = z.object({
  purpose: z.enum(['ORDER_CONFIRM', 'STATUS', 'SUPPORT']),
  mobile: mobile.optional(),
  regnNo: regnNo.optional(),
  chassisLast5: last5.optional(),
  ticketNo: z.string().optional(),
});
export type OtpRequest = z.infer<typeof OtpRequest>;

export const OtpVerify = z.object({ otpRef: z.string().uuid(), code: z.string().min(4).max(8) });
export type OtpVerify = z.infer<typeof OtpVerify>;

// ---------- orders ----------
export const VehicleIdentity = z.object({
  regnNo,
  chassisNo: z.string().trim().toUpperCase().min(5).max(30),
  engineNo: z.string().trim().toUpperCase().min(5).max(30),
});

export const CreateOrderRequest = VehicleIdentity.extend({
  orderType: z.enum(ORDER_TYPES).default('NEW'),
  plateSet: z.enum(PLATE_SETS).default('BOTH'),
  replacementReason: z.enum(REPLACEMENT_REASONS).optional(),
  evidenceFileId: z.string().uuid().optional(),
  dealerCode: z.string().optional(),
  oemCode: z.string().optional(),
  stateCode: z.string().length(2).optional(),
  ownerName: z.string().max(100).optional(),
  mobile: mobile.optional(),
  email: z.string().email().optional(),
  remarks: z.string().max(500).optional(),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequest>;

export const OemOrderRequest = z.object({
  oemOrderRef: z.string().min(1).max(60),
  dealerCode: z.string().min(1),
  regnNo,
  chassisNo: z.string().trim().toUpperCase().min(5).max(30),
  engineNo: z.string().trim().toUpperCase().min(5).max(30),
  ownerName: z.string().max(100).optional(),
  mobile: mobile.optional(),
});
export type OemOrderRequest = z.infer<typeof OemOrderRequest>;

/** One row of an OEM vehicle data file (vehicles built and supplied to a dealer). */
export const OemVehicleRecord = z.object({
  chassisNo: z.string().trim().toUpperCase().min(5).max(30),
  engineNo: z.string().trim().toUpperCase().min(5).max(30),
  model: z.string().trim().min(1).max(80),
  vahanCategory: z.string().trim().toUpperCase().max(5).optional(),
  dealerCode: z.string().trim().toUpperCase().min(1),
  invoiceNo: z.string().trim().max(40).optional(),
  invoiceDate: z.string().trim().max(10).optional(),
});
export type OemVehicleRecord = z.infer<typeof OemVehicleRecord>;

export const CancelOrderRequest = z.object({ reason: z.string().min(3).max(300) });

export const OrderListQuery = PaginationQuery.extend({
  status: z.string().optional(),
  channel: z.string().optional(),
  dealerId: z.string().optional(),
  stationId: z.string().optional(),
  stateCode: z.string().optional(),
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

// ---------- customer portal ----------
export const VehicleCheckRequest = z.object({
  stateCode: z.string().length(2),
  regnNo,
  chassisLast5: last5,
  engineLast5: last5,
});
export type VehicleCheckRequest = z.infer<typeof VehicleCheckRequest>;

export const CustomerOrderRequest = z.object({
  vehicleCheckId: z.string().uuid(),
  otpRef: z.string().uuid(),
  otpCode: z.string().min(4).max(8),
  dealerCode: z.string(),
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotStart: z.string().regex(/^\d{2}:\d{2}$/),
  ownerName: z.string().min(2).max(100),
  mobile,
  email: z.string().email().optional(),
  orderType: z.enum(ORDER_TYPES).default('OLD'),
  plateSet: z.enum(PLATE_SETS).default('BOTH'),
  replacementReason: z.enum(REPLACEMENT_REASONS).optional(),
  evidenceFileId: z.string().uuid().optional(),
});
export type CustomerOrderRequest = z.infer<typeof CustomerOrderRequest>;

export const RescheduleRequest = z.object({
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotStart: z.string().regex(/^\d{2}:\d{2}$/),
});

// ---------- station ----------
export const PendingIssuanceQuery = z.object({
  stationId: z.string().optional(),
  dealerId: z.string().optional(),
  date: z.string().optional(),
  vehicleClass: z.enum(VEHICLE_CLASSES).optional(),
  vehicleType: z.enum(VEHICLE_TYPES).optional(),
});

export const IssuanceRequest = z.object({
  stationId: z.string(),
  dealerId: z.string(),
  orderIds: z.array(z.string()).min(1).max(200),
  boxNos: z.array(z.string().min(1)).min(1).max(20),
});
export type IssuanceRequest = z.infer<typeof IssuanceRequest>;

export const BoxLockRequest = z.object({ boxNos: z.array(z.string()).min(1).max(20) });

export const QcRequest = z.object({
  result: z.enum(['PASS', 'REJECT']),
  rejectPositions: z.array(z.enum(PLATE_POSITIONS)).optional(),
  reason: z.string().max(300).optional(),
});
export type QcRequest = z.infer<typeof QcRequest>;

export const SwitchLaserRequest = z.object({
  position: z.enum(PLATE_POSITIONS),
  newLaserCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}\d{10}$/),
  reason: z.string().min(3).max(200),
});

export const StickerPrintRequest = z.object({ reprint: z.boolean().default(false), reason: z.string().max(200).optional() });

export const CreateChallanRequest = z.object({
  stationId: z.string(),
  dealerId: z.string(),
  orderIds: z.array(z.string()).min(1).max(200),
});

export const InwardRequest = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string(),
        decision: z.enum(['ACCEPT', 'REJECT']),
        reason: z.string().max(300).optional(),
      }),
    )
    .min(1),
});
export type InwardRequest = z.infer<typeof InwardRequest>;

export const DecisionRequest = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  remarks: z.string().trim().min(3, 'Remarks are mandatory').max(500),
});
export type DecisionRequest = z.infer<typeof DecisionRequest>;

export const FitmentRequest = z.object({
  orderId: z.string(),
  frontLaserCode: z.string().trim().toUpperCase().optional(),
  rearLaserCode: z.string().trim().toUpperCase().optional(),
  fittedAt: z.string().datetime().optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
});
export type FitmentRequest = z.infer<typeof FitmentRequest>;

// ---------- wallet ----------
export const TopUpRequest = z.object({
  amountRupees: z.coerce.number().positive().max(10_000_000),
  reference: z.string().min(2).max(60),
});

// ---------- tickets ----------
export const ComplaintRequest = z.object({
  otpRef: z.string().uuid(),
  otpCode: z.string().min(4).max(8),
  name: z.string().min(2).max(100),
  mobile,
  regnNo: regnNo.optional(),
  category: z.string(),
  description: z.string().min(10).max(2000),
});
export type ComplaintRequest = z.infer<typeof ComplaintRequest>;

export const TicketReplyRequest = z.object({
  message: z.string().min(2).max(2000),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  isPublic: z.boolean().default(true),
});

// ---------- simulator ----------
export const VahanModeRequest = z.object({ mode: z.enum(VAHAN_MODES) });

export const ConfigSetRequest = z.object({
  key: z.string().min(2),
  scopeType: z.enum(['global', 'state', 'oem', 'dealer']).default('global'),
  scopeId: z.string().default('*'),
  value: z.unknown(),
  effectiveFrom: z.string().datetime().optional(),
});
