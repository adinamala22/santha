import { Global, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'bullmq';
import { CLOCK, type Clock } from '../../common/clock';
import { ENV } from '../../config/config.module';
import { type Env, workersEnabled } from '../../config/env';
import { redisConnectionOptions } from '../queues/queues';
import { QueuesService } from '../queues/queues.service';

export type TimerHandler = (data: Record<string, unknown>) => Promise<unknown>;

/**
 * Timers on the `timers` queue: one-off delayed jobs keyed by a stable id (e.g.
 * `order:{id}:accept`, cancelled on transition) and repeatable jobs (sweeps). ONE worker routes jobs
 * by name to the registered handler — several workers on one queue would each "complete" jobs that
 * are not theirs. Fake mode runs them in process against the dev clock; `runDue()` lets tests and
 * POST /v1/dev/jobs/timers fire what is due without waiting.
 */
export abstract class Timers {
  protected readonly handlers = new Map<string, TimerHandler>();
  protected readonly logger = new Logger('Timers');

  register(name: string, handler: TimerHandler): void {
    if (this.handlers.has(name)) throw new Error(`Duplicate timer handler ${name}`);
    this.handlers.set(name, handler);
  }

  /** Runs `name` at `at` (replacing an existing timer with the same key). */
  abstract schedule(key: string, name: string, at: Date, data?: Record<string, unknown>): Promise<void>;
  abstract cancel(key: string): Promise<void>;
  /** Runs `name` every `everyMs` (one runner at a time across instances). */
  abstract repeat(name: string, everyMs: number): Promise<void>;

  protected async run(name: string, data: Record<string, unknown>): Promise<void> {
    const h = this.handlers.get(name);
    if (!h) {
      this.logger.warn(`No handler for timer ${name}`);
      return;
    }
    await h(data);
  }
}

export class BullTimers extends Timers {
  private worker: Worker | undefined;

  constructor(
    private readonly queues: QueuesService,
    private readonly env: Env,
  ) {
    super();
  }

  async schedule(key: string, name: string, at: Date, data: Record<string, unknown> = {}): Promise<void> {
    const q = this.queues.get('timers');
    await (await q.getJob(key))?.remove().catch(() => undefined);
    await q.add(name, data, { jobId: key, delay: Math.max(0, at.getTime() - Date.now()), removeOnComplete: true, removeOnFail: 100 });
  }

  async cancel(key: string): Promise<void> {
    await (await this.queues.get('timers').getJob(key))?.remove().catch(() => undefined);
  }

  async repeat(name: string, everyMs: number): Promise<void> {
    // Worker processes own the schedules; API-only processes (and tests without Redis) must not dial Redis here.
    if (!workersEnabled(this.env)) return;
    await this.queues.get('timers').upsertJobScheduler(name, { every: everyMs }, { name });
  }

  start(): void {
    if (!workersEnabled(this.env) || this.worker) return;
    this.worker = new Worker('timers', (job) => this.run(job.name, (job.data ?? {}) as Record<string, unknown>), {
      connection: redisConnectionOptions(this.env.REDIS_URL!),
      concurrency: 4,
    });
    this.worker.on('failed', (job, err) => this.logger.warn({ job: job?.name, key: job?.id, err: err.message }, 'Timer failed'));
  }

  async stop(): Promise<void> {
    await this.worker?.close();
  }
}

export class MemoryTimers extends Timers {
  private readonly due = new Map<string, { name: string; at: number; data: Record<string, unknown> }>();
  private readonly repeats: Array<{ name: string; everyMs: number; next: number }> = [];
  private ticker: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly clock: Clock) {
    super();
  }

  async schedule(key: string, name: string, at: Date, data: Record<string, unknown> = {}): Promise<void> {
    this.due.set(key, { name, at: at.getTime(), data });
  }

  async cancel(key: string): Promise<void> {
    this.due.delete(key);
  }

  async repeat(name: string, everyMs: number): Promise<void> {
    this.repeats.push({ name, everyMs, next: this.clock().getTime() + everyMs });
  }

  /** Fires every timer due at the (dev) clock's now. Returns how many ran. */
  async runDue(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let n = 0;
    try {
      const now = this.clock().getTime();
      for (const [key, t] of [...this.due].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now) continue;
        this.due.delete(key);
        await this.run(t.name, t.data).catch((e: Error) => this.logger.warn(`${t.name}: ${e.message}`));
        n++;
      }
      for (const r of this.repeats) {
        if (r.next > now) continue;
        r.next = now + r.everyMs;
        await this.run(r.name, {}).catch((e: Error) => this.logger.warn(`${r.name}: ${e.message}`));
        n++;
      }
    } finally {
      this.running = false;
    }
    return n;
  }

  pending(): Array<{ key: string; name: string; at: Date }> {
    return [...this.due].map(([key, t]) => ({ key, name: t.name, at: new Date(t.at) }));
  }

  start(): void {
    this.ticker = setInterval(() => void this.runDue(), 1000);
    this.ticker.unref();
  }

  async stop(): Promise<void> {
    if (this.ticker) clearInterval(this.ticker);
  }
}

@Injectable()
class TimersLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(private readonly timers: Timers) {}

  onApplicationBootstrap(): void {
    (this.timers as BullTimers | MemoryTimers).start();
  }

  async onApplicationShutdown(): Promise<void> {
    await (this.timers as BullTimers | MemoryTimers).stop();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: Timers,
      inject: [ENV, QueuesService, CLOCK],
      useFactory: (env: Env, queues: QueuesService, clock: Clock) => (env.DATA_STORE === 'memory' ? new MemoryTimers(clock) : new BullTimers(queues, env)),
    },
    TimersLifecycle,
  ],
  exports: [Timers],
})
export class TimersModule {}
