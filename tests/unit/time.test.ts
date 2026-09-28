import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  addLocalMonths,
  daysInMonth,
  diffLocalDays,
  enumerateLocalDays,
  formatHHmm,
  getLocalParts,
  isDayWithin,
  localDayOfWeek,
  parseHHmm,
  toLocalDay,
  tzOffsetMs,
  zonedDateTimeToUtc,
} from '@/core/time';

describe('calendar arithmetic', () => {
  it('handles leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it('crosses month boundaries when adding days', () => {
    expect(addLocalDays('2024-01-31', 1)).toBe('2024-02-01');
    expect(addLocalDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addLocalDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addLocalDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addLocalDays('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('crosses year boundaries backwards', () => {
    expect(addLocalDays('2025-01-01', -1)).toBe('2024-12-31');
    expect(addLocalDays('2024-01-01', -365)).toBe('2023-01-01');
    // 2024 is a leap year: 366 days back from Jan 1 2025 is Jan 1 2024.
    expect(addLocalDays('2025-01-01', -366)).toBe('2024-01-01');
  });

  it('clamps month arithmetic to the last valid day', () => {
    expect(addLocalMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addLocalMonths('2023-01-31', 1)).toBe('2023-02-28');
    expect(addLocalMonths('2024-03-31', -1)).toBe('2024-02-29');
    expect(addLocalMonths('2024-01-15', 12)).toBe('2025-01-15');
  });

  it('computes day differences across boundaries', () => {
    expect(diffLocalDays('2024-01-01', '2024-01-31')).toBe(30);
    expect(diffLocalDays('2024-01-31', '2024-01-01')).toBe(-30);
    expect(diffLocalDays('2024-02-28', '2024-03-01')).toBe(2);
    expect(diffLocalDays('2023-12-31', '2024-01-01')).toBe(1);
  });

  it('derives the correct day of week', () => {
    // 2024-01-01 was a Monday (1).
    expect(localDayOfWeek('2024-01-01')).toBe(1);
    expect(localDayOfWeek('2024-01-07')).toBe(0); // Sunday
    expect(localDayOfWeek('2026-09-28')).toBe(1); // Monday
  });

  it('checks day-within bounds inclusively', () => {
    expect(isDayWithin('2024-05-15', '2024-05-01', '2024-05-31')).toBe(true);
    expect(isDayWithin('2024-05-01', '2024-05-01', '2024-05-31')).toBe(true);
    expect(isDayWithin('2024-05-31', '2024-05-01', '2024-05-31')).toBe(true);
    expect(isDayWithin('2024-06-01', '2024-05-01', '2024-05-31')).toBe(false);
    expect(isDayWithin('2024-05-15', null, null)).toBe(true);
  });

  it('enumerates days inclusively', () => {
    const days = enumerateLocalDays('2024-02-27', '2024-03-02');
    expect(days).toEqual(['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02']);
  });

  it('returns an empty list when the range is inverted', () => {
    expect(enumerateLocalDays('2024-03-02', '2024-02-27')).toEqual([]);
  });
});

describe('time parsing and formatting', () => {
  it('round-trips HH:mm', () => {
    expect(parseHHmm('08:30')).toEqual({ hour: 8, minute: 30 });
    expect(formatHHmm(8, 30)).toBe('08:30');
    expect(formatHHmm(0, 0)).toBe('00:00');
    expect(formatHHmm(23, 59)).toBe('23:59');
  });

  it('throws on malformed input', () => {
    expect(() => parseHHmm('8')).toThrow();
    expect(() => parseHHmm('aa:bb')).toThrow();
  });
});

describe('timezone conversion (Africa/Cairo, which reintroduced DST in 2023)', () => {
  it('converts a local wall clock to the correct UTC instant in winter', () => {
    // Cairo is UTC+2 in winter.
    const at = zonedDateTimeToUtc('2024-01-15', '08:00', 'Africa/Cairo');
    expect(at.toISOString()).toBe('2024-01-15T06:00:00.000Z');
  });

  it('converts a local wall clock to the correct UTC instant in summer (DST)', () => {
    // Cairo is UTC+3 during DST.
    const at = zonedDateTimeToUtc('2024-07-15', '08:00', 'Africa/Cairo');
    expect(at.toISOString()).toBe('2024-07-15T05:00:00.000Z');
  });

  it('keeps an 08:00 local dose at 08:00 local across a DST transition', () => {
    // Cairo DST 2024 began on 2024-04-26.
    const before = zonedDateTimeToUtc('2024-04-25', '08:00', 'Africa/Cairo');
    const after = zonedDateTimeToUtc('2024-04-27', '08:00', 'Africa/Cairo');

    expect(getLocalParts(before, 'Africa/Cairo').hour).toBe(8);
    expect(getLocalParts(before, 'Africa/Cairo').minute).toBe(0);
    expect(getLocalParts(after, 'Africa/Cairo').hour).toBe(8);
    expect(getLocalParts(after, 'Africa/Cairo').minute).toBe(0);

    // The UTC offset genuinely changed, so a fixed-offset implementation
    // would have drifted the local time by an hour.
    expect(tzOffsetMs(before, 'Africa/Cairo')).not.toBe(tzOffsetMs(after, 'Africa/Cairo'));
  });

  it('derives the correct local day from a UTC instant near midnight', () => {
    // 2024-06-01T21:30Z is 2024-06-02 00:30 in Cairo (UTC+3 during DST).
    expect(toLocalDay(new Date('2024-06-01T21:30:00Z'), 'Africa/Cairo')).toBe('2024-06-02');
    // 2024-06-01T20:30Z is 2024-06-01 23:30 in Cairo.
    expect(toLocalDay(new Date('2024-06-01T20:30:00Z'), 'Africa/Cairo')).toBe('2024-06-01');
  });

  it('handles a different timezone correctly', () => {
    // Riyadh is a fixed UTC+3 all year (no DST).
    expect(zonedDateTimeToUtc('2024-01-15', '08:00', 'Asia/Riyadh').toISOString()).toBe(
      '2024-01-15T05:00:00.000Z',
    );
    expect(zonedDateTimeToUtc('2024-07-15', '08:00', 'Asia/Riyadh').toISOString()).toBe(
      '2024-07-15T05:00:00.000Z',
    );
  });
});
