import { randomUUID } from 'node:crypto';
import { CONFIG, seedPassword } from './config';

type Json = any;

/**
 * Read-side helper for the simulator. Steps act through the screens; the API is used to wait for asynchronous
 * results (validation, VAHAN, sync from the phone), to look up numbers the next step needs, and to check results.
 * The only writes are data preparation and clean-up (simulator endpoints), never the business actions themselves.
 */
export class Api {
  private tokens = new Map<string, string>();

  async token(user = CONFIG.users.admin) {
    const cached = this.tokens.get(user);
    if (cached) return cached;
    const res = await fetch(`${CONFIG.apiUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: user, password: seedPassword() }),
    });
    if (!res.ok) throw new Error(`API login as ${user} failed: HTTP ${res.status}`);
    const t = (await res.json()).token as string;
    this.tokens.set(user, t);
    return t;
  }

  async call(method: string, path: string, body?: unknown, user?: string): Promise<Json> {
    const res = await fetch(`${CONFIG.apiUrl}/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.token(user)}`, 'content-type': 'application/json', ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${data?.detail ?? text.slice(0, 200)}`);
    return data;
  }
  get = (path: string, user?: string) => this.call('GET', path, undefined, user);
  post = (path: string, body: unknown = {}, user?: string) => this.call('POST', path, body, user);
  put = (path: string, body: unknown = {}, user?: string) => this.call('PUT', path, body, user);

  async health() {
    const res = await fetch(`${CONFIG.apiUrl}/api/v1/health`).catch(() => null);
    return Boolean(res?.ok);
  }

  /** Polls until `check` returns a truthy value; throws with `label` after `timeoutMs`. */
  async waitFor<T>(label: string, fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 30_000, everyMs = 400): Promise<T> {
    const end = Date.now() + timeoutMs;
    let last: T | undefined;
    while (Date.now() < end) {
      last = await fn().catch(() => undefined);
      if (last !== undefined && check(last)) return last;
      await new Promise((r) => setTimeout(r, everyMs));
    }
    throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${label} (last: ${JSON.stringify(last)?.slice(0, 200)})`);
  }

  order = (id: string) => this.get(`/orders/${id}`);
  orderDetail = (id: string) => this.get(`/orders/${id}/detail`);

  async findOrderByRegn(regnNo: string) {
    const list = await this.get(`/orders?q=${encodeURIComponent(regnNo)}&pageSize=5`);
    return list.items[0] ?? null;
  }

  waitStatus(id: string, statuses: string[], timeoutMs = 30_000) {
    return this.waitFor(`order → ${statuses.join(' or ')}`, () => this.order(id), (o: Json) => statuses.includes(o.status), timeoutMs);
  }

  /** The newest challan line of an order (after a re-issue the order has two challans). */
  async latestChallan(orderId: string) {
    const d = await this.orderDetail(orderId);
    const lines = (d.challanLines as Json[]).filter((l) => l.challanStatus === 'CREATED');
    return lines.length ? { challanId: lines.at(-1).challanId as string, challanNo: lines.at(-1).challanNo as string } : null;
  }
}
