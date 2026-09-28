import { describe, expect, it } from 'vitest';
import {
  adherenceGrade,
  arabicDayCount,
  arabicDoseCount,
  arabicMissedCount,
  bestStreak,
  computeAdherence,
  currentStreak,
} from '@/core/engine/adherence.engine';
import type { DoseEvent } from '@/core/db/schema';

function ev(
  id: string,
  localDay: string,
  status: DoseEvent['status'],
  scheduledAtUtc = `${localDay}T06:00:00.000Z`,
): DoseEvent {
  return {
    id,
    personId: 'per_1',
    medId: 'med_1',
    scheduleId: 'sch_1',
    scheduledAtUtc,
    localDay,
    status,
    idempotencyKey: id,
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'dev',
    rev: 1,
    deleted: false,
  };
}

const NOW = new Date('2024-06-30T12:00:00.000Z');

describe('computeAdherence', () => {
  it('computes taken / (taken + missed + skipped)', () => {
    const events = [
      ev('a', '2024-06-01', 'taken'),
      ev('b', '2024-06-02', 'taken'),
      ev('c', '2024-06-03', 'taken'),
      ev('d', '2024-06-04', 'missed'),
    ];
    const a = computeAdherence(events, NOW);
    expect(a.taken).toBe(3);
    expect(a.missed).toBe(1);
    expect(a.percent).toBe(75);
    expect(a.totalConsidered).toBe(4);
  });

  it('excludes future doses from the denominator', () => {
    const events = [
      ev('a', '2024-06-01', 'taken'),
      ev('b', '2024-07-15', 'upcoming', '2024-07-15T06:00:00.000Z'),
    ];
    const a = computeAdherence(events, NOW);
    expect(a.taken).toBe(1);
    expect(a.notYetDue).toBe(1);
    expect(a.totalConsidered).toBe(1);
    expect(a.percent).toBe(100);
  });

  it('never counts a not-yet-due dose as missed', () => {
    const events = [ev('a', '2024-07-15', 'upcoming', '2024-07-15T06:00:00.000Z')];
    const a = computeAdherence(events, NOW);
    expect(a.missed).toBe(0);
    expect(a.percent).toBeNull();
  });

  it('excludes cancelled doses entirely', () => {
    const events = [ev('a', '2024-06-01', 'taken'), ev('b', '2024-06-02', 'cancelled')];
    const a = computeAdherence(events, NOW);
    expect(a.totalConsidered).toBe(1);
    expect(a.percent).toBe(100);
  });

  it('counts skipped separately but includes it in the denominator', () => {
    const events = [
      ev('a', '2024-06-01', 'taken'),
      ev('b', '2024-06-02', 'skipped'),
    ];
    const a = computeAdherence(events, NOW);
    expect(a.skipped).toBe(1);
    expect(a.percent).toBe(50);
  });

  it('excludes PRN schedules when told to', () => {
    const prn = { ...ev('p', '2024-06-01', 'missed'), scheduleId: 'sch_prn' };
    const events = [ev('a', '2024-06-01', 'taken'), prn];
    const a = computeAdherence(events, NOW, { excludePrn: true, prnScheduleIds: new Set(['sch_prn']) });
    expect(a.missed).toBe(0);
    expect(a.percent).toBe(100);
  });

  it('returns null percent for an empty denominator', () => {
    expect(computeAdherence([], NOW).percent).toBeNull();
  });

  it('ignores soft-deleted doses', () => {
    const events = [
      ev('a', '2024-06-01', 'taken'),
      { ...ev('b', '2024-06-02', 'missed'), deleted: true },
    ];
    expect(computeAdherence(events, NOW).percent).toBe(100);
  });

  it('handles a perfect record', () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      ev(`t${i}`, `2024-06-${String(i + 1).padStart(2, '0')}`, 'taken'),
    );
    expect(computeAdherence(events, NOW).percent).toBe(100);
  });
});

