/** Delay before retry number `attempt` (1-based): base × 2^(attempt-1), capped. */
export function backoffMs(attempt: number, baseMs: number, capMs = 5 * 60_000): number {
  const n = Math.max(1, attempt);
  return Math.min(capMs, baseMs * 2 ** (n - 1));
}

export type DeliveryOutcome =
  | { status: 'DONE' }
  | { status: 'FAILED'; nextAttemptAt: Date }
  | { status: 'DEAD' };

/** Decides what happens to a delivery after a handler run. Pure, so it is unit-tested directly. */
export function nextDeliveryState(input: {
  succeeded: boolean;
  nonRetryable?: boolean;
  attemptsSoFar: number;
  maxAttempts: number;
  now: Date;
  baseMs: number;
}): DeliveryOutcome & { attempts: number } {
  const attempts = input.attemptsSoFar + 1;
  if (input.succeeded) return { status: 'DONE', attempts };
  if (input.nonRetryable || attempts >= input.maxAttempts) return { status: 'DEAD', attempts };
  return { status: 'FAILED', attempts, nextAttemptAt: new Date(input.now.getTime() + backoffMs(attempts, input.baseMs)) };
}
