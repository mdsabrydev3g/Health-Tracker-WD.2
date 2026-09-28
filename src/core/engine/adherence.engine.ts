/**
 * Adherence Engine — taken / missed / skipped statistics and streaks.
 *
 * HARD RULE: PURE. No React / Dexie / Capacitor / Firebase.
 *
 * Neutral wording only (§8). Never shame the mother.
 */

import type { DoseEvent, ISODate } from '../db/schema';
import { addLocalDays, diffLocalDays, enumerateLocalDays } from '../time';

export interface AdherenceWindow {
  taken: number;
  missed: number;
  skipped: number;
  /** Doses not yet due — excluded from the denominator. */
  notYetDue: number;
  totalConsidered: number;
  /** taken / (taken + missed + skipped). null when the denominator is 0. */
  percent: number | null;
}

/**
 * Compute adherence over a set of doses.
 * Only doses whose scheduled time has passed are counted (§8).
 */
export function computeAdherence(
  events: DoseEvent[],
  now: Date = new Date(),
  options: { excludePrn?: boolean; prnScheduleIds?: Set<string> } = {},
): AdherenceWindow {
  const nowMs = now.getTime();
  const excludePrn = options.excludePrn ?? true;
  const prnIds = options.prnScheduleIds ?? new Set<string>();

  let taken = 0;
  let missed = 0;
  let skipped = 0;
  let notYetDue = 0;

  for (const e of events) {
    if (e.deleted) continue;
    if (e.status === 'cancelled') continue;
    if (excludePrn && prnIds.has(e.scheduleId)) continue;

    const status = e.status;
    const dueAt = new Date(e.scheduledAtUtc).getTime();

    switch (status) {
      case 'taken':
        taken++;
        break;
      case 'missed':
        missed++;
        break;
      case 'skipped':
        skipped++;
        break;
      default:
        // upcoming | due | snoozed — only count as "not yet due" when the
        // clock hasn't passed it. A `due` dose is unresolved, not missed.
        if (dueAt > nowMs) notYetDue++;
        break;
    }
  }

  const totalConsidered = taken + missed + skipped;
  const percent = totalConsidered === 0 ? null : round1((taken / totalConsidered) * 100);

  return { taken, missed, skipped, notYetDue, totalConsidered, percent };
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Adherence restricted to a single local day. */
export function adherenceForDay(
  events: DoseEvent[],
  day: ISODate,
  now: Date = new Date(),
): AdherenceWindow {
  return computeAdherence(
    events.filter((e) => e.localDay === day),
    now,
  );
}

/** Adherence over the trailing N local days ending at `today`. */
export function adherenceForRange(
  events: DoseEvent[],
  fromDay: ISODate,
  toDay: ISODate,
  now: Date = new Date(),
): AdherenceWindow {
  return computeAdherence(
    events.filter((e) => diffLocalDays(fromDay, e.localDay) >= 0 && diffLocalDays(e.localDay, toDay) >= 0),
    now,
  );
}

/* ------------------------------------------------------------------ */
/* Streaks                                                             */
/* ------------------------------------------------------------------ */

/**
 * Consecutive local days with zero missed scheduled doses.
 * Today only breaks a streak once a dose on it is already missed.
 */
export function currentStreak(
  events: DoseEvent[],
  today: ISODate,
  now: Date = new Date(),
): number {
  const byDay = new Map<ISODate, DoseEvent[]>();
  for (const e of events) {
    if (e.deleted) continue;
    const list = byDay.get(e.localDay) ?? [];
    list.push(e);
    byDay.set(e.localDay, list);
  }

  // The earliest day we have any data for — the streak can't predate it.
  let earliest: ISODate | null = null;
  for (const day of byDay.keys()) {
    if (!earliest || diffLocalDays(day, earliest) > 0) earliest = day;
  }
  if (!earliest) return 0;

  // A streak starts at the most recent day that actually has doses; leading
  // empty days (nothing scheduled yet) must not inflate the count.
  let streak = 0;
  const maxLookback = Math.min(3650, Math.abs(diffLocalDays(earliest, today)) + 1);

  for (let i = 0; i < maxLookback; i++) {
    const day = addLocalDays(today, -i);
    const list = byDay.get(day) ?? [];

    if (list.some((e) => deriveMissed(e, now))) break;

    // A day with no scheduled doses is neutral: it neither breaks nor
    // extends the streak.
    const hadScheduled = list.some((e) => e.status !== 'cancelled');
    if (hadScheduled) streak++;
  }

  return streak;
}

function deriveMissed(e: DoseEvent, now: Date): boolean {
  if (e.status === 'missed') return true;
  return e.status === 'due' && new Date(e.scheduledAtUtc).getTime() < now.getTime() - 12 * 3600_000;
}

/**
 * Best (longest) streak across the dataset.
 *
 * We walk the FULL calendar between the first and last recorded day, not just
 * the days that happen to have rows — otherwise a gap would silently join two
 * separate streaks into one.
 */
export function bestStreak(events: DoseEvent[], now: Date = new Date()): number {
  const live = events.filter((e) => !e.deleted);
  if (live.length === 0) return 0;

  const byDay = new Map<ISODate, DoseEvent[]>();
  let first: ISODate | null = null;
  let last: ISODate | null = null;

  for (const e of live) {
    const list = byDay.get(e.localDay) ?? [];
    list.push(e);
    byDay.set(e.localDay, list);
    if (!first || diffLocalDays(e.localDay, first) > 0) first = e.localDay;
    if (!last || diffLocalDays(last, e.localDay) > 0) last = e.localDay;
  }
  if (!first || !last) return 0;

  let best = 0;
  let run = 0;

  for (const day of enumerateLocalDays(first, last, 3650)) {
    const list = byDay.get(day) ?? [];

    if (list.some((e) => deriveMissed(e, now))) {
      run = 0;
      continue;
    }

    // Neutral days (nothing scheduled) neither break nor extend the streak.
    if (list.some((e) => e.status !== 'cancelled')) {
      run++;
      if (run > best) best = run;
    }
  }

  return best;
}

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */

export function adherenceGrade(percent: number | null): 'excellent' | 'good' | 'fair' | 'attention' | 'unknown' {
  if (percent === null) return 'unknown';
  if (percent >= 95) return 'excellent';
  if (percent >= 85) return 'good';
  if (percent >= 70) return 'fair';
  return 'attention';
}

/**
 * Arabic pluralisation for doses: جرعة / جرعتان / جرعات.
 * Never naively concatenate a number and a label (§14).
 */
export function arabicDoseCount(n: number): string {
  if (n === 0) return 'لا جرعات';
  if (n === 1) return 'جرعة واحدة';
  if (n === 2) return 'جرعتان';
  if (n >= 3 && n <= 10) return `${n} جرعات`;
  return `${n} جرعة`;
}

export function arabicDayCount(n: number): string {
  if (n === 0) return 'لا أيام';
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومان';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يوماً`;
}

export function arabicMissedCount(n: number): string {
  if (n === 0) return 'لا جرعات فائتة';
  if (n === 1) return 'جرعة فائتة واحدة';
  if (n === 2) return 'جرعتان فائتتان';
  if (n >= 3 && n <= 10) return `${n} جرعات فائتة`;
  return `${n} جرعة فائتة`;
}
