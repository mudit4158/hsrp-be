/**
 * RFC 7807 problem. Throw this from any layer; the global filter renders it as application/problem+json.
 */
export class Problem extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail?: string,
    public readonly code?: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(detail ?? title);
  }

  static badRequest(detail: string, code = 'bad-request', extra?: Record<string, unknown>) {
    return new Problem(400, 'Bad request', detail, code, extra);
  }
  static unauthorized(detail = 'Sign in required') {
    return new Problem(401, 'Unauthorized', detail, 'unauthorized');
  }
  static forbidden(detail = 'You do not have permission for this action') {
    return new Problem(403, 'Forbidden', detail, 'forbidden');
  }
  static notFound(what: string) {
    return new Problem(404, 'Not found', `${what} not found`, 'not-found');
  }
  static conflict(detail: string, code = 'conflict', extra?: Record<string, unknown>) {
    return new Problem(409, 'Conflict', detail, code, extra);
  }
  static unprocessable(detail: string, code = 'unprocessable', extra?: Record<string, unknown>) {
    return new Problem(422, 'Unprocessable entity', detail, code, extra);
  }
  static paymentRequired(detail: string, code = 'insufficient-funds') {
    return new Problem(402, 'Payment required', detail, code);
  }
}

/** Throw from an outbox subscriber to skip retries and send the delivery straight to the manual queue. */
export class NonRetryableError extends Error {
  readonly nonRetryable = true;
}
