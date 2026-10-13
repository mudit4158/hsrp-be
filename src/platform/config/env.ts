import * as fs from 'node:fs';
import * as path from 'node:path';

// When running outside Docker, load the repo-root .env (Docker passes variables directly).
const rootEnv = path.resolve(__dirname, '../../../.env');
if (!process.env.DATABASE_URL && fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) throw new Error(`Missing environment variable ${name}`);
    return fallback;
  }
  return v;
}
const bool = (name: string, fallback: boolean) => (process.env[name] ?? String(fallback)).toLowerCase() === 'true';
const int = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export const env = {
  get databaseUrl() {
    return str('DATABASE_URL');
  },
  port: int('API_PORT', 3000),
  host: str('API_HOST', '0.0.0.0'),
  publicApiUrl: str('PUBLIC_API_URL', 'http://localhost:3000'),
  publicWebUrl: str('PUBLIC_WEB_URL', 'http://localhost:8080'),
  internalApiUrl: str('INTERNAL_API_URL', `http://localhost:${int('API_PORT', 3000)}`),
  jwtSecret: str('JWT_SECRET', 'dev-only-secret-change-me-dev-only-secret'),
  jwtExpiresIn: str('JWT_EXPIRES_IN', '8h'),
  fileLinkSecret: str('FILE_LINK_SECRET', 'dev-only-file-secret'),
  workerEnabled: bool('WORKER_ENABLED', true),
  outboxRetryBaseMs: int('OUTBOX_RETRY_BASE_MS', 5000),
  demoMode: bool('DEMO_MODE', false),
  demoFixedOtp: str('DEMO_FIXED_OTP', '123456'),
  defaultTenantId: str('DEFAULT_TENANT_ID', 't-demo'),
  adapters: {
    vahan: str('VAHAN_ADAPTER', 'mock'),
    payment: str('PAYMENT_ADAPTER', 'mock'),
    message: str('MESSAGE_ADAPTER', 'mock'),
    oem: str('OEM_ADAPTER', 'mock'),
    fileStore: str('FILE_STORE_ADAPTER', 'db'),
    /** Plate OCR: tesseract (real, local) or mock (reads the text test images embed). */
    ocr: str('OCR_ADAPTER', 'tesseract'),
  },
  payu: {
    key: str('PAYU_MERCHANT_KEY', 'MOCKKEY'),
    salt: str('PAYU_MERCHANT_SALT', 'mock-salt-not-secret'),
  },
};
