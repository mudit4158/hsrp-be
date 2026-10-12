import type { Oem, Order, State, VehicleCategory } from '@prisma/client';
import type { VahanLookupReply } from '../ports/vehicle-registry.port';
import { parseDate } from '../shared/subjects';

export interface StateRules {
  /** Send an SMS at every main status change (Odisha demo pack). */
  smsStatusUpdates?: boolean;
  requireMobile?: boolean;
  allowedVehicleClasses?: string[] | null;
  /** Registering office code must start with one of these (e.g. "OD"). */
  rtoPrefixes?: string[] | null;
  publishedPrices?: boolean;
}

export interface StepContext {
  order: Order;
  state: State;
  oem: Oem | null;
  rules: StateRules;
  cutoff: Date;
  vahan?: VahanLookupReply;
  category?: VehicleCategory | null;
}

export type StepResult = { ok: true; message?: string; data?: unknown } | { ok: false; reason: string; data?: unknown };

/** Interprets a VAHAN lookup reply against the order. Pure, unit-tested; the I/O lives in the validation service. */
export function judgeVahanReply(order: Pick<Order, 'orderType' | 'stateCode'>, reply: VahanLookupReply, cutoff: Date, category: VehicleCategory | null): StepResult {
  if (!/^success$/i.test(reply.message.trim())) return { ok: false, reason: `VAHAN: ${reply.message}` };
  if (reply.stateCd && reply.stateCd !== order.stateCode) return { ok: false, reason: `Vehicle is registered in ${reply.stateCd}, not ${order.stateCode}` };
  const hasPlates = Boolean(reply.hsrpFrontLaserCode || reply.hsrpRearLaserCode);
  if (hasPlates && order.orderType !== 'REPLACEMENT') {
    return { ok: false, reason: `HSRP already issued (laser codes ${[reply.hsrpFrontLaserCode, reply.hsrpRearLaserCode].filter(Boolean).join(', ')}); only a replacement order is valid` };
  }
  if (!hasPlates && order.orderType === 'REPLACEMENT') return { ok: false, reason: 'VAHAN shows no HSRP for this vehicle; place a new order instead of a replacement' };
  const regn = parseDate(reply.regnDate);
  if (!regn) return { ok: false, reason: `Unreadable registration date "${reply.regnDate}"` };
  if (order.orderType === 'NEW' && regn < cutoff) {
    return { ok: false, reason: `Registered ${reply.regnDate}, before the new-vehicle cut-off ${cutoff.toISOString().slice(0, 10)}; this is an old-vehicle order` };
  }
  if (order.orderType === 'OLD' && regn >= cutoff) {
    return { ok: false, reason: `Registered ${reply.regnDate}, after the cut-off; new vehicles get HSRP through their dealer` };
  }
  if (!category) return { ok: false, reason: `Unknown VAHAN vehicle category ${reply.vchCatg}` };
  return { ok: true, message: `${reply.maker} · ${reply.vchCatg} · ${reply.norms}` };
}

/** State eligibility rule pack. Pure, unit-tested. */
export function judgeStateRules(order: Pick<Order, 'mobile'>, rules: StateRules, facts: { vehicleClass?: string; offCd?: string }): StepResult {
  if (rules.requireMobile && !order.mobile) return { ok: false, reason: 'This state requires the owner mobile number' };
  if (rules.allowedVehicleClasses?.length && facts.vehicleClass && !rules.allowedVehicleClasses.includes(facts.vehicleClass)) {
    return { ok: false, reason: `Vehicle class ${facts.vehicleClass} is not eligible in this state` };
  }
  if (rules.rtoPrefixes?.length && facts.offCd && !rules.rtoPrefixes.some((p) => facts.offCd!.startsWith(p))) {
    return { ok: false, reason: `Registering office ${facts.offCd} is outside this state's offices` };
  }
  return { ok: true, message: 'Eligible' };
}
