import { requestContext } from '../src/platform/context/request-context';
import { PrismaService } from '../src/platform/database/prisma.service';

export const TEST_TENANT = 't-test';

export async function resetDb(prisma: PrismaService) {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

/** Runs `fn` as the system actor of the test tenant (services read the tenant from the request context). */
export const asSystem = <T>(fn: () => Promise<T>) => requestContext.runAsSystem(TEST_TENANT, fn);
