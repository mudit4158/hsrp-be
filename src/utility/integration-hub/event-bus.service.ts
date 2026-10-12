import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { env } from '../../platform/config/env';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService } from '../../platform/database/prisma.service';
import { nextDeliveryState } from './backoff';

export interface PublishInput {
  type: string;
  subjectType?: string;
  subjectId?: string;
  payload?: Record<string, unknown>;
}

export interface DeliveredEvent<P = Record<string, any>> {
  id: string;
  tenantId: string;
  type: string;
  subjectType: string | null;
  subjectId: string | null;
  payload: P;
  occurredAt: Date;
  attempt: number;
}

export type EventHandler = (event: DeliveredEvent) => Promise<void>;

interface Subscription {
  name: string;
  handler: EventHandler;
  maxAttempts: number;
}

/**
 * Transactional outbox + in-process event bus.
 * publish() writes the event in the caller's transaction. The worker fans each event out to one delivery row
 * per subscriber and runs them with retries and exponential back-off; exhausted deliveries become DEAD
 * (the dead-letter / manual queue shown on the integration monitor).
 */
@Injectable()
export class EventBus implements OnApplicationShutdown {
  private readonly log = new Logger('EventBus');
  private readonly subs = new Map<string, Subscription[]>();
  private timer?: NodeJS.Timeout;
  private running = false;
  private again = false;
  private started = false;
  baseRetryMs = env.outboxRetryBaseMs;

  constructor(private readonly prisma: PrismaService) {
    prisma.onAfterCommit(() => this.kick());
  }

  async publish(db: Db, input: PublishInput): Promise<string> {
    const row = await db.outboxEvent.create({
      data: {
        tenantId: requestContext.tenantId(),
        eventType: input.type,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        actorId: requestContext.actorId(),
      },
      select: { id: true },
    });
    return row.id;
  }

  subscribe(eventType: string, name: string, handler: EventHandler, opts?: { maxAttempts?: number }) {
    const list = this.subs.get(eventType) ?? [];
    if (list.some((s) => s.name === name)) return;
    list.push({ name, handler, maxAttempts: opts?.maxAttempts ?? 8 });
    this.subs.set(eventType, list);
  }

  /** Delivery counts by status, plus how many are queued for retry and how many sit in the manual queue. */
  async stats() {
    const rows = await this.prisma.outboxDelivery.groupBy({ by: ['status'], where: { tenantId: requestContext.tenantId() }, _count: true });
    const by = Object.fromEntries(rows.map((r) => [r.status, r._count])) as Record<string, number>;
    return { pending: (by.PENDING ?? 0) + (by.RUNNING ?? 0), retrying: by.FAILED ?? 0, dead: by.DEAD ?? 0, done: by.DONE ?? 0 };
  }

  eventsFor(subjectType: string, subjectId: string) {
    return this.prisma.outboxEvent.findMany({ where: { tenantId: requestContext.tenantId(), subjectType, subjectId }, orderBy: { seq: 'asc' }, take: 500 });
  }

  /** Re-queues every FAILED or DEAD delivery of one subscriber now (e.g. after VAHAN comes back). */
  async replayAll(subscriber: string) {
    const res = await this.prisma.outboxDelivery.updateMany({
      where: { tenantId: requestContext.tenantId(), subscriber, status: { in: ['FAILED', 'DEAD'] } },
      data: { status: 'PENDING', nextAttemptAt: new Date() },
    });
    this.kick();
    return res.count;
  }

  subscriptions(): Array<{ eventType: string; subscriber: string }> {
    return [...this.subs.entries()].flatMap(([eventType, l]) => l.map((s) => ({ eventType, subscriber: s.name })));
  }

  start(intervalMs = 1000) {
    if (this.started) return;
    this.started = true;
    this.timer = setInterval(() => this.kick(), intervalMs);
    this.log.log('Outbox worker started');
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.started = false;
  }

  /** Runs a dispatch pass soon (coalesces concurrent requests). */
  kick() {
    if (!this.started) return;
    if (this.running) {
      this.again = true;
      return;
    }
    setImmediate(() => void this.loop());
  }

