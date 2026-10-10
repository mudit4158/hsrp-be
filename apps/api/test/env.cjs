// Points every test at the test database and keeps the worker off.
const fs = require('node:fs');
const path = require('node:path');
const rootEnv = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(rootEnv) && !process.env.TEST_DATABASE_URL) process.loadEnvFile(rootEnv);
const testUrl = process.env.TEST_DATABASE_URL || (process.env.DATABASE_URL || '').replace(/\/([^/?]+)(\?|$)/, '/hsrp_test$2');
process.env.DATABASE_URL = testUrl;
process.env.TEST_DATABASE_URL = testUrl;
process.env.WORKER_ENABLED = 'false';
process.env.OUTBOX_RETRY_BASE_MS = '1000';
