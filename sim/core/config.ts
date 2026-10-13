import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the simulator finds the running system. Override any of these with environment variables. */
export const CONFIG = {
  webUrl: process.env.SIM_WEB_URL ?? 'http://localhost:8080',
  apiUrl: process.env.SIM_API_URL ?? 'http://localhost:3000',
  /** adb serial of the emulator (or phone) running the debug dealer app. */
  adbSerial: process.env.SIM_ADB_SERIAL ?? 'emulator-5554',
  adbPath: process.env.SIM_ADB ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'),
  /** Local port forwarded to the app's automation bridge (debug builds only). */
  bridgePort: Number(process.env.SIM_BRIDGE_PORT ?? 7777),
  /** Screen width (px) left free on the right of the browser for the emulator window. */
  phonePanelWidth: Number(process.env.SIM_PHONE_PANEL ?? 470),
  /** Installed browser Playwright drives: chrome or msedge. No browser is downloaded. */
  browserChannel: process.env.SIM_BROWSER ?? 'chrome',
  dealerCode: 'WB01',
  oemCode: 'KRANTI',
  oemName: 'Kranti Autos (fictional)',
  users: { admin: 'admin', station: 'station.kol', dealer: 'dealer.wb01' },
  outputDir: join(__dirname, '..', 'output'),
};

/** The demo password: SEED_PASSWORD from the backend's .env (never printed). */
export function seedPassword(): string {
  if (process.env.SEED_PASSWORD) return process.env.SEED_PASSWORD;
  const envFile = join(__dirname, '..', '..', '.env');
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('SEED_PASSWORD='));
    if (line) return line.slice('SEED_PASSWORD='.length).trim();
  }
  throw new Error('SEED_PASSWORD not found: set it in hsrp-be/.env or the environment');
}

/** Pace presets. Times in ms. `read` is how long a result stays on screen before the run moves on. */
export const SPEEDS = {
  slow: { move: 650, afterClick: 750, typeDelay: 70, read: 2600, phoneAfterTap: 850, caseCard: 6000 },
  normal: { move: 380, afterClick: 380, typeDelay: 38, read: 1500, phoneAfterTap: 450, caseCard: 3500 },
  fast: { move: 220, afterClick: 180, typeDelay: 15, read: 700, phoneAfterTap: 220, caseCard: 1500 },
};
export type Pace = (typeof SPEEDS)['normal'];
