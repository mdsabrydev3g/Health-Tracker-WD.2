/**
 * Sync pull: POST /api/sync/pull
 *
 * Returns every row that changed since the device's last sync token.
 * The client replays these into its local Dexie database.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../lib/db';

interface PullBody {
  deviceId: string;
  personId: string;
  lastToken?: string;
}

const TABLES = [
  'persons',
  'devices',
  'notif_prefs',
  'medications',
  'schedules',
  'dose_events',
  'inventory_events',
  'lab_results',
  'documents',
  'symptoms',
  'food_logs',
  'recurring_tests',
] as const;

function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[ck] = v;
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as PullBody;
  if (!body.deviceId || !body.personId) {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const tokenRows = await sql.query(
    `SELECT last_synced_at FROM sync_tokens WHERE device_id = $1 AND person_id = $2`,
    [body.deviceId, body.personId],
  );
  const since = tokenRows[0]?.last_synced_at ?? '1970-01-01T00:00:00Z';

  const changes: Record<string, Record<string, unknown>[]> = {};

  for (const table of TABLES) {
    const rows = await sql.query(
      `SELECT * FROM ${table}
       WHERE person_id = $1 AND updated_at > $2
       ORDER BY updated_at`,
      [body.personId, since],
    );
    changes[table] = rows.map((r) => snakeToCamel(r as Record<string, unknown>));
  }

  const newToken = `${body.deviceId}:${Date.now()}`;
  await sql.query(
    `INSERT INTO sync_tokens (device_id, person_id, last_synced_at, token)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (device_id) DO UPDATE SET last_synced_at = now(), token = EXCLUDED.token`,
    [body.deviceId, body.personId, newToken],
  );

  return res.status(200).json({ changes, token: newToken });
}