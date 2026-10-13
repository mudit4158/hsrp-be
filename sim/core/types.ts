import type { Api } from './api';
import type { Pace } from './config';
import type { Phone } from './phone';
import type { Web } from './web';

/** Who performs a step. Web roles each have their own browser window; `phone` is the dealer app on the emulator. */
export type Actor = 'admin' | 'station' | 'dealer' | 'phone' | 'system';

/** A vehicle a test case needs. The data preparation stage registers it in mock VAHAN for this run. */
export interface VehicleNeed {
  /** Name used inside the case, e.g. "car". */
  name: string;
  /** VAHAN category: LMV (car) or 2WN (two-wheeler). */
  category: 'LMV' | '2WN';
  /** Listed in the OEM vehicle data file (default true). */
  inOemFile?: boolean;
  /** Order it with an engine number that does not match the OEM record. */
  engineMismatch?: boolean;
  /** One line for the data sheet. */
  title: string;
  /** The vehicle's OEM: KRANTI (default, prepaid, vehicle data file) or ZENMO (postpaid, API catalogue). */
  oem?: 'KRANTI' | 'ZENMO';
}

/** A vehicle as prepared by the backend (POST /simulator/new-vehicle-demo). */
export interface PreparedVehicle {
  role: string;
  title: string;
  regnNo: string;
  chassisNo: string;
  engineNo: string;
  orderEngineNo: string;
  vchCatg: string;
  model: string;
  inOemFile: boolean;
  oem: 'KRANTI' | 'ZENMO';
}

export interface Step {
  who: Actor;
  /** Shown as the caption while the step runs and printed by `pnpm sim --list`. */
  say: string;
  run(c: Ctx): Promise<void>;
}

export interface TestCase {
  /** TC-nn; cases run in the order of sim/cases/index.ts. */
  id: string;
  title: string;
  kind: 'happy' | 'error';
  /** What the case proves, in one or two sentences. */
  goal: string;
  /** What the viewer should see at the end. */
  expected: string[];
  vehicles?: VehicleNeed[];
  steps: Step[];
}

/** Everything a step can use. `data` is this case's scratch space; `run` is shared by all cases of one run. */
export interface Ctx {
  web: Web;
  phone: Phone;
  api: Api;
  pace: Pace;
  case: TestCase;
  data: Record<string, any>;
  run: RunState;
  vehicle(name: string): PreparedVehicle;
  /** Updates the caption's text inside the current step. */
  say(text: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface RunState {
  id: string;
  vehicles: Record<string, PreparedVehicle>;
  /** Results that later cases may use (e.g. the completed order of TC-02 for the reports case). */
  shared: Record<string, any>;
  oemFileUploaded: boolean;
}
