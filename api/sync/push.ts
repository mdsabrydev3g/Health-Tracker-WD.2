/**
 * Sync push: POST /api/sync/push
 *
 * Receives a batch of mutations from a device and applies them to Neon.
 * Returns any conflicts that need caregiver attention.
 *
 * Security: identifiers are whitelisted by table; values always go through
 * parameter binding ($N placeholders). No user-supplied data is ever
 * concatenated into the SQL string.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../lib/db';
import { applyMutation } from '../lib/sync';
import { handleCors } from '../lib/cors';
import type { SyncEnvelope } from '../../src/core/db/schema';

interface Mutation {
  entity: string;
  entityId: string;
  op: 'upsert' | 'delete';
  payload: Record<string, unknown>;
}

interface PushBody {
  deviceId: string;
  personId: string;
  mutations: Mutation[];
}

const TABLE_MAP: Record<string, string> = {
  persons: 'persons',
  devices: 'devices',
  notifPrefs: 'notif_prefs',
  medications: 'medications',
  schedules: 'schedules',
  doseEvents: 'dose_events',
  inventoryEvents: 'inventory_events',
  labResults: 'lab_results',
  documents: 'documents',
  symptoms: 'symptoms',
  foodLogs: 'food_logs',
  recurringTests: 'recurring_tests',
};

const ALLOWED_COLUMNS: Record<string, Set<string>> = {
  persons: new Set([
    'id', 'name_ar', 'name_en', 'dob', 'gender', 'blood_type', 'allergies',
    'notes', 'emergency_contact', 'color_tag', 'is_minor', 'timezone',
    'large_text_default', 'updated_at', 'updated_by', 'rev', 'deleted',
  ]),
  devices: new Set([
    'id', 'label', 'platform', 'bound_person_id', 'fcm_token', 'last_seen_at',
    'alarm_health', 'updated_at', 'updated_by', 'rev', 'deleted',
  ]),
  notif_prefs: new Set([
    'id', 'device_id', 'person_id', 'mode', 'escalation_delay_min',
    'updated_at', 'updated_by', 'rev', 'deleted',
  ]),
  medications: new Set([
    'id', 'person_id', 'name_ar', 'name_en', 'active_ingredients', 'strength',
    'form', 'package', 'manufacturer', 'notes', 'rx', 'pack_expiry',
    'start_date', 'end_date', 'food_rule', 'cost', 'doctor', 'condition',
    'status', 'discontinued_reason', 'balance_cache', 'updated_at',
    'updated_by', 'rev', 'deleted',
  ]),
  schedules: new Set([
    'id', 'med_id', 'person_id', 'kind', 'times', 'quantity_per_dose',
    'doses_per_day', 'anchor_date', 'end_date', 'weekdays', 'interval_n',
    'prn_max_per_day', 'taper_steps', 'active_from', 'active_to',
    'superseded_by', 'updated_at', 'updated_by', 'rev', 'deleted',
  ]),
  dose_events: new Set([
    'id', 'person_id', 'med_id', 'schedule_id', 'scheduled_at_utc', 'local_day',
    'status', 'acted_at_utc', 'acted_by_device_id', 'quantity', 'source',
    'snoozed_until', 'idempotency_key', 'updated_at', 'updated_by', 'rev', 'deleted',
  ]),
  inventory_events: new Set([
    'id', 'person_id', 'med_id', 'type', 'qty', 'reason', 'prev_balance',
    'new_balance', 'at_utc', 'device_id', 'dose_id', 'updated_at',
    'updated_by', 'rev', 'deleted',
  ]),
  lab_results: new Set([
    'id', 'person_id', 'type', 'date', 'file_ref', 'ai_summary', 'status',
    'updated_at', 'updated_by', 'rev', 'deleted',
  ]),
  documents: new Set([
    'id', 'person_id', 'kind', 'title', 'storage_path', 'size_bytes',
    'mime_type', 'uploaded_at', 'updated_at', 'updated_by', 'rev', 'deleted',
  ]),
  symptoms: new Set([
    'id', 'person_id', 'at_utc', 'severity', 'note', 'related_med_id',
    'updated_at', 'updated_by', 'rev', 'deleted',
  ]),
  food_logs: new Set([
    'id', 'person_id', 'at_utc', 'text', 'related_med_id', 'updated_at',
    'updated_by', 'rev', 'deleted',
  ]),
  recurring_tests: new Set([
    'id', 'person_id', 'name', 'interval', 'custom_interval_days',
    'next_due', 'last_done', 'updated_at', 'updated_by', 'rev', 'deleted',
  ]),
};

/**
 * Convert a camelCase record into its snake_case column form, and drop any
 * column that is not whitelisted for the target table. Every column here
 * is whitelisted; values are still bound as $N parameters.
 */
function sanitiseForTable(
  tableName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = ALLOWED_COLUMNS[tableName];
  if (!allowed) return {};

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const sk = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    if (!allowed.has(sk)) continue;
    out[sk] = v;
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as PushBody;
  if (!body.deviceId || !body.personId || !Array.isArray(body.mutations)) {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const conflicts: { entity: string; entityId: string; reason: string }[] = [];

  for (const m of body.mutations) {
    const table = TABLE_MAP[m.entity];
    if (!table) continue;

    const row = sanitiseForTable(table, m.payload);
    const id = row.id as string | undefined;
    if (!id) continue;

    const existingRows = await sql.query(
      `SELECT * FROM ${table} WHERE id = $1`,
      [id],
    );
    const existing = existingRows[0] as unknown as SyncEnvelope | undefined;

    if (m.op === 'delete') {
      await sql.query(
        `UPDATE ${table} SET deleted = TRUE, rev = rev + 1 WHERE id = $1`,
        [id],
      );
      continue;
    }

    const result = applyMutation(m.entity, existing, row as unknown as SyncEnvelope);

    if (result.action === 'conflict') {
      conflicts.push({
        entity: m.entity,
        entityId: id,
        reason: 'تعارض بيانات — راجع النسخة المحلية.',
      });
      continue;
    }

    const cols = Object.keys(result.row);
    if (cols.length === 0) continue;

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const updates = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const values = cols.map((c) => (result.row as unknown as Record<string, unknown>)[c]);

    await sql.query(
      `INSERT INTO ${table} (${cols.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT (id) DO UPDATE SET ${updates}`,
      values,
    );
  }

  // Bump sync token.
  await sql.query(
    `INSERT INTO sync_tokens (device_id, person_id, last_synced_at, token)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (device_id) DO UPDATE SET last_synced_at = now(), token = EXCLUDED.token`,
    [body.deviceId, body.personId, `${body.deviceId}:${Date.now()}`],
  );

  return res.status(200).json({ ok: true, conflicts });
}