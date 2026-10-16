import { loadConfig } from "../config.js";
import { migrate } from "./migrate.js";
import { createPool } from "./pool.js";

const config = loadConfig();
const db = createPool(config.DATABASE_URL, 1);
try {
  const applied = await migrate(db);
  console.log(JSON.stringify({ level: "info", msg: "migrations complete", applied }));
} finally {
  await db.end();
}
