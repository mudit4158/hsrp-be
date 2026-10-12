// Utility test: loads only platform + utility code, no core module.
import { asSystem, resetDb } from '../../../test/db';
import { PrismaService } from '../../platform/database/prisma.service';
import { NonRetryableError } from '../../platform/http/problem';
import { backoffMs, nextDeliveryState } from './backoff';
import { EventBus } from './event-bus.service';

describe('retry back-off', () => {
  it('doubles from the base delay and caps', () => {
    expect([1, 2, 3, 4].map((a) => backoffMs(a, 1000))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(30, 1000)).toBe(5 * 60_000);
  });
  it('marks success DONE, failures FAILED with a later attempt, and the last failure DEAD', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(nextDeliveryState({ succeeded: true, attemptsSoFar: 0, maxAttempts: 3, now, baseMs: 1000 })).toMatchObject({ status: 'DONE', attempts: 1 });
    const f = nextDeliveryState({ succeeded: false, attemptsSoFar: 1, maxAttempts: 3, now, baseMs: 1000 });
    expect(f).toMatchObject({ status: 'FAILED', attempts: 2 });
    expect((f as { nextAttemptAt: Date }).nextAttemptAt.getTime() - now.getTime()).toBe(2000);
    expect(nextDeliveryState({ succeeded: false, attemptsSoFar: 2, maxAttempts: 3, now, baseMs: 1000 })).toMatchObject({ status: 'DEAD' });
    expect(nextDeliveryState({ succeeded: false, nonRetryable: true, attemptsSoFar: 0, maxAttempts: 9, now, baseMs: 1000 })).toMatchObject({ status: 'DEAD' });
  });
});

describe('EventBus (transactional outbox)', () => {
  const prisma = new PrismaService();
  const bus = new EventBus(prisma);
  bus.baseRetryMs = 60_000;

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());
  beforeEach(() => resetDb(prisma));

  const deliveries = (subscriber: string) => prisma.outboxDelivery.findMany({ where: { subscriber } });
  const makeDue = () => prisma.outboxDelivery.updateMany({ where: { status: 'FAILED' }, data: { nextAttemptAt: new Date(0) } });

  it('writes the event in the caller’s transaction (rolled back with it)', async () => {
    await expect(
      asSystem(() =>
        prisma.tx(async (tx) => {
          await bus.publish(tx, { type: 'T.RolledBack' });
          throw new Error('business failure');
        }),
      ),
    ).rejects.toThrow('business failure');
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('fans an event out to every subscriber and delivers it', async () => {
    const seen: string[] = [];
    bus.subscribe('T.Fanout', 'sub.a', async (e) => void seen.push(`a:${e.payload.n}`));
    bus.subscribe('T.Fanout', 'sub.b', async (e) => void seen.push(`b:${e.payload.n}`));
    await asSystem(() => prisma.tx((tx) => bus.publish(tx, { type: 'T.Fanout', payload: { n: 1 } })));
    await bus.runOnce();
    expect(seen.sort()).toEqual(['a:1', 'b:1']);
    expect((await prisma.outboxDelivery.findMany()).every((d) => d.status === 'DONE')).toBe(true);
  });

  it('retries a failing subscriber with back-off, then succeeds', async () => {
    let calls = 0;
    bus.subscribe('T.Flaky', 'sub.flaky', async () => {
      calls++;
      if (calls < 3) throw new Error(`boom ${calls}`);
    });
    await asSystem(() => prisma.tx((tx) => bus.publish(tx, { type: 'T.Flaky' })));
    await bus.runOnce();
    let [d] = await deliveries('sub.flaky');
    expect(d).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'boom 1' });
    expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() - 5);
    await bus.runOnce(); // not due yet
    expect(calls).toBe(1);
    await makeDue();
    await bus.runOnce();
    await makeDue();
    await bus.runOnce();
    [d] = await deliveries('sub.flaky');
    expect(d).toMatchObject({ status: 'DONE', attempts: 3, lastError: null });
  });

  it('moves a delivery to the dead-letter (manual) queue after max attempts', async () => {
    bus.subscribe('T.Broken', 'sub.broken', async () => {
      throw new Error('always');
    }, { maxAttempts: 2 });
    await asSystem(() => prisma.tx((tx) => bus.publish(tx, { type: 'T.Broken' })));
    await bus.runOnce();
    await makeDue();
    await bus.runOnce();
    const [d] = await deliveries('sub.broken');
    expect(d).toMatchObject({ status: 'DEAD', attempts: 2 });
  });

  it('dead-letters a non-retryable failure at once, and replay re-runs it', async () => {
    let fixed = false;
    bus.subscribe('T.Refused', 'sub.refused', async () => {
      if (!fixed) throw new NonRetryableError('refused');
    });
    await asSystem(() => prisma.tx((tx) => bus.publish(tx, { type: 'T.Refused' })));
    await bus.runOnce();
    expect((await deliveries('sub.refused'))[0]).toMatchObject({ status: 'DEAD', attempts: 1 });
    fixed = true;
    expect(await asSystem(() => bus.replayAll('sub.refused'))).toBe(1);
    await bus.runOnce();
    expect((await deliveries('sub.refused'))[0].status).toBe('DONE');
  });
});
