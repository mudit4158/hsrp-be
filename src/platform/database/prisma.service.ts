import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;
/** Either the root client or a transaction client. Services accept this so callers can compose transactions. */
export type Db = PrismaClient | Tx;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly afterCommitHooks: Array<() => void> = [];

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Called after every successful `tx()` commit (the event bus uses it to dispatch new outbox rows at once). */
  onAfterCommit(hook: () => void) {
    this.afterCommitHooks.push(hook);
  }

  /** Runs `fn` in one database transaction, then fires after-commit hooks. */
  async tx<T>(fn: (tx: Tx) => Promise<T>, opts?: { timeoutMs?: number }): Promise<T> {
    const result = await this.$transaction(fn, { timeout: opts?.timeoutMs ?? 20_000, maxWait: 10_000 });
    for (const hook of this.afterCommitHooks) hook();
    return result;
  }
}
