import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { env } from '../config/env';
import { requestContext } from '../context/request-context';
import { EventBus } from '../../utility/integration-hub/event-bus.service';

interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
  lastRun: number;
  busy: boolean;
}

/**
 * The worker: outbox dispatch and scheduled jobs. Runs inside the API process when WORKER_ENABLED=true,
 * so it can move to its own process later by starting the same module with the HTTP server off.
 */
@Injectable()
export class Scheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Worker');
  private readonly jobs: Job[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private readonly bus: EventBus) {}

  /** Registers a recurring job. `run` executes as the system actor of the default tenant. */
  every(name: string, everyMs: number, run: () => Promise<unknown>) {
    this.jobs.push({ name, everyMs, run, lastRun: Date.now(), busy: false });
  }

  async runNow(name: string) {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) throw new Error(`Unknown job ${name}`);
    return requestContext.runAsSystem(env.defaultTenantId, () => job.run());
  }

  jobNames() {
    return this.jobs.map((j) => ({ name: j.name, everyMs: j.everyMs, lastRun: new Date(j.lastRun) }));
  }

  onApplicationBootstrap() {
    if (!env.workerEnabled) {
      this.log.log('WORKER_ENABLED=false: outbox and scheduled jobs are not running in this process');
      return;
    }
    this.bus.start();
    this.timer = setInterval(() => void this.tick(), 15_000);
    this.log.log(`Scheduled jobs: ${this.jobs.map((j) => j.name).join(', ') || 'none'}`);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    const now = Date.now();
    for (const job of this.jobs) {
      if (job.busy || now - job.lastRun < job.everyMs) continue;
      job.busy = true;
      job.lastRun = now;
      try {
        await requestContext.runAsSystem(env.defaultTenantId, () => job.run());
      } catch (e) {
        this.log.error(`Job ${job.name} failed: ${(e as Error).message}`);
      } finally {
        job.busy = false;
      }
    }
  }
}
