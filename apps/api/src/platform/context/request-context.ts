import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '../config/env';

export interface Actor {
  id: string;
  /** user | customer | api-client | system */
  type: string;
  name?: string;
  roles: string[];
  permissions: string[];
  orgId?: string | null;
  /** Free-form claims, e.g. the registration number a customer proved by OTP. */
  claims?: Record<string, unknown>;
}

export interface RequestContext {
  tenantId: string;
  actor?: Actor;
  ip?: string;
  deviceId?: string;
  requestId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const SYSTEM_ACTOR: Actor = { id: 'system', type: 'system', name: 'System', roles: ['SYSTEM'], permissions: ['*'] };

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext {
    return storage.getStore() ?? { tenantId: env.defaultTenantId };
  },
  tenantId(): string {
    return this.get().tenantId;
  },
  actor(): Actor | undefined {
    return this.get().actor;
  },
  actorId(): string | undefined {
    return this.get().actor?.id;
  },
  /** Mutates the current store (used by guards once the caller is authenticated). */
  set(patch: Partial<RequestContext>) {
    const store = storage.getStore();
    if (store) Object.assign(store, patch);
  },
  /** Runs `fn` as the system actor for the given tenant (worker, scheduled jobs, event handlers). */
  runAsSystem<T>(tenantId: string, fn: () => T): T {
    return storage.run({ tenantId, actor: SYSTEM_ACTOR }, fn);
  },
};
