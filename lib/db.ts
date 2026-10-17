import postgres from "postgres";
import { env } from "./env";

type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as { sql?: Sql };

export function db(): Sql {
  globalForDb.sql ??= postgres(env("DATABASE_URL"), { max: 5 });
  return globalForDb.sql;
}
