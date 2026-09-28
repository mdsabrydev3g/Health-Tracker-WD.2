/**
 * Timezone, local-day boundary, and DST-safe helpers.
 *
 * HARD RULE: pure TypeScript. No React / Dexie / Capacitor / Firebase.
 *
 * Key principle (§6): a dose scheduled for 08:00 local must be 08:00 local
 * on BOTH sides of a DST transition. We therefore store UTC instants but
 * always *compute* them from the local wall-clock time in the person's
 * IANA timezone — never by adding a fixed offset.
 *
 * Africa/Cairo reintroduced DST in 2023, so a hardcoded +02:00 is wrong
 * for part of the year.
 */

import type { HHmm, ISODate, ISODateTime } from '../db/schema';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* Formatting / parsing primitives                                     */
/* ------------------------------------------------------------------ */

/** 'YYYY-MM-DD' for a Date interpreted in the given timezone. */
export function toLocalDay(date: Date, timeZone: string): ISODate {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return f.format(date); // en-CA gives YYYY-MM-DD
}

/** Local wall-clock parts for an instant in a timezone. */
export function getLocalParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    f
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    // Intl can render midnight as 24 in some locales/engines — normalise.
    hour: (parts.hour ?? 0) % 24,
    minute: parts.minute ?? 0,
  };
}

/** Parse 'YYYY-MM-DD' into calendar numbers. */
export function parseLocalDay(day: ISODate): { year: number; month: number; day: number } {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid local day: ${day}`);
  return { year: y, month: m, day: d };
}

/** Parse 'HH:mm' into hours/minutes. */
export function parseHHmm(time: HHmm): { hour: number; minute: number } {
  const [h, m] = time.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Invalid time: ${time}`);
  }
  return { hour: h, minute: m };
}

