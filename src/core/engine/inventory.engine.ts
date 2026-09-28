/**
 * Inventory Engine — balance derived from an append-only event log.
 *
 * HARD RULE: PURE. No React / Dexie / Capacitor / Firebase.
 *
 * Balance is NEVER stored as a bare number (§5). It is always a fold over
 * inventoryEvents; `medications.balanceCache` is only a read-through cache.
 */

import type { ISODate, ISODateTime, InventoryEvent, Medication, Schedule } from '../db/schema';
import { addLocalDays, diffLocalDays, parseLocalDay, utcToLocalDayString } from '../time';
import { quantityForDay, scheduleOccursOn } from './dose.engine';

export interface BalanceFold {
  balance: number;
  lastEventAt?: ISODateTime;
  eventCount: number;
}

/** Current balance = Σ inventoryEvents.qty. */
export function foldBalance(events: InventoryEvent[]): BalanceFold {
  let balance = 0;
  let lastEventAt: ISODateTime | undefined;
  let eventCount = 0;

  for (const e of events) {
    if (e.deleted) continue;
    balance += e.qty;
    eventCount++;
    if (!lastEventAt || e.atUtc > lastEventAt) lastEventAt = e.atUtc;
  }

  // Guard against a corrupt log producing a negative paper balance.
  return { balance: Math.max(0, roundQty(balance)), lastEventAt, eventCount };
}

/** Round to 3 decimals — doses can be halves or quarters. */
export function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/* ------------------------------------------------------------------ */
/* Consumption rate                                                    */
/* ------------------------------------------------------------------ */

/**
 * Average units consumed per local day, computed from ACTIVE schedules.
 * A PRN schedule contributes nothing (the user decides when to take it).
 */
export function dailyConsumption(
  medId: string,
  schedules: Schedule[],
  refDay: ISODate,
  horizonDays = 30,
): number {
  const live = schedules.filter(
    (s) => !s.deleted && s.medId === medId && s.kind !== 'prn' && isScheduleLiveOn(s, refDay),
  );
  if (live.length === 0) return 0;

  // Sample the actual next `horizonDays` calendar days. This is exact for
  // every schedule kind (including every-N-days and weekdays) instead of
  // relying on a hand-rolled occurrencesPerDay formula.
  let total = 0;
  for (let i = 0; i < horizonDays; i++) {
    const day = addLocalDays(refDay, i);
    for (const s of live) {
      if (!scheduleOccursOn(s, day, s.anchorDate)) continue;
      const perTime = quantityForDay(s, day);
      total += perTime * s.times.length;
    }
  }
  return roundQty(total / horizonDays);
}

export function isScheduleLiveOn(s: Schedule, day: ISODate): boolean {
  if (s.deleted) return false;
  if (diffLocalDays(s.activeFrom, day) < 0) return false;
  if (s.activeTo && diffLocalDays(day, s.activeTo) < 0) return false;
  if (s.endDate && diffLocalDays(s.endDate, day) < 0) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Depletion & expiry                                                  */
/* ------------------------------------------------------------------ */

export interface StockProjection {
  balance: number;
  dailyConsumption: number;
  /** Infinity when consumption is zero. */
  remainingDays: number;
  /** null when consumption is zero (nothing to deplete toward). */
  depletionDate: ISODate | null;
  isLow: boolean;
  packExpiry?: ISODate;
  /**
   * Distinct failure mode (§7): the package expires BEFORE the medicine
   * runs out. Message: "العلبة ستنتهي صلاحيتها قبل أن ينتهي الدواء"
   */
  expiresBeforeDepletion: boolean;
  daysUntilExpiry: number | null;
}

export function projectStock(input: {
  medication: Medication;
  schedules: Schedule[];
  events: InventoryEvent[];
  today: ISODate;
  lowStockThresholdDays: number;
}): StockProjection {
  const { medication, schedules, events, today, lowStockThresholdDays } = input;

  const { balance } = foldBalance(events);
  const rate = dailyConsumption(medication.id, schedules, today);

  const remainingDays = rate > 0 ? roundQty(balance / rate) : Number.POSITIVE_INFINITY;
  const depletionDate =
    rate > 0 ? addLocalDays(today, Math.max(0, Math.ceil(remainingDays))) : null;

  const packExpiry = medication.packExpiry;
  const expiresBeforeDepletion =
    !!packExpiry && !!depletionDate && diffLocalDays(packExpiry, depletionDate) > 0;

  const daysUntilExpiry = packExpiry ? diffLocalDays(today, packExpiry) : null;

  return {
    balance,
    dailyConsumption: rate,
    remainingDays,
    depletionDate,
    isLow: rate > 0 && remainingDays <= lowStockThresholdDays,
    packExpiry,
    expiresBeforeDepletion,
    daysUntilExpiry,
  };
}

/** Is the pack already expired as of `today`? */
export function isExpired(packExpiry: ISODate | undefined, today: ISODate): boolean {
  if (!packExpiry) return false;
  return diffLocalDays(packExpiry, today) > 0;
}

/* ------------------------------------------------------------------ */
/* Event construction                                                  */
/* ------------------------------------------------------------------ */

/**
 * Build an inventory event with correct prev/new balances.
 * The caller persists this and the dose event in ONE local transaction (§7).
 */
export function buildInventoryEvent(input: {
  personId: string;
  medId: string;
  type: InventoryEvent['type'];
  qty: number;
  prevBalance: number;
  reason?: string;
  atUtc: ISODateTime;
  deviceId: string;
  doseId?: string;
  id: string;
}): InventoryEvent {
  const prevBalance = roundQty(input.prevBalance);
  const newBalance = roundQty(prevBalance + input.qty);
  return {
    id: input.id,
    personId: input.personId,
    medId: input.medId,
    type: input.type,
    qty: input.qty,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    prevBalance,
    newBalance,
    atUtc: input.atUtc,
    deviceId: input.deviceId,
    ...(input.doseId !== undefined ? { doseId: input.doseId } : {}),
    updatedAt: input.atUtc,
    updatedBy: input.deviceId,
    rev: 1,
    deleted: false,
  };
}

/**
 * Idempotency guard (§7): if a doseTaken event already exists for this
 * doseId, the operation is a no-op. Prevents a double tap or an offline
 * retry from deducting twice.
 */
export function alreadyConsumed(events: InventoryEvent[], doseId: string): boolean {
  return events.some((e) => !e.deleted && e.doseId === doseId && e.type === 'doseTaken');
}

/** Units required to reach a target number of days of cover. */
export function unitsForDays(days: number, ratePerDay: number): number {
  return roundQty(days * ratePerDay);
}

/** Fraction of stock remaining, for progress rings (0..1). */
export function stockFraction(balance: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.max(0, Math.min(1, balance / capacity));
}

/** Group events by local day for the timeline view. */
export function groupEventsByDay(events: InventoryEvent[]): Map<ISODate, InventoryEvent[]> {
  const map = new Map<ISODate, InventoryEvent[]>();
  for (const e of events) {
    if (e.deleted) continue;
    const day = utcToLocalDayString(new Date(e.atUtc));
    const list = map.get(day) ?? [];
    list.push(e);
    map.set(day, list);
  }
  for (const list of map.values()) list.sort((a, b) => b.atUtc.localeCompare(a.atUtc));
  return map;
}

/** Local day helpers re-exported for callers that only import this engine. */
export { parseLocalDay };
