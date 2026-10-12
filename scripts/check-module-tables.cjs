#!/usr/bin/env node
/**
 * Rule 7: each module owns its tables; other modules use its service, not its tables.
 * Every prisma/schema/*.prisma file starts with `// owner: <folder>`. This check fails when code in one
 * module reads or writes a model (Prisma delegate) or table (raw SQL) owned by another module.
 * The seed is exempt: it writes fixtures for every module.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const schemaDir = path.join(root, 'prisma', 'schema');
const EXEMPT = [/^src\/seed\//, /\.spec\.ts$/, /^src\/test\//];

const delegateOwner = new Map();
const tableOwner = new Map();
for (const f of fs.readdirSync(schemaDir).filter((f) => f.endsWith('.prisma'))) {
  const text = fs.readFileSync(path.join(schemaDir, f), 'utf8');
  const owner = (text.match(/^\/\/ owner: (\S+)/m) || [])[1];
  if (!owner) {
    console.error(`${f}: missing "// owner: <folder>" line`);
    process.exit(1);
  }
  for (const m of text.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
    delegateOwner.set(m[1][0].toLowerCase() + m[1].slice(1), owner);
    const map = (m[2].match(/@@map\("([^"]+)"\)/) || [])[1];
    if (map) tableOwner.set(map, owner);
  }
}
const owners = [...new Set([...delegateOwner.values()])].sort((a, b) => b.length - a.length);
const ownerOf = (file) => owners.find((o) => file === o || file.startsWith(o + '/'));

const ops = 'findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|create|createMany|update|updateMany|upsert|delete|deleteMany|count|groupBy|aggregate';
const delegateRe = new RegExp(`\\b(?:prisma|tx|db)\\.(\\w+)\\.(?:${ops})\\b`, 'g');
const tableRe = /\b((?:core|util|adp|platform)_[a-z0-9_]+)\b/g;

const errors = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) check(p);
  }
}
function check(abs) {
  const rel = path.relative(root, abs).split(path.sep).join('/');
  if (EXEMPT.some((r) => r.test(rel))) return;
  const mine = ownerOf(rel);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(delegateRe)) {
      const owner = delegateOwner.get(m[1]);
      if (owner && owner !== mine) errors.push(`${rel}:${i + 1} uses ${m[1]} (owned by ${owner})`);
    }
    for (const m of line.matchAll(tableRe)) {
      const owner = tableOwner.get(m[1]);
      if (owner && owner !== mine) errors.push(`${rel}:${i + 1} touches table ${m[1]} (owned by ${owner})`);
    }
  });
}
walk(path.join(root, 'src'));

if (errors.length) {
  console.error(`Module table ownership check failed (${errors.length}):\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log(`Module table ownership: OK (${delegateOwner.size} models, ${owners.length} owning modules)`);
