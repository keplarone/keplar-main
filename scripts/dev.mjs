// Local development: migrate, then run the API, the background worker and the web client together.
// Requires Postgres (docker compose up -d postgres) and the variables in .env.example.
import { spawn, spawnSync } from "node:child_process";

const migrate = spawnSync("npm", ["run", "migrate", "-w", "@keplar/server"], { stdio: "inherit" });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const children = [
  ["api", ["run", "dev:api", "-w", "@keplar/server"]],
  ["worker", ["run", "dev:worker", "-w", "@keplar/server"]],
  ["web", ["run", "dev", "-w", "@keplar/web"]],
].map(([name, args]) => {
  const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of ["stdout", "stderr"]) {
    child[stream].on("data", (d) => process[stream].write(String(d).replace(/^(?=.)/gm, `[${name}] `)));
  }
  return child;
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const c of children) c.kill("SIGTERM");
    process.exit(0);
  });
}
