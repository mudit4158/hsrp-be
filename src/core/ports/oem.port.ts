import type { OemOrderRequest } from '@hsrp/contracts';

export const ORDER_SOURCE = Symbol('OrderSource');
export const OEM_VEHICLE_CATALOG = Symbol('OemVehicleCatalog');

/** Inbound order channel from an OEM system, and the status callback back to it. */
export interface OrderSource {
  /** Maps an OEM-specific payload to the canonical OEM order shape. */
  toCanonical(oemCode: string, payload: unknown): OemOrderRequest;
  notifyStatus(oemCode: string, orderRef: string, status: string, reason?: string): Promise<void>;
}

export interface OemVehicleCatalog {
  check(oemCode: string, chassisNo: string): Promise<{ found: boolean; model?: string }>;
}
