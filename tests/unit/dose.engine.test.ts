import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRACE_MINUTES,
  computeStatuses,
  materialiseDoses,
  quantityForDay,
  reconcileDoses,
  scheduleOccursOn,
  snoozeUntil,
} from '@/core/engine/dose.engine';
import type { DoseEvent, Medication, Person, Schedule } from '@/core/db/schema';
import { doseEventId, doseIdempotencyKey } from '@/core/db/schema';
import { getLocalParts, todayIn } from '@/core/time';

/* ---------------- fixtures ---------------- */

const PERSON: Pick<Person, 'id' | 'timezone'> = { id: 'per_1', timezone: 'Africa/Cairo' };

function makeMed(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med_1',
    personId: 'per_1',
    nameAr: 'دواء اختبار',
    activeIngredients: [],
    strength: { value: 10, unit: 'mg' },
    form: 'tablet',
    package: { kind: 'direct', pillCount: 30 },
    rx: { isPrescription: true, isControlled: false },
    foodRule: { mode: 'with' },
    cost: { packagePrice: 30, currency: 'EGP', packageSize: 30 },
    startDate: '2024-01-01',
    status: 'active',
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'dev',
    rev: 1,
    deleted: false,
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sch_1',
    medId: 'med_1',
    personId: 'per_1',
    kind: 'daily',
    times: ['08:00'],
    quantityPerDose: 1,
    dosesPerDay: 1,
    anchorDate: '2024-01-01',
    activeFrom: '2024-01-01',
    activeTo: null,
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'dev',
    rev: 1,
    deleted: false,
    ...overrides,
  };
}

/* ---------------- occurrence rules ---------------- */

describe('scheduleOccursOn', () => {
  it('fires every day for a daily schedule', () => {
    const s = makeSchedule();
    expect(scheduleOccursOn(s, '2024-06-01', '2024-01-01')).toBe(true);
    expect(scheduleOccursOn(s, '2024-06-02', '2024-01-01')).toBe(true);
  });

  it('respects every-N-days from the anchor', () => {
    const s = makeSchedule({ kind: 'everyNDays', intervalN: 3, anchorDate: '2024-01-01' });
    expect(scheduleOccursOn(s, '2024-01-01', '2024-01-01')).toBe(true);
    expect(scheduleOccursOn(s, '2024-01-02', '2024-01-01')).toBe(false);
    expect(scheduleOccursOn(s, '2024-01-04', '2024-01-01')).toBe(true);
    expect(scheduleOccursOn(s, '2024-01-07', '2024-01-01')).toBe(true);
  });

  it('matches only the configured weekdays', () => {
    // 0 = Sunday. Mondays are index 1.
    const s = makeSchedule({ kind: 'weekdays', weekdays: [1, 3] });
    expect(scheduleOccursOn(s, '2024-01-01', '2024-01-01')).toBe(true); // Monday
    expect(scheduleOccursOn(s, '2024-01-02', '2024-01-01')).toBe(false); // Tuesday
    expect(scheduleOccursOn(s, '2024-01-03', '2024-01-01')).toBe(true); // Wednesday
  });

  it('never auto-fires a PRN schedule', () => {
    const s = makeSchedule({ kind: 'prn', times: [], prnMaxPerDay: 3 });
    expect(scheduleOccursOn(s, '2024-01-01', '2024-01-01')).toBe(false);
  });

  it('stops after activeTo (schedule supersession)', () => {
    const s = makeSchedule({ activeFrom: '2024-01-01', activeTo: '2024-03-31' });
    expect(scheduleOccursOn(s, '2024-03-31', '2024-01-01')).toBe(true);
    expect(scheduleOccursOn(s, '2024-04-01', '2024-01-01')).toBe(false);
  });

  it('stops at the schedule endDate', () => {
    const s = makeSchedule({ endDate: '2024-02-15' });
    expect(scheduleOccursOn(s, '2024-02-15', '2024-01-01')).toBe(true);
    expect(scheduleOccursOn(s, '2024-02-16', '2024-01-01')).toBe(false);
  });
});

