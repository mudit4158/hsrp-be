import { Injectable } from '@nestjs/common';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService, Tx } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { AuditService } from '../audit/audit.service';
import { assertBalanced, availablePaise, canHold, LedgerLine } from './ledger-rules';

const SYSTEM_OWNER = { ownerType: 'system', ownerId: 'ledger' };

/**
 * Double-entry wallet. A wallet is a WALLET account plus its own HOLDS account; FUNDING and REVENUE are
 * system accounts. Top-up: FUNDING→WALLET. Hold: WALLET→HOLDS. Capture: HOLDS→REVENUE. Release: HOLDS→WALLET.
 * Refund after capture: REVENUE→WALLET. Several owners can share one wallet (the caller decides the owner key).
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(db: Db | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return !db || db === this.prisma ? this.prisma.tx(fn) : fn(db as Tx);
  }

  async openWallet(input: { ownerType: string; ownerId: string; name: string; creditLimitPaise?: number }, db?: Db) {
    return this.run(db, async (tx) => {
      const tenantId = requestContext.tenantId();
      const wallet = await tx.ledgerAccount.upsert({
        where: { tenantId_ownerType_ownerId_kind: { tenantId, ownerType: input.ownerType, ownerId: input.ownerId, kind: 'WALLET' } },
        create: { tenantId, ownerType: input.ownerType, ownerId: input.ownerId, kind: 'WALLET', name: input.name, creditLimitPaise: input.creditLimitPaise ?? 0 },
        update: { name: input.name },
      });
      await tx.ledgerAccount.upsert({
        where: { tenantId_ownerType_ownerId_kind: { tenantId, ownerType: input.ownerType, ownerId: input.ownerId, kind: 'HOLDS' } },
        create: { tenantId, ownerType: input.ownerType, ownerId: input.ownerId, kind: 'HOLDS', name: `${input.name} (holds)` },
        update: {},
      });
      await this.systemAccount(tx, 'FUNDING');
      await this.systemAccount(tx, 'REVENUE');
      return wallet;
    });
  }

  async summary(walletId: string, db: Db = this.prisma) {
    const wallet = await this.wallet(db, walletId);
    const holds = await this.holdsAccount(db, wallet);
    return {
      id: wallet.id,
      name: wallet.name,
      ownerType: wallet.ownerType,
      ownerId: wallet.ownerId,
      balancePaise: wallet.balancePaise,
      heldPaise: holds.balancePaise,
      creditLimitPaise: wallet.creditLimitPaise,
      availablePaise: availablePaise(wallet.balancePaise, wallet.creditLimitPaise),
    };
  }

  async list() {
    const wallets = await this.prisma.ledgerAccount.findMany({ where: { tenantId: requestContext.tenantId(), kind: 'WALLET' }, orderBy: { name: 'asc' } });
    return Promise.all(wallets.map((w) => this.summary(w.id)));
  }

  async topUp(walletId: string, amountPaise: number, reference: string, db?: Db) {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw Problem.badRequest('Top-up amount must be positive');
    return this.run(db, async (tx) => {
      const wallet = await this.wallet(tx, walletId);
      const funding = await this.systemAccount(tx, 'FUNDING');
      const j = await this.post(tx, 'TOPUP', `Top-up ${reference}`, [
        { accountId: funding.id, amountPaise: -amountPaise },
        { accountId: wallet.id, amountPaise },
      ], { reference, subjectType: 'wallet', subjectId: wallet.id });
      await this.audit.record({ action: 'wallet.topup', subjectType: 'wallet', subjectId: wallet.id, after: { amountPaise, reference } }, tx);
      return j;
    });
  }

  async setCreditLimit(walletId: string, creditLimitPaise: number) {
    const before = await this.wallet(this.prisma, walletId);
    const after = await this.prisma.ledgerAccount.update({ where: { id: walletId }, data: { creditLimitPaise } });
    await this.audit.record({ action: 'wallet.credit-limit', subjectType: 'wallet', subjectId: walletId, before: before.creditLimitPaise, after: creditLimitPaise });
    return after;
  }

  /** Reserves funds for a subject. Fails with 402 if balance plus credit limit is not enough. */
  async hold(walletId: string, amountPaise: number, subject: { subjectType: string; subjectId: string }, db?: Db) {
    return this.run(db, async (tx) => {
      await this.lock(tx, [walletId]);
      const wallet = await this.wallet(tx, walletId);
      if (!canHold(wallet.balancePaise, wallet.creditLimitPaise, amountPaise)) {
        throw Problem.paymentRequired(
          `Wallet balance is not enough: available ₹${(availablePaise(wallet.balancePaise, wallet.creditLimitPaise) / 100).toFixed(2)}, needed ₹${(amountPaise / 100).toFixed(2)}`,
        );
      }
      const holds = await this.holdsAccount(tx, wallet);
      const j = await this.post(tx, 'HOLD', `Hold for ${subject.subjectType} ${subject.subjectId}`, [
        { accountId: wallet.id, amountPaise: -amountPaise },
        { accountId: holds.id, amountPaise },
      ], subject);
      return tx.ledgerHold.create({
        data: { tenantId: wallet.tenantId, walletAccountId: wallet.id, amountPaise, subjectType: subject.subjectType, subjectId: subject.subjectId, holdJournalId: j.id },
      });
    });
  }

  async capture(holdId: string, db?: Db) {
    return this.settle(holdId, 'CAPTURE', db);
  }

  async release(holdId: string, db?: Db) {
    return this.settle(holdId, 'RELEASE', db);
  }

  /** Gives back a captured amount (e.g. a cancelled order). */
  async refundCaptured(holdId: string, db?: Db) {
    return this.run(db, async (tx) => {
      const hold = await tx.ledgerHold.findUniqueOrThrow({ where: { id: holdId } });
      if (hold.status !== 'CAPTURED') throw Problem.conflict(`Hold is ${hold.status}, only CAPTURED can be refunded`);
      const wallet = await this.wallet(tx, hold.walletAccountId);
      const revenue = await this.systemAccount(tx, 'REVENUE');
      const j = await this.post(tx, 'REFUND', `Refund for ${hold.subjectType} ${hold.subjectId}`, [
        { accountId: revenue.id, amountPaise: -hold.amountPaise },
        { accountId: wallet.id, amountPaise: hold.amountPaise },
      ], { subjectType: hold.subjectType, subjectId: hold.subjectId });
      return tx.ledgerHold.update({ where: { id: holdId }, data: { status: 'REFUNDED', settleJournalId: j.id } });
    });
  }

  async statement(walletId: string, page = 1, pageSize = 50) {
    const wallet = await this.wallet(this.prisma, walletId);
    const holds = await this.holdsAccount(this.prisma, wallet);
    const where = { accountId: { in: [wallet.id, holds.id] } };
    const [entries, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.ledgerEntry.count({ where }),
    ]);
    const journals = await this.prisma.ledgerJournal.findMany({ where: { id: { in: entries.map((e) => e.journalId) } } });
    const jById = new Map(journals.map((j) => [j.id, j]));
    return {
      items: entries.map((e) => ({
        ...e,
        account: e.accountId === wallet.id ? 'WALLET' : 'HOLDS',
        kind: jById.get(e.journalId)?.kind,
        memo: jById.get(e.journalId)?.memo,
        reference: jById.get(e.journalId)?.reference,
        subjectType: jById.get(e.journalId)?.subjectType,
        subjectId: jById.get(e.journalId)?.subjectId,
      })),
      total,
      page,
      pageSize,
    };
  }

  holdsFor(walletId: string, status?: string) {
    return this.prisma.ledgerHold.findMany({ where: { walletAccountId: walletId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  getHold(holdId: string, db: Db = this.prisma) {
    return db.ledgerHold.findUnique({ where: { id: holdId } });
  }

  /** Recomputes every balance from entries and reports mismatches (used by tests and reconciliation). */
  async verifyIntegrity() {
    const sums = await this.prisma.ledgerEntry.groupBy({ by: ['accountId'], _sum: { amountPaise: true } });
    const accounts = await this.prisma.ledgerAccount.findMany();
    const sumBy = new Map(sums.map((s) => [s.accountId, s._sum.amountPaise ?? 0]));
    const mismatches = accounts.filter((a) => (sumBy.get(a.id) ?? 0) !== a.balancePaise).map((a) => a.id);
    const total = sums.reduce((s, x) => s + (x._sum.amountPaise ?? 0), 0);
    return { balanced: total === 0, mismatches };
  }

  // ---------------------------------------------------------------------------

  private async settle(holdId: string, kind: 'CAPTURE' | 'RELEASE', db?: Db) {
    return this.run(db, async (tx) => {
      const hold = await tx.ledgerHold.findUniqueOrThrow({ where: { id: holdId } });
      if (hold.status !== 'HELD') {
        if ((kind === 'CAPTURE' && hold.status === 'CAPTURED') || (kind === 'RELEASE' && hold.status === 'RELEASED')) return hold;
        throw Problem.conflict(`Hold is already ${hold.status}`);
      }
      const wallet = await this.wallet(tx, hold.walletAccountId);
      const holds = await this.holdsAccount(tx, wallet);
      const target = kind === 'CAPTURE' ? await this.systemAccount(tx, 'REVENUE') : wallet;
      const j = await this.post(tx, kind, `${kind === 'CAPTURE' ? 'Capture' : 'Release'} for ${hold.subjectType} ${hold.subjectId}`, [
        { accountId: holds.id, amountPaise: -hold.amountPaise },
        { accountId: target.id, amountPaise: hold.amountPaise },
      ], { subjectType: hold.subjectType, subjectId: hold.subjectId });
      return tx.ledgerHold.update({ where: { id: holdId }, data: { status: kind === 'CAPTURE' ? 'CAPTURED' : 'RELEASED', settleJournalId: j.id } });
    });
  }

  private async post(tx: Tx, kind: string, memo: string, lines: LedgerLine[], meta: { reference?: string; subjectType?: string; subjectId?: string }) {
    assertBalanced(lines);
    await this.lock(tx, lines.map((l) => l.accountId));
    const tenantId = requestContext.tenantId();
    const journal = await tx.ledgerJournal.create({
      data: { tenantId, kind, memo, reference: meta.reference, subjectType: meta.subjectType, subjectId: meta.subjectId, createdBy: requestContext.actorId() },
    });
    for (const l of lines) {
      const acc = await tx.ledgerAccount.update({ where: { id: l.accountId }, data: { balancePaise: { increment: l.amountPaise } } });
      await tx.ledgerEntry.create({ data: { tenantId, journalId: journal.id, accountId: l.accountId, amountPaise: l.amountPaise, balanceAfterPaise: acc.balancePaise } });
    }
    return journal;
  }

  /** Row locks in a fixed order so concurrent journals cannot deadlock or overspend. */
  private async lock(tx: Tx, accountIds: string[]) {
    const ids = [...new Set(accountIds)].sort();
    await tx.$queryRaw`SELECT id FROM util_wallet_account WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  }

  private async wallet(db: Db, id: string) {
    const w = await db.ledgerAccount.findFirst({ where: { id, kind: 'WALLET' } });
    if (!w) throw Problem.notFound('Wallet');
    return w;
  }

  private async holdsAccount(db: Db, wallet: { tenantId: string; ownerType: string; ownerId: string }) {
    return db.ledgerAccount.findUniqueOrThrow({
      where: { tenantId_ownerType_ownerId_kind: { tenantId: wallet.tenantId, ownerType: wallet.ownerType, ownerId: wallet.ownerId, kind: 'HOLDS' } },
    });
  }

  private async systemAccount(db: Db, kind: 'FUNDING' | 'REVENUE') {
    const tenantId = requestContext.tenantId();
    return db.ledgerAccount.upsert({
      where: { tenantId_ownerType_ownerId_kind: { tenantId, ...SYSTEM_OWNER, kind } },
      create: { tenantId, ...SYSTEM_OWNER, kind, name: kind === 'FUNDING' ? 'Funding (top-ups)' : 'Revenue' },
      update: {},
    });
  }
}
