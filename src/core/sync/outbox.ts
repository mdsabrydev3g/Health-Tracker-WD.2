/**
 * Sync layer — offline outbox, conflict resolution, Firestore bridge.
 *
 * The app is offline-first: every mutation lands locally first and is queued
 * in the outbox. When connectivity returns, queued mutations replay.
 *
 * Firebase is imported lazily so the web build works with no config, and so
 * the offline path never touches the network module.
 */

import type { SyncEnvelope } from '../db/schema';
import { newId } from '../db/schema';
import type { OutboxItem } from '../db/schema';

/* ------------------------------------------------------------------ */
/* Outbox                                                              */
/* ------------------------------------------------------------------ */

export function buildOutboxItem(input: {
  entity: string;
  entityId: string;
  op: 'upsert' | 'delete';
  payload: unknown;
  at?: Date;
}): OutboxItem {
  return {
    id: newId('out'),
    entity: input.entity,
    entityId: input.entityId,
    op: input.op,
    payload: input.payload,
    createdAtUtc: (input.at ?? new Date()).toISOString(),
    attempts: 0,
  };
}

/** Should we keep retrying, or give up and surface the failure? */
export function shouldRetry(item: OutboxItem, maxAttempts = 8): boolean {
  return item.attempts < maxAttempts;
}

/** Exponential backoff in ms, capped at 5 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(300_000, 2 ** Math.min(attempts, 10) * 1000);
}

/** A mutation is replay-safe when its id is deterministic. */
export function isReplaySafe(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && 'id' in (payload as object);
}

/* ------------------------------------------------------------------ */
/* Conflict resolution (§12)                                           */
/* ------------------------------------------------------------------ */

export type ConflictDecision =
  | { kind: 'takeLocal' }
  | { kind: 'takeRemote' }
  | { kind: 'merge'; merged: SyncEnvelope }
  | { kind: 'askCaregiver'; reason: string };

/** Fields where a newer write must NEVER be silently overwritten (§12). */
const CLINICAL_FIELDS = [
  'quantityPerDose',
  'times',
  'kind',
  'strength',
  'activeIngredients',
  'status',
] as const;

export function isClinicalEntity(entity: string): boolean {
  return entity === 'medications' || entity === 'schedules';
}

/**
 * Resolve a divergence between the local and remote copy of a document.
 * Non-clinical fields: last-writer-wins on `rev`.
 * Clinical fields: surface a conflict card instead of guessing.
 */
export function resolveConflict<T extends SyncEnvelope>(
  entity: string,
  local: T,
  remote: T,
): ConflictDecision {
  if (remote.deleted && !local.deleted) {
    // A remote soft-delete loses to a newer local edit.
    return local.rev > remote.rev + 1 ? { kind: 'takeLocal' } : { kind: 'takeRemote' };
  }
  if (local.rev > remote.rev) return { kind: 'takeLocal' };
  if (remote.rev > local.rev) {
    if (isClinicalEntity(entity) && divergesOnClinicalFields(asRecord(local), asRecord(remote))) {
      return {
        kind: 'askCaregiver',
        reason: 'تغيّر في بيانات دواء أو جدول جرعات من جهاز آخر — راجع أي نسخة تريد الاحتفاظ بها.',
      };
    }
    return { kind: 'takeRemote' };
  }
  return { kind: 'takeLocal' };
}

export function divergesOnClinicalFields(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  return CLINICAL_FIELDS.some((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
}

/** Narrow any entity to a keyed record for field-level comparison. */
function asRecord(entity: SyncEnvelope): Record<string, unknown> {
  return entity as unknown as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Firebase bridge (lazy)                                              */
/* ------------------------------------------------------------------ */

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export function readFirebaseConfig(): FirebaseConfig | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const cfg = {
    apiKey: env['VITE_FIREBASE_API_KEY'] ?? '',
    authDomain: env['VITE_FIREBASE_AUTH_DOMAIN'] ?? '',
    projectId: env['VITE_FIREBASE_PROJECT_ID'] ?? '',
    storageBucket: env['VITE_FIREBASE_STORAGE_BUCKET'] ?? '',
    messagingSenderId: env['VITE_FIREBASE_MESSAGING_SENDER_ID'] ?? '',
    appId: env['VITE_FIREBASE_APP_ID'] ?? '',
  };
  if (!cfg.apiKey || !cfg.projectId) return null;
  return cfg;
}

export function isSyncConfigured(): boolean {
  return readFirebaseConfig() !== null;
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'unconfigured';

export interface SyncState {
  status: SyncStatus;
  pending: number;
  lastSyncedAt?: string;
  lastError?: string;
  conflicts: { entity: string; entityId: string; reason: string }[];
}

export const INITIAL_SYNC_STATE: SyncState = {
  status: 'unconfigured',
  pending: 0,
  conflicts: [],
};

/**
 * Cloud Functions endpoint for AI. Never called from the client with keys —
 * only the function URL is referenced, and the function holds the secret (§11).
 */
export function aiFunctionUrl(functionName: 'summariseLab' | 'scanMedication'): string | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const base = env['VITE_FUNCTIONS_BASE_URL'];
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/${functionName}`;
}

export function isAiConfigured(): boolean {
  return aiFunctionUrl('summariseLab') !== null;
}

/* ------------------------------------------------------------------ */
/* Connectivity                                                        */
/* ------------------------------------------------------------------ */

export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export function registerConnectivityHandlers(onChange: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const up = () => onChange(true);
  const down = () => onChange(false);
  window.addEventListener('online', up);
  window.addEventListener('offline', down);
  return () => {
    window.removeEventListener('online', up);
    window.removeEventListener('offline', down);
  };
}
