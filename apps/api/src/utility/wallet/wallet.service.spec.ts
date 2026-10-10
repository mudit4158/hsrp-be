// Utility test: loads only platform + utility code, no core module.
import { asSystem, resetDb } from '../../../test/db';
import { PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { AuditService } from '../audit/audit.service';
import { assertBalanced, availablePaise, canHold } from './ledger-rules';
import { WalletService } from './wallet.service';

describe('ledger rules', () => {
  it('requires balanced journals', () => {
    expect(() => assertBalanced([{ accountId: 'a', amountPaise: 100 }, { accountId: 'b', amountPaise: -100 }])).not.toThrow();
    expect(() => assertBalanced([{ accountId: 'a', amountPaise: 100 }, { accountId: 'b', amountPaise: -99 }])).toThrow(/balance/);
    expect(() => assertBalanced([{ accountId: 'a', amountPaise: 0 }, { accountId: 'b', amountPaise: 0 }])).toThrow();
    expect(() => assertBalanced([{ accountId: 'a', amountPaise: 1.5 }, { accountId: 'b', amountPaise: -1.5 }])).toThrow();
  });
  it('lets the balance go negative down to the credit limit', () => {
    expect(availablePaise(-5_000, 10_000)).toBe(5_000);
    expect(canHold(1_000, 0, 1_000)).toBe(true);
    expect(canHold(1_000, 0, 1_001)).toBe(false);
    expect(canHold(0, 2_000, 2_000)).toBe(true);
  });
});

describe('WalletService (double-entry ledger)', () => {
  const prisma = new PrismaService();
  const wallets = new WalletService(prisma, new AuditService(prisma));
  let walletId: string;
  const subject = (id: string) => ({ subjectType: 'test.subject', subjectId: id });

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb(prisma);
    walletId = (await asSystem(() => wallets.openWallet({ ownerType: 'group', ownerId: 'G1', name: 'Shared wallet', creditLimitPaise: 5_000 }))).id;
    await asSystem(() => wallets.topUp(walletId, 10_000, 'TOPUP-1'));
  });

  it('top-up credits the wallet from the funding account', async () => {
    const s = await asSystem(() => wallets.summary(walletId));
    expect(s).toMatchObject({ balancePaise: 10_000, heldPaise: 0, creditLimitPaise: 5_000, availablePaise: 15_000 });
  });

  it('hold → capture moves money to revenue; release returns it', async () => {
    const h1 = await asSystem(() => wallets.hold(walletId, 3_000, subject('o1')));
    const h2 = await asSystem(() => wallets.hold(walletId, 2_000, subject('o2')));
    expect(await asSystem(() => wallets.summary(walletId))).toMatchObject({ balancePaise: 5_000, heldPaise: 5_000 });
    await asSystem(() => wallets.capture(h1.id));
    await asSystem(() => wallets.release(h2.id));
    expect(await asSystem(() => wallets.summary(walletId))).toMatchObject({ balancePaise: 7_000, heldPaise: 0 });
    // capture is idempotent; a released hold cannot be captured
    await expect(asSystem(() => wallets.capture(h1.id))).resolves.toMatchObject({ status: 'CAPTURED' });
    await expect(asSystem(() => wallets.capture(h2.id))).rejects.toBeInstanceOf(Problem);
  });

  it('refunds a captured hold back to the wallet', async () => {
    const h = await asSystem(() => wallets.hold(walletId, 4_000, subject('o3')));
    await asSystem(() => wallets.capture(h.id));
    await asSystem(() => wallets.refundCaptured(h.id));
    expect((await asSystem(() => wallets.summary(walletId))).balancePaise).toBe(10_000);
  });

  it('uses the credit limit and refuses beyond it with 402', async () => {
    await asSystem(() => wallets.hold(walletId, 14_000, subject('big')));
    expect((await asSystem(() => wallets.summary(walletId))).balancePaise).toBe(-4_000);
    await expect(asSystem(() => wallets.hold(walletId, 1_001, subject('too-much')))).rejects.toMatchObject({ status: 402 });
  });

  it('never overspends under concurrent holds', async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => asSystem(() => wallets.hold(walletId, 4_000, subject(`c${i}`)))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3); // 15 000 available → three 4 000 holds
    expect((await asSystem(() => wallets.summary(walletId))).availablePaise).toBe(3_000);
  });

  it('keeps every journal balanced and balances equal to the sum of entries', async () => {
    const h = await asSystem(() => wallets.hold(walletId, 1_000, subject('x')));
    await asSystem(() => wallets.capture(h.id));
    expect(await asSystem(() => wallets.verifyIntegrity())).toEqual({ balanced: true, mismatches: [] });
    const journals = await prisma.ledgerEntry.groupBy({ by: ['journalId'], _sum: { amountPaise: true } });
    expect(journals.every((j) => j._sum.amountPaise === 0)).toBe(true);
  });

  it('keeps ledger entries append-only', async () => {
    const e = await prisma.ledgerEntry.findFirstOrThrow();
    await expect(prisma.ledgerEntry.update({ where: { id: e.id }, data: { amountPaise: 1 } })).rejects.toThrow(/append-only/);
  });
});