describe('currentStreak', () => {
  it('counts consecutive clean days up to today', () => {
    const events = [
      ev('a', '2024-06-30', 'taken'),
      ev('b', '2024-06-29', 'taken'),
      ev('c', '2024-06-28', 'taken'),
      ev('d', '2024-06-27', 'missed'),
    ];
    expect(currentStreak(events, '2024-06-30', NOW)).toBe(3);
  });

  it('returns zero when today already has a miss', () => {
    const events = [ev('a', '2024-06-30', 'missed')];
    expect(currentStreak(events, '2024-06-30', NOW)).toBe(0);
  });

  it('does not break on days with no scheduled doses, nor count them', () => {
    const events = [
      ev('a', '2024-06-30', 'taken'),
      // 2024-06-29 has nothing scheduled — neutral, so it is skipped.
      ev('c', '2024-06-28', 'taken'),
    ];
    // Two days that actually had doses, with a neutral gap between them.
    expect(currentStreak(events, '2024-06-30', NOW)).toBe(2);
  });

  it('does not inflate the streak from leading empty days', () => {
    // Only one day of history; the streak must be 1, not 3650.
    const events = [ev('a', '2024-06-30', 'taken')];
    expect(currentStreak(events, '2024-06-30', NOW)).toBe(1);
  });

  it('returns zero when there is no history at all', () => {
    expect(currentStreak([], '2024-06-30', NOW)).toBe(0);
  });
});

describe('bestStreak', () => {
  it('finds the longest clean run in history', () => {
    const events = [
      ev('a', '2024-06-01', 'taken'),
      ev('b', '2024-06-02', 'taken'),
      ev('c', '2024-06-03', 'missed'),
      ev('d', '2024-06-04', 'taken'),
      ev('e', '2024-06-05', 'taken'),
      ev('f', '2024-06-06', 'taken'),
      ev('g', '2024-06-07', 'taken'),
    ];
    expect(bestStreak(events, NOW)).toBe(4);
  });

  it('returns zero for an empty history', () => {
    expect(bestStreak([], NOW)).toBe(0);
  });
});

describe('adherenceGrade', () => {
  it('grades by threshold', () => {
    expect(adherenceGrade(97)).toBe('excellent');
    expect(adherenceGrade(95)).toBe('excellent');
    expect(adherenceGrade(88)).toBe('good');
    expect(adherenceGrade(75)).toBe('fair');
    expect(adherenceGrade(50)).toBe('attention');
    expect(adherenceGrade(null)).toBe('unknown');
  });
});

describe('Arabic pluralisation (§14 — never naive count + label)', () => {
  it('pluralises dose counts correctly', () => {
    expect(arabicDoseCount(0)).toBe('لا جرعات');
    expect(arabicDoseCount(1)).toBe('جرعة واحدة');
    expect(arabicDoseCount(2)).toBe('جرعتان');
    expect(arabicDoseCount(3)).toBe('3 جرعات');
    expect(arabicDoseCount(10)).toBe('10 جرعات');
    expect(arabicDoseCount(11)).toBe('11 جرعة');
  });

  it('pluralises day counts correctly', () => {
    expect(arabicDayCount(0)).toBe('لا أيام');
    expect(arabicDayCount(1)).toBe('يوم واحد');
    expect(arabicDayCount(2)).toBe('يومان');
    expect(arabicDayCount(5)).toBe('5 أيام');
    expect(arabicDayCount(15)).toBe('15 يوماً');
  });

  it('pluralises missed-dose counts correctly', () => {
    expect(arabicMissedCount(0)).toBe('لا جرعات فائتة');
    expect(arabicMissedCount(1)).toBe('جرعة فائتة واحدة');
    expect(arabicMissedCount(2)).toBe('جرعتان فائتتان');
    expect(arabicMissedCount(4)).toBe('4 جرعات فائتة');
    expect(arabicMissedCount(20)).toBe('20 جرعة فائتة');
  });
});
