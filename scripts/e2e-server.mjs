// Starts the production build (API serving the web client + a separate worker) for Playwright.
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  NODE_ENV: "development",
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://keplar:keplar@localhost:5432/keplar_e2e",
  APP_ORIGIN: "http://127.0.0.1:4173",
  PORT: "4173",
  WEB_DIST_DIR: "apps/web/dist",
  AUTH_RATE_LIMIT_PER_MINUTE: "100",
  WORKER_POLL_MS: "100",
};
const node = (args) => spawn("node", args, { stdio: "inherit", env });

const migrate = node(["apps/server/dist/migrate-main.js"]);
migrate.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const api = node(["apps/server/dist/api-main.js"]);
  const worker = node(["apps/server/dist/worker-main.js"]);
  const stop = () => {
    api.kill("SIGTERM");
    worker.kill("SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
});
