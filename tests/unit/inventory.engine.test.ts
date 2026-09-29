import { describe, expect, it } from 'vitest';
import {
  alreadyConsumed,
  buildInventoryEvent,
  dailyConsumption,
  dosesRemaining,
  foldBalance,
  isExpired,
  projectStock,
  roundQty,
  stockFraction,
  unitLabelAr,
  unitsForDays,
} from '@/core/engine/inventory.engine';
import type { InventoryEvent, Medication, Schedule } from '@/core/db/schema';

function makeEvent(overrides: Partial<InventoryEvent> = {}): InventoryEvent {
  return {
    id: `inv_${Math.random().toString(36).slice(2, 8)}`,
    personId: 'per_1',
    medId: 'med_1',
    type: 'initial',
    qty: 0,
    prevBalance: 0,
    newBalance: 0,
    atUtc: '2024-01-01T00:00:00.000Z',
    deviceId: 'dev_1',
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'dev_1',
    rev: 1,
    deleted: false,
    ...overrides,
  };
}

function makeMed(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med_1',
    personId: 'per_1',
    nameAr: 'دواء',
    activeIngredients: [],
    strength: { value: 10, unit: 'mg' },
    form: 'tablet',
    package: { kind: 'direct', pillCount: 30 },
    rx: { isPrescription: true, isControlled: false },
    foodRule: { mode: 'with' },
    cost: { packagePrice: 60, currency: 'EGP', packageSize: 30 },
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

describe('foldBalance', () => {
  it('sums signed quantities', () => {
    const events = [
      makeEvent({ type: 'initial', qty: 30 }),
      makeEvent({ type: 'doseTaken', qty: -1 }),
      makeEvent({ type: 'doseTaken', qty: -1 }),
      makeEvent({ type: 'purchase', qty: 30 }),
    ];
    expect(foldBalance(events).balance).toBe(58);
  });

  it('ignores soft-deleted events', () => {
    const events = [
      makeEvent({ type: 'initial', qty: 30 }),
      makeEvent({ type: 'correction', qty: -5, deleted: true }),
    ];
    expect(foldBalance(events).balance).toBe(30);
  });

  it('never reports a negative balance', () => {
    const events = [makeEvent({ type: 'doseTaken', qty: -5 })];
    expect(foldBalance(events).balance).toBe(0);
  });

  it('handles fractional doses', () => {
    const events = [
      makeEvent({ type: 'initial', qty: 10 }),
      makeEvent({ type: 'doseTaken', qty: -0.5 }),
      makeEvent({ type: 'doseTaken', qty: -0.25 }),
    ];
    expect(foldBalance(events).balance).toBe(9.25);
  });

  it('returns zero for an empty log', () => {
    const r = foldBalance([]);
    expect(r.balance).toBe(0);
    expect(r.eventCount).toBe(0);
  });
});

describe('roundQty', () => {
  it('rounds to three decimals', () => {
    expect(roundQty(1.0004)).toBe(1);
    expect(roundQty(0.1234)).toBe(0.123);
    expect(roundQty(2.5)).toBe(2.5);
  });
});

describe('dailyConsumption', () => {
  it('computes one unit per day for a single daily dose', () => {
    expect(dailyConsumption('med_1', [makeSchedule()], '2024-06-01')).toBe(1);
  });

  it('computes three units per day for three daily doses', () => {
    const s = makeSchedule({ times: ['08:00', '14:00', '21:00'], dosesPerDay: 3 });
    expect(dailyConsumption('med_1', [s], '2024-06-01')).toBe(3);
  });

  it('accounts for quantity per dose', () => {
    const s = makeSchedule({ times: ['08:00', '20:00'], quantityPerDose: 2 });
    expect(dailyConsumption('med_1', [s], '2024-06-01')).toBe(4);
  });

  it('averages an every-2-days schedule to 0.5/day', () => {
    const s = makeSchedule({ kind: 'everyNDays', intervalN: 2 });
    expect(dailyConsumption('med_1', [s], '2024-06-01')).toBe(0.5);
  });

  it('excludes PRN schedules (log-only, user-decided)', () => {
    const s = makeSchedule({ kind: 'prn', times: [] });
    expect(dailyConsumption('med_1', [s], '2024-06-01')).toBe(0);
  });

  it('excludes closed schedules', () => {
    const s = makeSchedule({ activeTo: '2024-05-31' });
    expect(dailyConsumption('med_1', [s], '2024-06-01')).toBe(0);
  });

  it('excludes schedules belonging to another medication', () => {
    const s = makeSchedule({ medId: 'med_other' });
    expect(dailyConsumption('med_1', [s], '2024-06-01')).toBe(0);
  });

  it('averages weekly schedules over the sample window', () => {
    // Saturday only (index 6) → ~1/7 per day.
    const s = makeSchedule({ kind: 'weekdays', weekdays: [6] });
    const rate = dailyConsumption('med_1', [s], '2024-06-01', 28);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThanOrEqual(0.15);
  });
});

describe('projectStock', () => {
  it('computes remaining days and depletion date', () => {
    const events = [makeEvent({ type: 'initial', qty: 10 })];
    const proj = projectStock({
      medication: makeMed(),
      schedules: [makeSchedule()],
      events,
      today: '2024-06-01',
      lowStockThresholdDays: 2,
    });
    expect(proj.balance).toBe(10);
    expect(proj.dailyConsumption).toBe(1);
    expect(proj.remainingDays).toBe(10);
    expect(proj.depletionDate).toBe('2024-06-11');
    expect(proj.isLow).toBe(false);
  });

  it('flags low stock within the threshold', () => {
    const events = [makeEvent({ type: 'initial', qty: 2 })];
    const proj = projectStock({
      medication: makeMed(),
      schedules: [makeSchedule()],
      events,
      today: '2024-06-01',
      lowStockThresholdDays: 2,
    });
    expect(proj.isLow).toBe(true);
  });

  it('flags expiry-before-depletion as a distinct failure mode', () => {
    // 30 days of stock, but the pack expires in 10 days.
    const events = [makeEvent({ type: 'initial', qty: 30 })];
    const proj = projectStock({
      medication: makeMed({ packExpiry: '2024-06-11' }),
      schedules: [makeSchedule()],
      events,
      today: '2024-06-01',
      lowStockThresholdDays: 2,
    });
    expect(proj.depletionDate).toBe('2024-07-01');
    expect(proj.expiresBeforeDepletion).toBe(true);
    expect(proj.daysUntilExpiry).toBe(10);
  });

  it('does not flag expiry when stock runs out first', () => {
    const events = [makeEvent({ type: 'initial', qty: 5 })];
    const proj = projectStock({
      medication: makeMed({ packExpiry: '2024-12-31' }),
      schedules: [makeSchedule()],
      events,
      today: '2024-06-01',
      lowStockThresholdDays: 2,
    });
    expect(proj.expiresBeforeDepletion).toBe(false);
  });

  it('reports infinite cover when nothing is consumed', () => {
    const proj = projectStock({
      medication: makeMed(),
      schedules: [makeSchedule({ kind: 'prn', times: [] })],
      events: [makeEvent({ type: 'initial', qty: 50 })],
      today: '2024-06-01',
      lowStockThresholdDays: 2,
    });
    expect(proj.remainingDays).toBe(Number.POSITIVE_INFINITY);
    expect(proj.depletionDate).toBeNull();
    expect(proj.isLow).toBe(false);
  });

  it('is correct across partial doses and refills', () => {
    const events = [
      makeEvent({ type: 'initial', qty: 10, atUtc: '2024-06-01T00:00:00.000Z' }),
      makeEvent({ type: 'doseTaken', qty: -0.5, atUtc: '2024-06-01T06:00:00.000Z' }),
      makeEvent({ type: 'doseTaken', qty: -0.5, atUtc: '2024-06-02T06:00:00.000Z' }),
      makeEvent({ type: 'purchase', qty: 10, atUtc: '2024-06-03T06:00:00.000Z' }),
    ];
    const proj = projectStock({
      medication: makeMed(),
      schedules: [makeSchedule({ quantityPerDose: 0.5 })],
      events,
      today: '2024-06-03',
      lowStockThresholdDays: 2,
    });
    expect(proj.balance).toBe(19);
    expect(proj.dailyConsumption).toBe(0.5);
    expect(proj.remainingDays).toBe(38);
  });
});

describe('isExpired', () => {
  it('detects an expired pack', () => {
    expect(isExpired('2024-05-31', '2024-06-01')).toBe(true);
    expect(isExpired('2024-06-01', '2024-06-01')).toBe(false);
    expect(isExpired('2024-06-02', '2024-06-01')).toBe(false);
    expect(isExpired(undefined, '2024-06-01')).toBe(false);
  });
});

describe('buildInventoryEvent', () => {
  it('maintains prev/new balance correctly', () => {
    const e = buildInventoryEvent({
      id: 'inv_1',
      personId: 'per_1',
      medId: 'med_1',
      type: 'doseTaken',
      qty: -1,
      prevBalance: 10,
      atUtc: '2024-06-01T06:00:00.000Z',
      deviceId: 'dev_1',
      doseId: 'dose_1',
    });
    expect(e.prevBalance).toBe(10);
    expect(e.newBalance).toBe(9);
    expect(e.doseId).toBe('dose_1');
  });

  it('handles an addition', () => {
    const e = buildInventoryEvent({
      id: 'inv_2',
      personId: 'per_1',
      medId: 'med_1',
      type: 'purchase',
      qty: 30,
      prevBalance: 5,
      atUtc: '2024-06-01T06:00:00.000Z',
      deviceId: 'dev_1',
    });
    expect(e.newBalance).toBe(35);
  });
});

describe('alreadyConsumed (double-tap / offline-retry guard)', () => {
  it('detects an existing doseTaken event for the same dose', () => {
    const events = [makeEvent({ type: 'doseTaken', qty: -1, doseId: 'dose_1' })];
    expect(alreadyConsumed(events, 'dose_1')).toBe(true);
  });

  it('returns false for a different dose', () => {
    const events = [makeEvent({ type: 'doseTaken', qty: -1, doseId: 'dose_1' })];
    expect(alreadyConsumed(events, 'dose_2')).toBe(false);
  });

  it('ignores deleted events', () => {
    const events = [makeEvent({ type: 'doseTaken', qty: -1, doseId: 'dose_1', deleted: true })];
    expect(alreadyConsumed(events, 'dose_1')).toBe(false);
  });

  it('is not fooled by a non-doseTaken event carrying the same doseId', () => {
    const events = [makeEvent({ type: 'correction', qty: -1, doseId: 'dose_1' })];
    expect(alreadyConsumed(events, 'dose_1')).toBe(false);
  });
});

describe('helpers', () => {
  it('computes units for a target number of days', () => {
    expect(unitsForDays(30, 2)).toBe(60);
    expect(unitsForDays(30, 0.5)).toBe(15);
  });

  it('clamps the stock fraction to 0..1', () => {
    expect(stockFraction(15, 30)).toBe(0.5);
    expect(stockFraction(-5, 30)).toBe(0);
    expect(stockFraction(50, 30)).toBe(1);
    expect(stockFraction(5, 0)).toBe(0);
  });
});

describe('dosesRemaining (عدد الجرعات)', () => {
  const withRate = (balance: number, rate: number) => ({
    balance,
    dailyConsumption: rate,
    remainingDays: rate > 0 ? balance / rate : Number.POSITIVE_INFINITY,
    depletionDate: null,
    isLow: false,
  });

  it('divides balance by units-per-dose when a schedule is active', () => {
    expect(dosesRemaining(withRate(10, 1), 1)).toBe(10);
    expect(dosesRemaining(withRate(10, 1), 2)).toBe(5);
    expect(dosesRemaining(withRate(9, 1), 0.5)).toBe(18);
  });

  it('treats a zero/negative per-dose as one dose each', () => {
    expect(dosesRemaining(withRate(10, 1), 0)).toBe(10);
  });

  it('counts the whole balance as doses when nothing is being consumed', () => {
    expect(dosesRemaining(withRate(50, 0), 1)).toBe(50);
  });

  it('never returns fewer than zero doses', () => {
    expect(dosesRemaining(withRate(0, 1), 1)).toBe(0);
  });
});

describe('unitLabelAr', () => {
  it('labels tablets and capsules as قرص', () => {
    expect(unitLabelAr('tablet')).toBe('قرص');
    expect(unitLabelAr('capsule')).toBe('قرص');
  });

  it('labels any other form as وحدة', () => {
    expect(unitLabelAr('liquid')).toBe('وحدة');
    expect(unitLabelAr('injection')).toBe('وحدة');
    expect(unitLabelAr('puff')).toBe('وحدة');
  });
});
