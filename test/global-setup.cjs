// Creates the test database if needed and applies migrations to it.
const { execSync } = require('node:child_process');
const path = require('node:path');

module.exports = async () => {
  require('./env.cjs');
  const url = new URL(process.env.TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const admin = new URL(url.toString());
  admin.pathname = '/postgres';
  const { PrismaClient } = require('@prisma/client');
  const client = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  const rows = await client.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = '${dbName}'`);
  if (!rows.length) await client.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  await client.$disconnect();
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }, stdio: 'ignore' });
};
