/**
 * Server-side sync helpers — push/pull and conflict resolution.
 *
 * These mirror the client-side `resolveConflict` logic in
 * src/core/sync/outbox.ts so the server can make the same decisions
 * when it receives a batch of mutations.
 */

import type { SyncEnvelope } from '../../src/core/db/schema';

export type ConflictDecision =
  | { kind: 'takeLocal' }
  | { kind: 'takeRemote' }
  | { kind: 'merge'; merged: SyncEnvelope }
  | { kind: 'askCaregiver'; reason: string };

const CLINICAL_FIELDS = [
  'quantityPerDose',
  'times',
  'kind',
  'strength',
  'activeIngredients',
  'status',
] as const;

function isClinicalEntity(entity: string): boolean {
  return entity === 'medications' || entity === 'schedules';
}

function asRecord(entity: SyncEnvelope): Record<string, unknown> {
  return entity as unknown as Record<string, unknown>;
}

function divergesOnClinicalFields(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return CLINICAL_FIELDS.some((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
}

export function resolveConflict<T extends SyncEnvelope>(
  entity: string,
  local: T,
  remote: T,
): ConflictDecision {
  if (remote.deleted && !local.deleted) {
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

/** Upsert a row, respecting rev-based conflict rules. */
export function applyMutation<T extends SyncEnvelope>(
  entity: string,
  existing: T | undefined,
  incoming: T,
): { action: 'insert' | 'update' | 'conflict'; row: T } {
  if (!existing) {
    return { action: 'insert', row: incoming };
  }
  const decision = resolveConflict(entity, existing, incoming);
  if (decision.kind === 'takeLocal') {
    return { action: 'conflict', row: existing };
  }
  if (decision.kind === 'takeRemote' || decision.kind === 'merge') {
    return { action: 'update', row: { ...incoming, rev: Math.max(existing.rev, incoming.rev) + 1 } };
  }
  return { action: 'conflict', row: existing };
}
