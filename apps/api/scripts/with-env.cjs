// Loads the monorepo-root .env (if present) and runs the given command with it.
// Usage: node scripts/with-env.cjs <command> [args...]
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const envFile = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const [cmd, ...args] = process.argv.slice(2);
const res = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: process.env });
process.exit(res.status ?? 1);
