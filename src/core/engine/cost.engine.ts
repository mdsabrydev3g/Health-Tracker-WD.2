/**
 * Cost Engine — monthly / yearly spend projection per medication and person.
 *
 * HARD RULE: PURE. No React / Dexie / Capacitor / Firebase.
 */

import type { ISODate, Medication, Person, Schedule } from '../db/schema';
import { addLocalDays, daysInMonth, parseLocalDay } from '../time';
import { dailyConsumption } from './inventory.engine';

export interface MedCost {
  medId: string;
  nameAr: string;
  currency: string;
  costPerUnit: number;
  unitsPerDay: number;
  costPerDay: number;
  costPerMonth: number;
  costPerYear: number;
}

export interface CostReport {
  currency: string;
  perMed: MedCost[];
  totalPerDay: number;
  totalPerMonth: number;
  totalPerYear: number;
  daysInMonth: number;
}

/** Cost of a single unit (tablet / ml / dose) from the package price. */
export function costPerUnit(med: Medication): number {
  const size = med.cost.packageSize;
  if (!size || size <= 0) return 0;
  return med.cost.packagePrice / size;
}

/**
 * Build a full cost report for a person.
 * Uses the actual sampled consumption rate so every schedule kind is
 * accounted for correctly.
 */
export function buildCostReport(input: {
  person: Person;
  medications: Medication[];
  schedules: Schedule[];
  today: ISODate;
  /** Override the month length used for the projection. */
  monthDays?: number;
}): CostReport {
  const { person, medications, schedules, today } = input;
  const monthDays = input.monthDays ?? daysInMonth(parseLocalDay(today).year, parseLocalDay(today).month);

  const perMed: MedCost[] = [];
  let currency = '';

  for (const med of medications) {
    if (med.deleted) continue;
    if (med.personId !== person.id) continue;
    if (med.status === 'discontinued' || med.status === 'finished') continue;

    const perUnit = costPerUnit(med);
    const perDay = dailyConsumption(med.id, schedules, today);
    currency ||= med.cost.currency;

    perMed.push({
      medId: med.id,
      nameAr: med.nameAr,
      currency: med.cost.currency,
      costPerUnit: round2(perUnit),
      unitsPerDay: perDay,
      costPerDay: round2(perUnit * perDay),
      costPerMonth: round2(perUnit * perDay * monthDays),
      costPerYear: round2(perUnit * perDay * 365),
    });
  }

  perMed.sort((a, b) => b.costPerMonth - a.costPerMonth);

  const totalPerDay = round2(perMed.reduce((s, m) => s + m.costPerDay, 0));

  return {
    currency: currency || 'EGP',
    perMed,
    totalPerDay,
    totalPerMonth: round2(perMed.reduce((s, m) => s + m.costPerMonth, 0)),
    totalPerYear: round2(perMed.reduce((s, m) => s + m.costPerYear, 0)),
    daysInMonth: monthDays,
  };
}

/** Cost of stock currently sitting on the shelf. */
export function inventoryValue(med: Medication, balance: number): number {
  return round2(costPerUnit(med) * balance);
}

/** Projected spend to refill `days` of cover for a medication. */
export function refillCost(med: Medication, schedules: Schedule[], today: ISODate, days: number): number {
  const rate = dailyConsumption(med.id, schedules, today);
  return round2(costPerUnit(med) * rate * days);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Format a currency amount with Arabic locale grouping. */
export function formatMoney(amount: number, currency = 'EGP'): string {
  try {
    return new Intl.NumberFormat('ar-EG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${round2(amount)} ${currency}`;
  }
}

/** Approximate monthly budget for the next N days of cover across all meds. */
export function projectedSpend(input: {
  medications: Medication[];
  schedules: Schedule[];
  today: ISODate;
  days: number;
}): number {
  const { medications, schedules, today, days } = input;
  let total = 0;
  for (const med of medications) {
    if (med.deleted || med.status === 'discontinued') continue;
    const rate = dailyConsumption(med.id, schedules, today);
    total += costPerUnit(med) * rate * days;
  }
  return round2(total);
}

/** Date when the current stock of one medication runs out, as a local day. */
export function depletionDay(balance: number, unitsPerDay: number, today: ISODate): ISODate | null {
  if (unitsPerDay <= 0) return null;
  return addLocalDays(today, Math.ceil(balance / unitsPerDay));
}