describe('taper quantity', () => {
  const taper = makeSchedule({
    kind: 'taper',
    quantityPerDose: 2,
    taperSteps: [
      { from: '2024-01-01', to: '2024-01-07', quantityPerDose: 2 },
      { from: '2024-01-08', to: '2024-01-14', quantityPerDose: 1 },
      { from: '2024-01-15', to: '2024-01-21', quantityPerDose: 0.5 },
    ],
  });

  it('returns the step quantity for each phase', () => {
    expect(quantityForDay(taper, '2024-01-03')).toBe(2);
    expect(quantityForDay(taper, '2024-01-10')).toBe(1);
    expect(quantityForDay(taper, '2024-01-20')).toBe(0.5);
  });

  it('falls back to the base dose outside the steps', () => {
    expect(quantityForDay(taper, '2024-02-01')).toBe(2);
  });
});

/* ---------------- materialisation ---------------- */

describe('materialiseDoses', () => {
  it('produces one instance per time per day', () => {
    const med = makeMed();
    const sched = makeSchedule({ times: ['08:00', '20:00'], dosesPerDay: 2 });

    const doses = materialiseDoses({
      person: PERSON,
      medications: [med],
      schedules: [sched],
      fromDay: '2024-01-01',
      toDay: '2024-01-03',
    });

    expect(doses).toHaveLength(6);
    expect(doses[0]!.localDay).toBe('2024-01-01');
    expect(doses[0]!.scheduledAtUtc).toBe('2024-01-01T06:00:00.000Z'); // 08:00 Cairo winter
    expect(doses[1]!.scheduledAtUtc).toBe('2024-01-01T18:00:00.000Z'); // 20:00 Cairo winter
  });

  it('is deterministic and idempotent across repeated calls', () => {
    const med = makeMed();
    const sched = makeSchedule({ times: ['08:00', '14:00', '21:00'], dosesPerDay: 3 });
    const input = {
      person: PERSON,
      medications: [med],
      schedules: [sched],
      fromDay: '2024-05-01',
      toDay: '2024-05-05',
    };

    const first = materialiseDoses(input);
    const second = materialiseDoses(input);

    expect(second).toEqual(first);
    // Ids are deterministic, so a re-materialisation cannot duplicate rows.
    expect(new Set(first.map((d) => d.id)).size).toBe(first.length);
  });

  it('keeps 08:00 local across the Cairo DST transition', () => {
    const med = makeMed();
    const sched = makeSchedule({ times: ['08:00'] });

    const doses = materialiseDoses({
      person: PERSON,
      medications: [med],
      schedules: [sched],
      fromDay: '2024-04-25',
      toDay: '2024-04-27',
    });

    for (const d of doses) {
      const parts = getLocalParts(new Date(d.scheduledAtUtc), 'Africa/Cairo');
      expect(parts.hour).toBe(8);
      expect(parts.minute).toBe(0);
    }
    // The UTC instants differ because the offset changed.
    expect(doses[0]!.scheduledAtUtc).not.toBe(doses[1]!.scheduledAtUtc.slice(0, 10) + 'T06:00:00.000Z');
  });

  it('skips discontinued medications entirely', () => {
    const med = makeMed({ status: 'discontinued' });
    const doses = materialiseDoses({
      person: PERSON,
      medications: [med],
      schedules: [makeSchedule()],
      fromDay: '2024-01-01',
      toDay: '2024-01-05',
    });
    expect(doses).toHaveLength(0);
  });

  it('never materialises PRN doses for the schedule view', () => {
    const med = makeMed();
    const doses = materialiseDoses({
      person: PERSON,
      medications: [med],
      schedules: [makeSchedule({ kind: 'prn', times: [] })],
      fromDay: '2024-01-01',
      toDay: '2024-01-05',
    });
    expect(doses).toHaveLength(0);
  });

  it('produces a unique idempotency key per instance', () => {
    const doses = materialiseDoses({
      person: PERSON,
      medications: [makeMed()],
      schedules: [makeSchedule({ times: ['08:00', '20:00'] })],
      fromDay: '2024-02-01',
      toDay: '2024-02-02',
    });
    const keys = doses.map((d) => d.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe(doseIdempotencyKey('per_1', 'med_1', doses[0]!.scheduledAtUtc));
    expect(doses[0]!.id).toBe(doseEventId('per_1', 'med_1', doses[0]!.scheduledAtUtc));
  });

  it('handles a schedule that becomes active mid-window', () => {
    const med = makeMed({ startDate: '2024-01-01' });
    const sched = makeSchedule({ activeFrom: '2024-01-03' });
    const doses = materialiseDoses({
      person: PERSON,
      medications: [med],
      schedules: [sched],
      fromDay: '2024-01-01',
      toDay: '2024-01-05',
    });
    expect(doses.map((d) => d.localDay)).toEqual(['2024-01-03', '2024-01-04', '2024-01-05']);
  });

  it('respects the medication start date', () => {
    const med = makeMed({ startDate: '2024-03-01' });
    const doses = materialiseDoses({
      person: PERSON,
      medications: [med],
      schedules: [makeSchedule()],
      fromDay: '2024-02-27',
      toDay: '2024-03-02',
    });
    expect(doses.map((d) => d.localDay)).toEqual(['2024-03-01', '2024-03-02']);
  });
});

/* ---------------- reconciliation ---------------- */

describe('reconcileDoses', () => {
  it('creates only genuinely new instances', () => {
    const doses = materialiseDoses({
      person: PERSON,
      medications: [makeMed()],
      schedules: [makeSchedule()],
      fromDay: '2024-01-01',
      toDay: '2024-01-03',
    });

    const existing: DoseEvent[] = [
      {
        id: doses[0]!.id,
        personId: 'per_1',
        medId: 'med_1',
        scheduleId: 'sch_1',
        scheduledAtUtc: doses[0]!.scheduledAtUtc,
        localDay: '2024-01-01',
        status: 'taken',
        quantity: 1,
        idempotencyKey: doses[0]!.idempotencyKey,
        updatedAt: '2024-01-01T00:00:00.000Z',
        updatedBy: 'dev',
        rev: 2,
        deleted: false,
      },
    ];

    const result = reconcileDoses(existing, doses);
    expect(result.created).toHaveLength(2);
    // The taken row is preserved, not overwritten.
    expect(result.kept[0]!.status).toBe('taken');
  });

  it('cancels stale future rows that no longer belong to a live schedule', () => {
    const stale: DoseEvent = {
      id: 'dose_orphan',
      personId: 'per_1',
      medId: 'med_1',
      scheduleId: 'sch_old',
      scheduledAtUtc: '2030-01-01T06:00:00.000Z',
      localDay: '2030-01-01',
      status: 'upcoming',
      idempotencyKey: 'k',
      updatedAt: '2024-01-01T00:00:00.000Z',
      updatedBy: 'dev',
      rev: 1,
      deleted: false,
    };

    const result = reconcileDoses([stale], []);
    expect(result.cancelledIds).toEqual(['dose_orphan']);
  });

  it('never cancels a row the user already acted on', () => {
    const acted: DoseEvent = {
      id: 'dose_acted',
      personId: 'per_1',
      medId: 'med_1',
      scheduleId: 'sch_old',
      scheduledAtUtc: '2024-01-01T06:00:00.000Z',
      localDay: '2024-01-01',
      status: 'taken',
      idempotencyKey: 'k2',
      updatedAt: '2024-01-01T00:00:00.000Z',
      updatedBy: 'dev',
      rev: 2,
      deleted: false,
    };

    const result = reconcileDoses([acted], []);
    expect(result.cancelledIds).toEqual([]);
  });
});

/* ---------------- status transitions ---------------- */

describe('computeStatuses', () => {
  function ev(id: string, at: string, status: DoseEvent['status'] = 'upcoming'): DoseEvent {
    return {
      id,
      personId: 'per_1',
      medId: 'med_1',
      scheduleId: 'sch_1',
      scheduledAtUtc: at,
      localDay: at.slice(0, 10),
      status,
      idempotencyKey: id,
      updatedAt: '2024-01-01T00:00:00.000Z',
      updatedBy: 'dev',
      rev: 1,
      deleted: false,
    };
  }

  const now = new Date('2024-06-15T12:00:00.000Z');

  it('marks a future dose as upcoming, never missed', () => {
    const events = [ev('a', '2024-06-16T06:00:00.000Z')];
    const map = computeStatuses({ events, timezone: 'Africa/Cairo', graceMinutes: 120, now });
    expect(map.get('a')).toBe('upcoming');
  });

  it('marks a dose inside the grace window as due', () => {
    const events = [ev('b', '2024-06-15T11:00:00.000Z')]; // 1h ago, grace is 2h
    const map = computeStatuses({ events, timezone: 'Africa/Cairo', graceMinutes: 120, now });
    expect(map.get('b')).toBe('due');
  });

  it('marks a dose past the grace window as missed', () => {
    const events = [ev('c', '2024-06-15T09:00:00.000Z')]; // 3h ago
    const map = computeStatuses({ events, timezone: 'Africa/Cairo', graceMinutes: 120, now });
    expect(map.get('c')).toBe('missed');
  });

  it('treats exactly-now as due', () => {
    const events = [ev('d', now.toISOString())];
    const map = computeStatuses({ events, timezone: 'Africa/Cairo', graceMinutes: 120, now });
    expect(map.get('d')).toBe('due');
  });

  it('does not override a user-set terminal status', () => {
    const events = [
      ev('e', '2024-06-15T09:00:00.000Z', 'taken'),
      ev('f', '2024-06-15T09:00:00.000Z', 'skipped'),
      ev('g', '2024-06-15T09:00:00.000Z', 'cancelled'),
    ];
    const map = computeStatuses({ events, timezone: 'Africa/Cairo', graceMinutes: 120, now });
    expect(map.get('e')).toBe('taken');
    expect(map.get('f')).toBe('skipped');
    expect(map.get('g')).toBe('cancelled');
  });

  it('returns a snoozed dose to due once the snooze expires', () => {
    // now is 12:00Z and the snooze ran out at 11:30Z.
    const snoozed = { ...ev('h', '2024-06-15T09:00:00.000Z', 'snoozed'), snoozedUntil: '2024-06-15T11:30:00.000Z' };
    const map = computeStatuses({ events: [snoozed], timezone: 'Africa/Cairo', graceMinutes: 120, now });
    expect(map.get('h')).toBe('due');
  });

  it('keeps a snoozed dose snoozed while the window is open', () => {
    // now is 12:00Z and the snooze runs until 14:00Z.
    const snoozed = { ...ev('i', '2024-06-15T09:00:00.000Z', 'snoozed'), snoozedUntil: '2024-06-15T14:00:00.000Z' };
    const map = computeStatuses({ events: [snoozed], timezone: 'Africa/Cairo', graceMinutes: 120, now });
    expect(map.get('i')).toBe('snoozed');
  });

  it('uses a 2h default grace window', () => {
    expect(DEFAULT_GRACE_MINUTES).toBe(120);
  });
});

describe('snoozeUntil', () => {
  it('adds the requested minutes', () => {
    expect(snoozeUntil('2024-06-15T09:00:00.000Z', 15)).toBe('2024-06-15T09:15:00.000Z');
    expect(snoozeUntil('2024-06-15T09:00:00.000Z', 60)).toBe('2024-06-15T10:00:00.000Z');
  });
});

describe('todayIn', () => {
  it('returns the local day for the zone, not the UTC day', () => {
    const at = new Date('2024-06-01T22:00:00Z'); // 01:00 next day in Cairo
    expect(todayIn('Africa/Cairo', at)).toBe('2024-06-02');
    expect(todayIn('UTC', at)).toBe('2024-06-01');
  });
});
