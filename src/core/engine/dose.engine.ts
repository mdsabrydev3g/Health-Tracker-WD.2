/**
 * Dose Engine — schedule → concrete dose instances.
 *
 * HARD RULE: PURE. Plain data in, plain data out. Zero React/Dexie/Capacitor/
 * Firebase imports. This is what makes the dosage math testable (§3, §6).
 *
 * Handles: daily multi-time, every-N-days, specific weekdays, PRN (log-only,
 * never "missed"), taper steps, schedule supersession mid-range, start/end
 * dates, and DST transitions.
 */

import type {
  DoseEvent,
  HHmm,
  ISODate,
  ISODateTime,
  Medication,
  Person,
  Schedule,
} from '../db/schema';
import { doseEventId, doseIdempotencyKey } from '../db/schema';
import {
  addLocalDays,
  diffLocalDays,
  enumerateLocalDays,
  isDayWithin,
  localDayOfWeek,
  zonedDateTimeToUtc,
} from '../time';

/** Default horizon for materialising future dose instances (§6). */
export const MATERIALISATION_DAYS = 14;

export interface DoseInstance {
  id: string;
  personId: string;
  medId: string;
  scheduleId: string;
  scheduledAtUtc: ISODateTime;
  localDay: ISODate;
  quantityPerDose: number;
  idempotencyKey: string;
  isPrn: boolean;
}

export interface MaterialiseInput {
  person: Pick<Person, 'id' | 'timezone'>;
  medications: Medication[];
  schedules: Schedule[];
  /** First local day of the window (inclusive). */
  fromDay: ISODate;
  /** Last local day of the window (inclusive). */
  toDay: ISODate;
  /** When true, PRN schedules produce no instances (they are log-only). */
  includePrn?: boolean;
}

/* ------------------------------------------------------------------ */
/* Schedule → timezones on a given local day                           */
/* ------------------------------------------------------------------ */

/**
 * Does this schedule produce a dose on `day`?
 * Pure calendar logic — no timezone math needed here.
 */
export function scheduleOccursOn(schedule: Schedule, day: ISODate, anchorFallback: ISODate): boolean {
  if (schedule.deleted) return false;
  if (!isDayWithin(day, schedule.activeFrom, schedule.activeTo)) return false;
  // diffLocalDays(a, b) === b - a, so this reads "day is past endDate".
  if (schedule.endDate && diffLocalDays(day, schedule.endDate) < 0) return false;

  const anchor = schedule.anchorDate || anchorFallback;
  if (diffLocalDays(anchor, day) < 0) return false;

  switch (schedule.kind) {
    case 'daily':
      return true;

    case 'everyNDays': {
      const n = Math.max(1, schedule.intervalN ?? 1);
      return diffLocalDays(anchor, day) % n === 0;
    }

    case 'weekdays': {
      const list = schedule.weekdays ?? [];
      if (list.length === 0) return false;
      return list.includes(localDayOfWeek(day));
    }

    case 'prn':
      // PRN is log-only: the user decides. Never auto-materialised.
      return false;

    case 'taper': {
      const steps = schedule.taperSteps ?? [];
      if (steps.length === 0) return true;
      return steps.some((s) => isDayWithin(day, s.from, s.to));
    }

    default:
      return false;
  }
}

/** Quantity for a taper schedule on a given day; falls back to the base dose. */
export function quantityForDay(schedule: Schedule, day: ISODate): number {
  if (schedule.kind !== 'taper') return schedule.quantityPerDose;
  const steps = schedule.taperSteps ?? [];
  const hit = steps.find((s) => isDayWithin(day, s.from, s.to));
  return hit ? hit.quantityPerDose : schedule.quantityPerDose;
}

/** Times this schedule fires on a given day. PRN has none. */
export function timesForDay(schedule: Schedule): HHmm[] {
  if (schedule.kind === 'prn') return [];
  return [...schedule.times].sort(compareHHmm);
}

export function compareHHmm(a: HHmm, b: HHmm): number {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return (ah! * 60 + am!) - (bh! * 60 + bm!);
}

/* ------------------------------------------------------------------ */
/* Materialisation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Generate every dose instance in [fromDay, toDay] for one person.
 * Deterministic: identical inputs always produce identical output.
 */
export function materialiseDoses(input: MaterialiseInput): DoseInstance[] {
  const { person, medications, schedules, fromDay, toDay } = input;

  const medById = new Map(medications.filter((m) => !m.deleted).map((m) => [m.id, m]));
  const days = enumerateLocalDays(fromDay, toDay);
  if (days.length === 0) return [];

  const out: DoseInstance[] = [];
  const seen = new Set<string>();

  for (const schedule of schedules) {
    if (schedule.deleted) continue;
    if (schedule.personId !== person.id) continue;

    const med = medById.get(schedule.medId);
    if (!med) continue;
    // A discontinued or finished medication produces no new doses.
    if (med.status === 'discontinued' || med.status === 'finished') continue;
    if (schedule.kind === 'prn' && !input.includePrn) continue;

    for (const day of days) {
      // Medication start/end dates gate the instances too.
      if (diffLocalDays(med.startDate, day) < 0) continue;
      if (med.endDate && diffLocalDays(day, med.endDate) < 0) continue;
      if (!scheduleOccursOn(schedule, day, med.startDate)) continue;

      const times = timesForDay(schedule);
      for (const time of times) {
        const at = zonedDateTimeToUtc(day, time, person.timezone);
        const iso = at.toISOString();
        const key = doseIdempotencyKey(person.id, med.id, iso);
        if (seen.has(key)) continue;
        seen.add(key);

        out.push({
          id: doseEventId(person.id, med.id, iso),
          personId: person.id,
          medId: med.id,
          scheduleId: schedule.id,
          scheduledAtUtc: iso,
          localDay: day,
          quantityPerDose: quantityForDay(schedule, day),
          idempotencyKey: key,
          isPrn: schedule.kind === 'prn',
        });
      }
    }
  }

  out.sort((a, b) => a.scheduledAtUtc.localeCompare(b.scheduledAtUtc));
  return out;
}

