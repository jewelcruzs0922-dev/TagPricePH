import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * Postgres access for the app. Reads go through a lazily-created shared pool
 * so server components and route handlers reuse connections instead of
 * opening one per request.
 *
 * Migrations do NOT use this module — see scripts/migrate.mjs, which runs on
 * the unpooled connection.
 */

let pool: Pool | null = null;

function resolveConnectionString(): string {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Missing POSTGRES_URL (or DATABASE_URL). Run `vercel env pull .env.local` or " +
        "set it in the deployment environment.",
    );
  }
  return url;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: resolveConnectionString(),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", (error) => {
      console.error("Unexpected Postgres pool error:", error.message);
    });
  }
  return pool;
}

/** Run a parameterised query and return its rows. */
export async function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<Row[]> {
  const result = await getPool().query<Row>(text, params as unknown[]);
  return result.rows;
}

/** Run a parameterised query and return the first row, or null. */
export async function queryOne<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<Row | null> {
  const rows = await query<Row>(text, params);
  return rows[0] ?? null;
}

/** Acquire a connection for work that must span several statements. */
export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
