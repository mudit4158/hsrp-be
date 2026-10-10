export const VEHICLE_REGISTRY = Symbol('VehicleRegistry');

/** Field names follow a public sample from one state's VAHAN integration; the real contract is unconfirmed (D3). */
export interface VahanLookupRequest {
  regnNO: string;
  /** Last five characters of the chassis number. */
  chasisNo: string;
  /** Last five characters of the engine number. */
  engineNo: string;
  userId: string;
}

export interface VahanLookupReply {
  message: string;
  fuel: string;
  maker: string;
  vchType: string;
  norms: string;
  vchCatg: string;
  regnDate: string;
  hsrpFrontLaserCode: string;
  hsrpRearLaserCode: string;
  stateCd: string;
  offCd: string;
}

export interface VahanFitmentRequest {
  regnNO: string;
  chasisNo: string;
  ordertype: string;
  hsrpFrontLaserCode: string;
  hsrpRearLaserCode: string;
  /** dd-mm-yyyy */
  fixationdate: string;
}

/** Thrown when the registry cannot be reached; callers retry. */
export class RegistryUnavailableError extends Error {}

export interface VehicleRegistry {
  lookup(req: VahanLookupRequest): Promise<VahanLookupReply>;
  /** Returns VAHAN's reply text; the caller parses it for success. */
  recordFitment(req: VahanFitmentRequest): Promise<string>;
  uploadInventory(req: { stationCode: string; laserCodes: string[] }): Promise<void>;
}
