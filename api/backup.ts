/**
 * POST /api/backup
 *
 * Nightly automated backup trigger (called by a Vercel Cron job).
 * Dumps the full person dataset as JSON.
 *
 * Requires the request to carry x-backup-secret header set to BACKUP_SECRET.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from './lib/db';
import { handleCors } from './lib/cors';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-backup-secret'];
  if (secret !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const personId = (req.query.personId as string | undefined) ?? null;

  const dump: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const rows = personId
      ? await sql.query(`SELECT * FROM ${table} WHERE person_id = $1`, [personId])
      : await sql.query(`SELECT * FROM ${table}`);
    dump[table] = rows;
  }

  // TODO: in production, upload dump to S3/R2 instead of returning inline.
  return res.status(200).json({
    ok: true,
    exportedAt: new Date().toISOString(),
    personId: personId ?? 'all',
    rowCounts: Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length])),
    dump,
  });
}