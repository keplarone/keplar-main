import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { RunnerDeps } from "./runner.js";
import { processJob } from "./runner.js";
import { claim } from "./queue.js";

export interface WorkerOptions extends Omit<RunnerDeps, "workerId"> {
  concurrency: number;
  pollMs: number;
  workerId?: string;
}

/**
 * Background worker. Runs independently of any browser session: it only talks to Postgres.
 * Each slot claims a job, runs it, and claims the next; idle slots poll. stop() lets in-flight
 * jobs finish; anything a killed worker leaves behind is reclaimed when its lease expires.
 */
export class Worker {
  readonly workerId: string;
  private running = false;
  private slots: Promise<void>[] = [];
  private wake: (() => void)[] = [];

  constructor(private readonly opts: WorkerOptions) {
    this.workerId = opts.workerId ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (let i = 0; i < this.opts.concurrency; i++) this.slots.push(this.loop());
    this.opts.log("info", "worker started", { workerId: this.workerId, concurrency: this.opts.concurrency });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake.splice(0).forEach((w) => w());
    await Promise.all(this.slots);
    this.slots = [];
    this.opts.log("info", "worker stopped", { workerId: this.workerId });
  }

  /** Processes jobs until the queue has nothing runnable. Used by tests and one-shot runs. */
  async drain(maxJobs = 1_000): Promise<number> {
    let n = 0;
    while (n < maxJobs) {
      const job = await claim(this.opts.db, this.workerId, this.opts.leaseMs);
      if (!job) break;
      await processJob({ ...this.opts, workerId: this.workerId }, job);
      n++;
    }
    return n;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const job = await claim(this.opts.db, this.workerId, this.opts.leaseMs);
        if (job) {
          await processJob({ ...this.opts, workerId: this.workerId }, job);
          continue;
        }
      } catch (err) {
        this.opts.log("error", "worker loop error", { err: (err as Error).message });
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, this.opts.pollMs);
        this.wake.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }
}