/** Format hour/minute back to 'HH:mm'. */
export function formatHHmm(hour: number, minute: number): HHmm {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Convert a local wall-clock date+time in a timezone into a UTC instant.
 *
 * Uses the standard "guess then correct" technique so it stays correct
 * across DST boundaries:
 *   1. Build the instant as if the zone were UTC.
 *   2. Ask Intl what wall-clock that instant actually shows in the zone.
 *   3. Apply the difference and re-check once (handles the DST shift).
 */
export function zonedDateTimeToUtc(
  day: ISODate,
  time: HHmm,
  timeZone: string,
): Date {
  const { year, month, day: d } = parseLocalDay(day);
  const { hour, minute } = parseHHmm(time);

  const asUtc = Date.UTC(year, month - 1, d, hour, minute, 0, 0);

  // Step 1: offset at the naive instant.
  let guess = asUtc - tzOffsetMs(new Date(asUtc), timeZone);
  // Step 2: re-check at the corrected instant; a DST boundary can move it.
  guess = asUtc - tzOffsetMs(new Date(guess), timeZone);
  // Step 3: one more pass settles the ambiguous/folded hour.
  guess = asUtc - tzOffsetMs(new Date(guess), timeZone);

  return new Date(guess);
}

/** Offset in ms between the zone's wall clock and UTC at a given instant. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const p = getLocalParts(date, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  // Drop sub-minute components of the real instant before comparing.
  const actual = Math.floor(date.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE;
  return asIfUtc - actual;
}

/* ------------------------------------------------------------------ */
/* Calendar arithmetic (timezone-safe, never naive ms addition)        */
/* ------------------------------------------------------------------ */

/** Add n calendar days to a local day string. */
export function addLocalDays(day: ISODate, n: number): ISODate {
  const { year, month, day: d } = parseLocalDay(day);
  const base = new Date(Date.UTC(year, month - 1, d));
  base.setUTCDate(base.getUTCDate() + n);
  return utcToLocalDayString(base);
}

/** Shift an ISODate by whole months, clamping to the last valid day. */
export function addLocalMonths(day: ISODate, n: number): ISODate {
  const { year, month, day: d } = parseLocalDay(day);
  const targetMonthIndex = month - 1 + n;
  const ty = year + Math.floor(targetMonthIndex / 12);
  const tm = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day2 = Math.min(d, lastDay);
  return utcToLocalDayString(new Date(Date.UTC(ty, tm, day2)));
}

/** Whole calendar days between two local days (b - a). */
export function diffLocalDays(a: ISODate, b: ISODate): number {
  const pa = parseLocalDay(a);
  const pb = parseLocalDay(b);
  const ua = Date.UTC(pa.year, pa.month - 1, pa.day);
  const ub = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((ub - ua) / MS_PER_DAY);
}

/** Day of week for a local day. 0 = Sunday … 6 = Saturday. */
export function localDayOfWeek(day: ISODate): number {
  const { year, month, day: d } = parseLocalDay(day);
  return new Date(Date.UTC(year, month - 1, d)).getUTCDay();
}

/** Clean helper: a Date that is purely a UTC calendar carrier. */
export function utcToLocalDayString(date: Date): ISODate {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Is a local day strictly between two bounds (inclusive)? */
export function isDayWithin(day: ISODate, from?: ISODate | null, to?: ISODate | null): boolean {
  if (from && diffLocalDays(from, day) < 0) return false;
  if (to && diffLocalDays(day, to) < 0) return false;
  return true;
}

/** Last calendar day of a month, e.g. monthEndDay(2024, 2) === 29. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/* ------------------------------------------------------------------ */
/* Now / instants                                                      */
/* ------------------------------------------------------------------ */

export function nowUtc(): Date {
  return new Date();
}

export function toIso(date: Date): ISODateTime {
  return date.toISOString();
}

export function fromIso(iso: ISODateTime): Date {
  return new Date(iso);
}

/** Milliseconds until an instant (negative if past). */
export function msUntil(iso: ISODateTime, now: Date = new Date()): number {
  return fromIso(iso).getTime() - now.getTime();
}

export function minutesBetween(aIso: ISODateTime, bIso: ISODateTime): number {
  return (fromIso(bIso).getTime() - fromIso(aIso).getTime()) / MS_PER_MINUTE;
}

/** Enumerate local days from `from` to `to` inclusive (bounded for safety). */
export function enumerateLocalDays(from: ISODate, to: ISODate, maxDays = 400): ISODate[] {
  const out: ISODate[] = [];
  const span = diffLocalDays(from, to);
  if (span < 0) return out;
  const limit = Math.min(span, maxDays);
  let cursor = from;
  for (let i = 0; i <= limit; i++) {
    out.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  return out;
}

/** Human Arabic-friendly day label ('اليوم' / 'أمس' / 'غداً' / formatted). */
export function friendlyDayLabel(day: ISODate, today: ISODate, locale = 'ar-EG'): string {
  const delta = diffLocalDays(today, day);
  if (delta === 0) return 'اليوم';
  if (delta === -1) return 'أمس';
  if (delta === 1) return 'غداً';
  const { year, month, day: d } = parseLocalDay(day);
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(Math.abs(delta) > 300 ? { year: 'numeric' } : {}),
  }).format(new Date(Date.UTC(year, month - 1, d)));
}

/** Format a UTC instant as local time in the person's zone. */
export function formatLocalTime(iso: ISODateTime, timeZone: string, locale = 'ar-EG'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(fromIso(iso));
}

/** Format a UTC instant as a local date+time in the person's zone. */
export function formatLocalDateTime(iso: ISODateTime, timeZone: string, locale = 'ar-EG'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(fromIso(iso));
}

/** Current local day for a timezone. */
export function todayInZone(timeZone: string, now: Date = new Date()): ISODate {
  return toLocalDay(now, timeZone);
}

/** Alias kept for ergonomics — same as todayInZone. */
export function todayIn(timeZone: string, now: Date = new Date()): ISODate {
  return toLocalDay(now, timeZone);
}

/** Arabic weekday names, 0 = Sunday … 6 = Saturday. */
export const WEEKDAY_LABELS = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;
