import { DEFAULT_HANDLERS } from "./capabilities/index.js";
import { DEFAULT_FETCH_OPTIONS } from "./capabilities/safe-fetch.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { Worker } from "./engine/worker.js";
import { configuredProviders, jsonLogger } from "./providers.js";

const config = loadConfig();
const db = createPool(config.DATABASE_URL, config.WORKER_CONCURRENCY + 2);
const log = jsonLogger("worker");
const providers = configuredProviders(config);
if (providers.length === 0) log("warn", "no model provider configured; composers will use templates");

const worker = new Worker({
  db,
  concurrency: config.WORKER_CONCURRENCY,
  pollMs: config.WORKER_POLL_MS,
  leaseMs: config.WORKER_LEASE_MS,
  handlers: DEFAULT_HANDLERS,
  providers,
  fetchOptions: DEFAULT_FETCH_OPTIONS,
  log,
});
worker.start();

const shutdown = async (signal: string) => {
  log("info", "draining before exit", { signal });
  await worker.stop();
  await db.end();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
