#!/usr/bin/env node
/**
 * Documentation and consistency checks for the HSRP DMS repos (hsrp-be, hsrp-fe, hsrp-mobile-app).
 * The same file lives in each repo; it detects which repo it is running in.
 *
 *   node scripts/docs-check.mjs            check the working tree
 *   node scripts/docs-check.mjs --staged   also look at the staged files (used by the pre-commit hook)
 *
 * Errors (exit 1) block a commit; warnings only print. See AGENTS.md and the maintain-docs skill.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staged = process.argv.includes('--staged');
const errors = [];
const warnings = [];
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

const pkg = exists('package.json') ? JSON.parse(read('package.json')) : null;
const repo = pkg?.name === 'hsrp-be' ? 'be' : pkg?.name === 'hsrp-fe' ? 'fe' : exists('settings.gradle.kts') ? 'android' : 'unknown';
if (repo === 'unknown') {
  console.error('[docs-check] Cannot tell which HSRP repo this is.');
  process.exit(1);
}

// 1. Required documents ----------------------------------------------------------------------------------
const required = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/TRACKER.md', '.claude/skills/maintain-docs/SKILL.md', '.githooks/pre-commit'];
if (repo === 'be') required.push('docs/DECISIONS.md');
for (const f of required) if (!exists(f)) errors.push(`missing ${f}`);

// 2. AGENTS.md and TRACKER.md carry a current review date -------------------------------------------------
const dateLine = (rel, label) => {
  if (!exists(rel)) return;
  const m = read(rel).match(new RegExp(`${label}:?\\*{0,2}\\s*(\\d{1,2} \\w{3} \\d{4})`));
  if (!m) errors.push(`${rel}: add a "${label}: <d Mon yyyy>" line`);
  else {
    const days = (Date.now() - Date.parse(m[1])) / 86400_000;
    if (days > 30) warnings.push(`${rel}: "${label}" is ${Math.floor(days)} days old; review it`);
  }
};
dateLine('AGENTS.md', 'Last updated');
dateLine('docs/TRACKER.md', 'Last reviewed');

// 3. Tracker rows: unique IDs, valid status ----------------------------------------------------------------
const STATUSES = new Set(['Open', 'In progress', 'Blocked', 'Done']);
if (exists('docs/TRACKER.md')) {
  const seen = new Map();
  let statusCol = -1;
  read('docs/TRACKER.md')
    .split('\n')
    .forEach((line, i) => {
      if (!line.startsWith('|')) {
        statusCol = -1;
        return;
      }
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells[0] === 'ID') {
        statusCol = cells.indexOf('Status');
        return;
      }
      const id = cells[0];
      if (!/^[A-Z]{1,3}-\d{2}$/.test(id)) return;
      if (seen.has(id)) errors.push(`docs/TRACKER.md:${i + 1} duplicate ID ${id} (also line ${seen.get(id)})`);
      seen.set(id, i + 1);
      if (statusCol >= 0 && !STATUSES.has(cells[statusCol])) errors.push(`docs/TRACKER.md:${i + 1} ${id} has status "${cells[statusCol]}" (use ${[...STATUSES].join(', ')})`);
    });
}

// 4. Decision log numbering (backend owns it) --------------------------------------------------------------
if (repo === 'be' && exists('docs/DECISIONS.md')) {
  const nums = [...read('docs/DECISIONS.md').matchAll(/^\| D(\d+) \|/gm)].map((m) => Number(m[1]));
  nums.forEach((n, i) => {
    if (n !== i + 1) errors.push(`docs/DECISIONS.md: expected D${i + 1} but found D${n} (numbers must be unique and continuous)`);
  });
}

// 5. Every package script is documented in README.md or AGENTS.md ------------------------------------------
if (pkg?.scripts) {
  const docs = ['README.md', 'AGENTS.md'].filter(exists).map(read).join('\n');
  for (const s of Object.keys(pkg.scripts)) {
    if (['prepare', 'start', 'preview'].includes(s)) continue;
    if (!docs.includes(`pnpm ${s}`) && !docs.includes(`pnpm run ${s}`)) errors.push(`script "${s}" is not documented (mention \`pnpm ${s}\` in README.md or AGENTS.md)`);
  }
}

// 6. Frontend: the contracts copy must match the backend ----------------------------------------------------
if (repo === 'fe' && exists('scripts/sync-contracts.mjs')) {
  try {
    execSync('node scripts/sync-contracts.mjs --check', { cwd: root, stdio: 'pipe' });
  } catch (e) {
    errors.push(String(e.stderr || e.stdout || e.message).trim());
  }
}

// 7. Staged changes ---------------------------------------------------------------------------------------
if (staged) {
  let files = [];
  try {
    files = execSync('git diff --cached --name-only --diff-filter=ACMRD', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    warnings.push('could not read staged files');
  }
  const isDoc = (f) => f.endsWith('.md') || f.startsWith('docs/') || f.startsWith('.claude/');
  const code = files.filter((f) => !isDoc(f) && !/(^|\/)(pnpm-lock\.yaml|\.gitignore|\.gitattributes)$/.test(f));
  if (code.length && !files.some(isDoc)) {
    warnings.push(`code changed (${code.slice(0, 4).join(', ')}${code.length > 4 ? ', …' : ''}) but no documentation is staged. ` +
      'If the change affects behaviour, setup, commands, decisions or open items, update README.md / AGENTS.md / docs/TRACKER.md (see the maintain-docs skill).');
  }
  if (repo === 'be') {
    const schema = files.filter((f) => f.startsWith('prisma/schema/') && f.endsWith('.prisma'));
    const migration = files.some((f) => /^prisma\/schema\/migrations\/[^/]+\/migration\.sql$/.test(f));
    if (schema.length && !migration) errors.push(`Prisma schema changed (${schema.join(', ')}) without a new migration under prisma/schema/migrations/`);
  }
  if (repo === 'fe' && files.some((f) => f.startsWith('src/contracts/')) && !process.env.CONTRACTS_SYNCED) {
    warnings.push('src/contracts changed: it must only change through `pnpm contracts:sync` from the backend.');
  }
}

for (const w of warnings) console.warn(`[docs-check] WARN ${w}`);
for (const e of errors) console.error(`[docs-check] ERROR ${e}`);
if (errors.length) {
  console.error(`[docs-check] ${errors.length} problem(s). Fix them (maintain-docs skill), or commit with --no-verify only if you really must.`);
  process.exit(1);
}
console.log(`[docs-check] OK (${repo}${warnings.length ? `, ${warnings.length} warning(s)` : ''})`);
