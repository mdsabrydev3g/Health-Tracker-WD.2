/**
 * Sync pull: POST /api/sync/pull
 *
 * Returns every row that changed since the device's last sync token.
 * The client replays these into its local Dexie database.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../lib/db';
import { handleCors } from '../lib/cors';

interface PullBody {
  deviceId: string;
  personId: string;
  lastToken?: string;
}

/**
 * Which column links each table to a person.
 *
 * This is NOT uniform: `persons` identifies the person by its own primary key
 * and `devices` uses `bound_person_id`. Filtering every table on `person_id`
 * throws "column person_id does not exist" and aborts the whole pull.
 */
const PERSON_COLUMN: Record<string, string> = {
  persons: 'id',
  devices: 'bound_person_id',
  notif_prefs: 'person_id',
  medications: 'person_id',
  schedules: 'person_id',
  dose_events: 'person_id',
  inventory_events: 'person_id',
  lab_results: 'person_id',
  documents: 'person_id',
  symptoms: 'person_id',
  food_logs: 'person_id',
  recurring_tests: 'person_id',
};

const TABLES = Object.keys(PERSON_COLUMN);

function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[ck] = v;
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
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
    const personColumn = PERSON_COLUMN[table];
    const rows = await sql.query(
      `SELECT * FROM ${table}
       WHERE ${personColumn} = $1 AND updated_at > $2
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