  private async loop() {
    if (this.running) return;
    this.running = true;
    try {
      do {
        this.again = false;
        const n = await this.runOnce();
        if (n > 0) this.again = true;
      } while (this.again && this.started);
    } catch (e) {
      this.log.error(`Dispatch pass failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** One dispatch pass: fan out new events, then run due deliveries. Returns the number of deliveries run. */
  async runOnce(): Promise<number> {
    await this.fanOut();
    return this.runDue();
  }

  private async fanOut() {
    await this.prisma.$transaction(async (tx) => {
      const events = await tx.$queryRaw<Array<{ id: string; event_type: string; tenant_id: string }>>`
        SELECT id, event_type, tenant_id FROM util_hub_outbox_event
        WHERE dispatched_at IS NULL ORDER BY seq LIMIT 200 FOR UPDATE SKIP LOCKED`;
      for (const e of events) {
        const subs = this.subs.get(e.event_type) ?? [];
        if (subs.length) {
          await tx.outboxDelivery.createMany({
            data: subs.map((s) => ({
              tenantId: e.tenant_id,
              eventId: e.id,
              eventType: e.event_type,
              subscriber: s.name,
              maxAttempts: s.maxAttempts,
            })),
            skipDuplicates: true,
          });
        }
        await tx.outboxEvent.update({ where: { id: e.id }, data: { dispatchedAt: new Date() } });
      }
    });
  }

  private async runDue(): Promise<number> {
    // Due times are written with the Node clock (nextDeliveryState, replay), so compare with the Node clock too;
    // the database clock (e.g. a Docker VM) can lag by a few milliseconds and make a just-replayed row look not due.
    const now = new Date();
    const lockUntil = new Date(now.getTime() + 120_000);
    const claimed = await this.prisma.$queryRaw<Array<{ id: string; seq: number }>>`
      UPDATE util_hub_outbox_delivery d
      SET status = 'RUNNING', locked_until = ${lockUntil}, updated_at = ${now}
      FROM (
        SELECT d2.id, e.seq FROM util_hub_outbox_delivery d2
        JOIN util_hub_outbox_event e ON e.id = d2.event_id
        WHERE (d2.status IN ('PENDING', 'FAILED') AND d2.next_attempt_at <= ${now})
           OR (d2.status = 'RUNNING' AND d2.locked_until < ${now})
        ORDER BY e.seq
        LIMIT 50
        FOR UPDATE OF d2 SKIP LOCKED
      ) c
      WHERE d.id = c.id
      RETURNING d.id, c.seq`;
    claimed.sort((a, b) => a.seq - b.seq);
    for (const c of claimed) await this.runDelivery(c.id);
    return claimed.length;
  }

  /** Runs a single delivery now (also used by tests). */
  async runDelivery(deliveryId: string) {
    const d = await this.prisma.outboxDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const e = await this.prisma.outboxEvent.findUniqueOrThrow({ where: { id: d.eventId } });
    const sub = (this.subs.get(e.eventType) ?? []).find((s) => s.name === d.subscriber);
    let error: Error | undefined;
    if (!sub) {
      error = Object.assign(new Error(`No handler registered for ${d.subscriber}`), { nonRetryable: true });
    } else {
      try {
        await requestContext.runAsSystem(e.tenantId, () =>
          sub.handler({
            id: e.id,
            tenantId: e.tenantId,
            type: e.eventType,
            subjectType: e.subjectType,
            subjectId: e.subjectId,
            payload: e.payload as Record<string, any>,
            occurredAt: e.occurredAt,
            attempt: d.attempts + 1,
          }),
        );
      } catch (err) {
        error = err as Error;
      }
    }
    const next = nextDeliveryState({
      succeeded: !error,
      nonRetryable: Boolean((error as { nonRetryable?: boolean } | undefined)?.nonRetryable),
      attemptsSoFar: d.attempts,
      maxAttempts: d.maxAttempts,
      now: new Date(),
      baseMs: this.baseRetryMs,
    });
    if (error) this.log.warn(`${d.subscriber} failed (attempt ${next.attempts}): ${error.message}`);
    await this.prisma.outboxDelivery.update({
      where: { id: d.id },
      data: {
        status: next.status,
        attempts: next.attempts,
        lockedUntil: null,
        lastError: error ? error.message.slice(0, 2000) : null,
        completedAt: next.status === 'DONE' ? new Date() : null,
        ...(next.status === 'FAILED' ? { nextAttemptAt: next.nextAttemptAt } : {}),
      },
    });
  }
}
