import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { buildApp } from "./http/app.js";
import { configuredProviders } from "./providers.js";

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
const app = await buildApp({ config, db, modelProviderConfigured: configuredProviders(config).length > 0 });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
