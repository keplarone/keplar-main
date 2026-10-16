// Local development: migrate, then run the API, the background worker and the web client together.
// Requires Postgres (docker compose up -d postgres) and the variables in .env.example.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// Children inherit these variables. Values already set in the shell win over .env.
if (existsSync(".env")) process.loadEnvFile(".env");

// On Windows npm is a .cmd file, which Node only runs through a shell. The arguments below are constants.
const shell = process.platform === "win32";

const migrate = spawnSync("npm", ["run", "migrate", "-w", "@keplar/server"], { stdio: "inherit", shell });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const children = [
  ["api", ["run", "dev:api", "-w", "@keplar/server"]],
  ["worker", ["run", "dev:worker", "-w", "@keplar/server"]],
  ["web", ["run", "dev", "-w", "@keplar/web"]],
].map(([name, args]) => {
  const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"], shell });
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
