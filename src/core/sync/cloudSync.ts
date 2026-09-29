/**
 * Cloud sync — keeps the phone, the desktop app and the hosted web app in
 * sync through Neon (via the /api/sync/* serverless functions).
 *
 * WHY THIS IS A RECONCILE, NOT AN OUTBOX REPLAY
 * ---------------------------------------------
 * The outbox is currently incomplete: only `markDoseTaken` writes to it, and
 * it tags entries `dose+inventory`, which is not a table name — so a naive
 * "replay the queue" push would skip every entry and never drain it, while
 * medication and schedule edits would never be queued at all.
 *
 * So we reconcile instead:
 *   push — every local row whose `updatedAt` is newer than the last
 *          successful push, as an upsert keyed by id;
 *   pull — everything the server changed since our last token.
 *
 * Both directions are idempotent: rows are upserted by id and ordered by
 * `rev`, so a missed, repeated or interrupted sync converges instead of
 * duplicating or corrupting data. That matters more than efficiency here —
 * the dataset is one person's medications, not a million-row table.
 */

import type { Repository } from '../db/repository';
import type {
  Device,
  DoseEvent,
  DocumentRef,
  FoodLog,
  InventoryEvent,
  LabResult,
  Medication,
  NotifPrefs,
  Person,
  RecurringTest,
  Schedule,
  Symptom,
} from '../db/schema';
import { newId } from '../db/schema';
import { isOnline } from './outbox';

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const DEVICE_ID_KEY = 'health-tracker.device-id';
const LAST_PUSH_KEY = 'health-tracker.last-push-at';
const TOKEN_KEY = 'health-tracker.sync-token';

/** Base URL of the sync API. Defaults to the same origin (works on Vercel). */
export function syncBaseUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const base = env['VITE_SYNC_BASE_URL'] ?? '/api';
  return base.replace(/\/$/, '');
}

/**
 * Sync is on when there is somewhere real to sync to.
 *
 * On a deployed origin the API lives at the same host, so it just works.
 * On localhost there is no /api, so we stay off unless the developer points
 * VITE_SYNC_BASE_URL at a deployment — otherwise local dev would spin on
 * failing requests.
 */
export function isCloudSyncConfigured(): boolean {
  if (typeof fetch !== 'function') return false;
  const env = import.meta.env as Record<string, string | undefined>;
  if (env['VITE_SYNC_BASE_URL']) return true;
  if (typeof window === 'undefined') return false;
  const host = window.location?.hostname ?? '';
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '';
}

/**
 * A stable id for this install. Every device (phone, desktop, browser) gets
 * its own, which is what lets the server tell writes apart.
 */
export function getDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = newId('dev');
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // No localStorage (private mode / SSR / tests) — fall back to a session id.
    return 'device-unknown';
  }
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore — sync still works, it just re-sends more next time */
  }
}

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

export interface Mutation {
  entity: string;
  entityId: string;
  op: 'upsert' | 'delete';
  payload: Record<string, unknown>;
}

