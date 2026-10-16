import pg from "pg";

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
/** Anything that can run a query: the pool or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, "query">;

// Return BIGINT/NUMERIC counts as JS numbers. Credit balances are bounded well below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));

export function createPool(databaseUrl: string, max = 10): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl, max });
  pool.on("error", (err) => {
    // Idle client errors (e.g. server restart) must not crash the process.
    console.error(JSON.stringify({ level: "error", msg: "postgres idle client error", err: err.message }));
  });
  return pool;
}

export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