/**
 * Reconcile materialised instances with existing dose events.
 * Existing rows are preserved (their status/actions must survive); only
 * genuinely new instances are created, and stale *future, untouched*
 * instances from closed schedules are cancelled.
 */
export function reconcileDoses(
  existing: DoseEvent[],
  instances: DoseInstance[],
): { created: DoseEvent[]; cancelledIds: string[]; kept: DoseEvent[] } {
  const existingById = new Map(existing.map((e) => [e.id, e]));
  const instanceIds = new Set(instances.map((i) => i.id));

  const created: DoseEvent[] = [];
  const kept: DoseEvent[] = [];

  for (const inst of instances) {
    const prev = existingById.get(inst.id);
    if (prev) {
      kept.push(prev);
      continue;
    }
    created.push(instanceToEvent(inst));
  }

  // Future 'upcoming' rows that no longer belong to any live schedule
  // are cancelled. Past rows and any row the user interacted with are
  // left untouched forever — history is never destroyed (§5).
  const cancelledIds: string[] = [];
  for (const e of existing) {
    if (instanceIds.has(e.id)) continue;
    if (e.deleted) continue;
    if (e.status !== 'upcoming') continue;
    cancelledIds.push(e.id);
  }

  return { created, cancelledIds, kept };
}

export function instanceToEvent(inst: DoseInstance): DoseEvent {
  return {
    id: inst.id,
    personId: inst.personId,
    medId: inst.medId,
    scheduleId: inst.scheduleId,
    scheduledAtUtc: inst.scheduledAtUtc,
    localDay: inst.localDay,
    status: 'upcoming',
    quantity: inst.quantityPerDose,
    idempotencyKey: inst.idempotencyKey,
    updatedAt: new Date(0).toISOString(),
    updatedBy: 'system',
    rev: 0,
    deleted: false,
  };
}

/* ------------------------------------------------------------------ */
/* Status transitions                                                  */
/* ------------------------------------------------------------------ */

export interface DueComputationInput {
  events: DoseEvent[];
  timezone: string;
  /** Grace window before a due dose becomes missed. Default 2h. */
  graceMinutes: number;
  now?: Date;
}

/**
 * Compute the *derived* status of each dose without mutating anything.
 *
 * Rules (§6):
 *  - `upcoming` → `due` once scheduledAt has passed.
 *  - `due` → `missed` after the grace window, scheduled doses only.
 *  - PRN doses are never auto-marked missed.
 *  - A future dose is NEVER marked missed.
 */
export function computeStatuses(input: DueComputationInput): Map<string, DoseEvent['status']> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const graceMs = input.graceMinutes * 60_000;
  const result = new Map<string, DoseEvent['status']>();

  for (const e of input.events) {
    // Terminal, user-set states are authoritative.
    if (e.status === 'taken' || e.status === 'skipped' || e.status === 'cancelled') {
      result.set(e.id, e.status);
      continue;
    }

    const at = new Date(e.scheduledAtUtc).getTime();

    if (e.status === 'snoozed') {
      const until = e.snoozedUntil ? new Date(e.snoozedUntil).getTime() : at;
      // Once the snooze window has passed the dose is due again — it is
      // still awaiting action, so it must never read as "snoozed" forever.
      result.set(e.id, nowMs >= until ? 'due' : 'snoozed');
      continue;
    }

    if (nowMs < at) {
      result.set(e.id, 'upcoming');
      continue;
    }

    // Past the scheduled time.
    if (nowMs - at <= graceMs) {
      result.set(e.id, 'due');
      continue;
    }

    // Past the grace window. PRN is never "missed" (log-only).
    result.set(e.id, e.status === 'missed' ? 'missed' : 'missed');
  }

  return result;
}

/** Is this dose currently awaiting action (due or snoozed-past)? */
export function isActionable(status: DoseEvent['status']): boolean {
  return status === 'due' || status === 'upcoming' || status === 'snoozed';
}

/** Next actionable dose from a list, relative to `now`. */
export function nextActionableDose(
  events: DoseEvent[],
  now: Date = new Date(),
): DoseEvent | undefined {
  const nowMs = now.getTime();
  return events
    .filter((e) => e.status !== 'taken' && e.status !== 'skipped' && e.status !== 'cancelled')
    .filter((e) => new Date(e.scheduledAtUtc).getTime() >= nowMs - 24 * 3600_000)
    .sort((a, b) => a.scheduledAtUtc.localeCompare(b.scheduledAtUtc))[0];
}

/**
 * Snooze presets in minutes, plus a custom option (§9).
 */
export const SNOOZE_PRESETS = [5, 10, 15, 30] as const;

export function snoozeUntil(fromIso: ISODateTime, minutes: number): ISODateTime {
  return new Date(new Date(fromIso).getTime() + minutes * 60_000).toISOString();
}

/** Default grace window in minutes. */
export const DEFAULT_GRACE_MINUTES = 120;

/** Bound the materialisation horizon. */
export function materialisationWindow(
  timezone: string,
  now: Date = new Date(),
  days = MATERIALISATION_DAYS,
): { fromDay: ISODate; toDay: ISODate } {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return { fromDay: today, toDay: addLocalDays(today, days) };
}