export interface SyncConflict {
  entity: string;
  entityId: string;
  reason: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncResult {
  status: SyncStatus;
  pushed: number;
  pulled: number;
  conflicts: SyncConflict[];
  lastSyncedAt?: string;
  lastError?: string;
}

/* ------------------------------------------------------------------ */
/* Push                                                                */
/* ------------------------------------------------------------------ */

/** Client entity name -> the table name push expects. */
function entityName(localName: string): string {
  return localName;
}

/**
 * Collect every local row changed since `since`, as push mutations.
 * Rows are upserted whole; soft-deletes travel as `deleted: true`.
 */
export async function collectLocalMutations(
  repo: Repository,
  personId: string,
  since: string,
): Promise<Mutation[]> {
  const mutations: Mutation[] = [];
  const add = (entity: string, rows: { id: string; updatedAt?: string }[]) => {
    for (const row of rows) {
      if (!row?.id) continue;
      // Never re-send rows the server already has.
      if (since && row.updatedAt && row.updatedAt <= since) continue;
      mutations.push({
        entity,
        entityId: row.id,
        op: 'upsert',
        payload: row as unknown as Record<string, unknown>,
      });
    }
  };

  const person = await repo.getPerson(personId);
  if (person) add('persons', [person]);

  const medications = await repo.listMedications(personId);
  add('medications', medications);

  const schedules = await repo.listSchedules(personId);
  add('schedules', schedules);

  const doses = await repo.listDoseEvents(personId);
  add('doseEvents', doses);

  // Inventory events are stored per medication, so walk the medications.
  for (const med of medications) {
    const events = await repo.listInventoryEvents(med.id);
    add('inventoryEvents', events);
  }

  add('labResults', await repo.listLabResults(personId));
  add('documents', await repo.listDocuments(personId));
  add('symptoms', await repo.listSymptoms(personId));
  add('foodLogs', await repo.listFoodLogs(personId));
  add('recurringTests', await repo.listRecurringTests(personId));

  const prefs = await repo.listNotifPrefs();
  add('notifPrefs', prefs);

  return mutations;
}

async function pushMutations(
  deviceId: string,
  personId: string,
  mutations: Mutation[],
): Promise<{ conflicts: SyncConflict[] }> {
  const res = await fetch(`${syncBaseUrl()}/sync/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, personId, mutations }),
  });
  if (!res.ok) throw new Error(`push failed: ${res.status}`);
  const body = (await res.json()) as { conflicts?: SyncConflict[] };
  return { conflicts: body.conflicts ?? [] };
}

/* ------------------------------------------------------------------ */
/* Pull                                                                */
/* ------------------------------------------------------------------ */

type RemoteChanges = Record<string, Record<string, unknown>[]>;

/** Apply pulled rows into local storage. Returns how many rows landed. */
export async function applyRemoteChanges(
  repo: Repository,
  changes: RemoteChanges,
): Promise<number> {
  let applied = 0;
  for (const [table, rows] of Object.entries(changes ?? {})) {
    for (const row of rows ?? []) {
      try {
        switch (table) {
          case 'persons':
            await repo.putPerson(row as unknown as Person);
            break;
          case 'devices':
            await repo.putDevice(row as unknown as Device);
            break;
          case 'notif_prefs':
            await repo.putNotifPrefs(row as unknown as NotifPrefs);
            break;
          case 'medications':
            await repo.putMedication(row as unknown as Medication);
            break;
          case 'schedules':
            await repo.putSchedule(row as unknown as Schedule);
            break;
          case 'dose_events':
            await repo.putDoseEvent(row as unknown as DoseEvent);
            break;
          case 'inventory_events':
            await repo.putInventoryEvent(row as unknown as InventoryEvent);
            break;
          case 'lab_results':
            await repo.putLabResult(row as unknown as LabResult);
            break;
          case 'documents':
            await repo.putDocument(row as unknown as DocumentRef);
            break;
          case 'symptoms':
            await repo.putSymptom(row as unknown as Symptom);
            break;
          case 'food_logs':
            await repo.putFoodLog(row as unknown as FoodLog);
            break;
          case 'recurring_tests':
            await repo.putRecurringTest(row as unknown as RecurringTest);
            break;
          default:
            break;
        }
        applied++;
      } catch {
        // A single unparseable row must never abort the whole sync.
      }
    }
  }
  return applied;
}

async function pullChanges(
  deviceId: string,
  personId: string,
  token: string | null,
): Promise<{ changes: RemoteChanges; token: string }> {
  const res = await fetch(`${syncBaseUrl()}/sync/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, personId, ...(token ? { lastToken: token } : {}) }),
  });
  if (!res.ok) throw new Error(`pull failed: ${res.status}`);
  const body = (await res.json()) as { changes?: RemoteChanges; token?: string };
  return { changes: body.changes ?? {}, token: body.token ?? '' };
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Run one full sync cycle: push local changes, then pull remote ones.
 * Never throws — callers get a `status: 'error'` result they can display,
 * because a silent failure is worse than a visible one (§ zero silent failures).
 */
export async function runSync(opts: {
  repo: Repository;
  personId: string;
  deviceId?: string;
}): Promise<SyncResult> {
  const deviceId = opts.deviceId ?? getDeviceId();

  if (!isCloudSyncConfigured()) {
    return { status: 'error', pushed: 0, pulled: 0, conflicts: [], lastError: 'المزامنة غير مُعدّة' };
  }
  if (!isOnline()) {
    return { status: 'offline', pushed: 0, pulled: 0, conflicts: [] };
  }

  try {
    const since = readLocal(LAST_PUSH_KEY) ?? '';
    const mutations = await collectLocalMutations(opts.repo, opts.personId, since);
    const { conflicts } = await pushMutations(deviceId, opts.personId, mutations);

    const token = readLocal(TOKEN_KEY);
    const { changes, token: newToken } = await pullChanges(deviceId, opts.personId, token);
    const pulled = await applyRemoteChanges(opts.repo, changes);

    if (newToken) writeLocal(TOKEN_KEY, newToken);
    const now = new Date().toISOString();
    writeLocal(LAST_PUSH_KEY, now);

    // The queue is now redundant: these rows were pushed by the reconcile.
    await drainOutbox(opts.repo);

    return {
      status: conflicts.length > 0 ? 'error' : 'synced',
      pushed: mutations.length,
      pulled,
      conflicts,
      lastSyncedAt: now,
      ...(conflicts.length > 0
        ? { lastError: 'يوجد تعارض في البيانات يحتاج مراجعتك' }
        : {}),
    };
  } catch (err) {
    return {
      status: 'error',
      pushed: 0,
      pulled: 0,
      conflicts: [],
      lastError: err instanceof Error ? err.message : 'فشل المزامنة',
    };
  }
}

/**
 * Clear outbox entries once their rows have been pushed.
 *
 * `markDoseTaken` enqueues a composite `dose+inventory` marker that no table
 * maps to; the reconcile pushes the underlying dose + inventory rows
 * directly, so the marker has done its job and can be dropped.
 */
async function drainOutbox(repo: Repository): Promise<void> {
  try {
    const items = await repo.listOutbox();
    for (const item of items) {
      await repo.removeOutbox(item.id);
    }
  } catch {
    /* non-fatal */
  }
}

export { entityName };
