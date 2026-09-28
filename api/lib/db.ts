/**
 * Neon Postgres connection — serverless-safe (no persistent pool).
 *
 * Uses @neondatabase/serverless which is built on HTTP/WebSockets and works
 * inside Vercel serverless functions without connection pooling.
 *
 * Usage:
 *   const rows = await sql.query('SELECT * FROM persons WHERE id = $1', [id]);
 *   const rows = await sql`SELECT now()::text AS now`;   // static SQL only
 */

import { neon, neonConfig } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

if (process.env.NODE_ENV !== 'production') {
  neonConfig.fetchConnectionCache = true;
}

const _neon = neon(DATABASE_URL);

/**
 * Two-shape API:
 *  - `sql\`...\``        tagged-template for static SQL
 *  - `sql.query(s, p)`  dynamic SQL with parameter binding
 */
export interface SqlClient {
  (strings: TemplateStringsArray, ...params: unknown[]): Promise<Record<string, unknown>[]>;
  query<T = Record<string, unknown>>(sqlString: string, params?: unknown[]): Promise<T[]>;
}

export const sql = _neon as unknown as SqlClient;

/** Health check — returns the current server time as text. */
export async function dbHealth(): Promise<string> {
  const rows = await sql`SELECT now()::text AS now`;
  const row = rows[0] as { now: string };
  return row.now;
}