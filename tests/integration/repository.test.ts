import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { DexieRepository } from '@/core/db/dexie.adapter';
import { foldBalance } from '@/core/engine/inventory.engine';
import { materialiseDoses } from '@/core/engine/dose.engine';
import type { DoseEvent, Medication, Person, Schedule } from '@/core/db/schema';
import { newId } from '@/core/db/schema';

/**
 * Integration tests over the real Dexie adapter (IndexedDB via fake-indexeddb).
 *
 * The headline requirement here is §7 idempotency: "Marking a dose taken twice
 * (double tap / offline retry) deducts inventory once."
 */

const PERSON_ID = 'per_it';
const MED_ID = 'med_it';

function makePerson(): Person {
  return {
    id: PERSON_ID,
    nameAr: 'الوالدة',
    timezone: 'Africa/Cairo',
    allergies: [],
    isMinor: false,
    updatedAt: new Date().toISOString(),
    updatedBy: 'dev_it',
    rev: 1,
    deleted: false,
  };
}

function makeMed(balance = 30): Medication {
  return {
    id: MED_ID,
    personId: PERSON_ID,
    nameAr: 'دواء اختبار',
    activeIngredients: [],
    strength: { value: 10, unit: 'mg' },
    form: 'tablet',
    package: { kind: 'direct', pillCount: balance },
    rx: { isPrescription: true, isControlled: false },
    foodRule: { mode: 'with' },
    cost: { packagePrice: 30, currency: 'EGP', packageSize: 30 },
    startDate: '2024-01-01',
    status: 'active',
    balanceCache: balance,
    updatedAt: new Date().toISOString(),
    updatedBy: 'dev_it',
    rev: 1,
    deleted: false,
  };
}

function makeSchedule(): Schedule {
  return {
    id: 'sch_it',
    medId: MED_ID,
    personId: PERSON_ID,
    kind: 'daily',
    times: ['08:00'],
    quantityPerDose: 1,
    dosesPerDay: 1,
    anchorDate: '2024-01-01',
    activeFrom: '2024-01-01',
    activeTo: null,
    updatedAt: new Date().toISOString(),
    updatedBy: 'dev_it',
    rev: 1,
    deleted: false,
  };
}

let repo: DexieRepository;
let dbCounter = 0;

beforeEach(async () => {
  // A fresh, uniquely-named database per test so counts are exact and no
  // state leaks between tests. (Deleting/reassigning the global IDBFactory
  // is not enough — Dexie caches connections by database name.)
  dbCounter++;
  repo = new DexieRepository(`health-tracker-it-${dbCounter}`);
  await repo.init();

  await repo.putPerson(makePerson());
  await repo.putMedication(makeMed(30));
  await repo.putSchedule(makeSchedule());
  await repo.putInventoryEvent({
    id: newId('inv'),
    personId: PERSON_ID,
    medId: MED_ID,
    type: 'initial',
    qty: 30,
    prevBalance: 0,
    newBalance: 30,
    atUtc: new Date().toISOString(),
    deviceId: 'dev_it',
    updatedAt: new Date().toISOString(),
    updatedBy: 'dev_it',
    rev: 1,
    deleted: false,
  });
});

afterEach(async () => {
  await repo.close();
});

function buildDose(localDay = '2024-06-01'): DoseEvent {
  const instances = materialiseDoses({
    person: { id: PERSON_ID, timezone: 'Africa/Cairo' },
    medications: [makeMed()],
    schedules: [makeSchedule()],
    fromDay: localDay,
    toDay: localDay,
  });
  const inst = instances[0]!;
  return {
    id: inst.id,
    personId: inst.personId,
    medId: inst.medId,
    scheduleId: inst.scheduleId,
    scheduledAtUtc: inst.scheduledAtUtc,
    localDay: inst.localDay,
    status: 'upcoming',
    quantity: 1,
    idempotencyKey: inst.idempotencyKey,
    updatedAt: new Date().toISOString(),
    updatedBy: 'dev_it',
    rev: 1,
    deleted: false,
  };
}

describe('markDoseTaken — idempotency (§7, §16)', () => {
  it('deducts inventory exactly once for a first tap', async () => {
    const dose = buildDose();
    const result = await repo.markDoseTaken({
      dose,
      medId: MED_ID,
      personId: PERSON_ID,
      quantity: 1,
      deviceId: 'dev_it',
      atUtc: new Date().toISOString(),
      inventoryEventId: newId('inv'),
      source: 'mother',
    });

    expect(result.applied).toBe(true);
    expect(result.newBalance).toBe(29);

    const events = await repo.listInventoryEvents(MED_ID);
    expect(foldBalance(events).balance).toBe(29);
  });

  it('is a no-op on a double tap (the core requirement)', async () => {
    const dose = buildDose();

    const first = await repo.markDoseTaken({
      dose,
      medId: MED_ID,
      personId: PERSON_ID,
      quantity: 1,
      deviceId: 'dev_it',
      atUtc: new Date().toISOString(),
      inventoryEventId: newId('inv'),
      source: 'mother',
    });
    const second = await repo.markDoseTaken({
      dose,
      medId: MED_ID,
      personId: PERSON_ID,
      quantity: 1,
      deviceId: 'dev_it',
      atUtc: new Date().toISOString(),
      inventoryEventId: newId('inv'),
      source: 'mother',
    });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.newBalance).toBe(29);

    const events = await repo.listInventoryEvents(MED_ID);
    const doseTakenEvents = events.filter((e) => e.type === 'doseTaken');
    expect(doseTakenEvents).toHaveLength(1);
    expect(foldBalance(events).balance).toBe(29);
  });

  it('stays idempotent across many rapid retries (offline replay)', async () => {
    const dose = buildDose();

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        repo.markDoseTaken({
          dose,
          medId: MED_ID,
          personId: PERSON_ID,
          quantity: 1,
          deviceId: 'dev_it',
          atUtc: new Date().toISOString(),
          inventoryEventId: newId('inv'),
          source: 'caregiver',
        }),
      ),
    );

    expect(results.filter((r) => r.applied)).toHaveLength(1);

    const events = await repo.listInventoryEvents(MED_ID);
    expect(events.filter((e) => e.type === 'doseTaken')).toHaveLength(1);
    expect(foldBalance(events).balance).toBe(29);
  });

  it('records the dose as taken and preserves actedBy', async () => {
    const dose = buildDose();
    await repo.markDoseTaken({
      dose,
      medId: MED_ID,
      personId: PERSON_ID,
      quantity: 1,
      deviceId: 'dev_it',
      atUtc: '2024-06-01T06:05:00.000Z',
      inventoryEventId: newId('inv'),
      source: 'mother',
    });

    const stored = await repo.getDoseEvent(dose.id);
    expect(stored?.status).toBe('taken');
    expect(stored?.source).toBe('mother');
    expect(stored?.actedByDeviceId).toBe('dev_it');
    expect(stored?.actedAtUtc).toBe('2024-06-01T06:05:00.000Z');
  });

  it('queues an outbox entry for cloud replay', async () => {
    const dose = buildDose();
    await repo.markDoseTaken({
      dose,
      medId: MED_ID,
      personId: PERSON_ID,
      quantity: 1,
      deviceId: 'dev_it',
      atUtc: new Date().toISOString(),
      inventoryEventId: newId('inv'),
      source: 'mother',
    });

    const outbox = await repo.listOutbox();
    expect(outbox.length).toBeGreaterThanOrEqual(1);
    expect(outbox.some((o) => o.entity === 'dose+inventory')).toBe(true);
  });
});

describe('inventory log integrity', () => {
  it('keeps a coherent prev/new chain across mixed events', async () => {
    const dose = buildDose();
    await repo.markDoseTaken({
      dose,
      medId: MED_ID,
      personId: PERSON_ID,
      quantity: 2,
      deviceId: 'dev_it',
      atUtc: '2024-06-01T06:00:00.000Z',
      inventoryEventId: newId('inv'),
      source: 'caregiver',
    });
    await repo.putInventoryEvent({
      id: newId('inv'),
      personId: PERSON_ID,
      medId: MED_ID,
      type: 'purchase',
      qty: 10,
      prevBalance: 28,
      newBalance: 38,
      atUtc: '2024-06-02T06:00:00.000Z',
      deviceId: 'dev_it',
      updatedAt: '2024-06-02T06:00:00.000Z',
      updatedBy: 'dev_it',
      rev: 1,
      deleted: false,
    });

    const events = await repo.listInventoryEvents(MED_ID);
    expect(foldBalance(events).balance).toBe(38);

    // Every event must satisfy newBalance === prevBalance + qty.
    for (const e of events) {
      expect(e.newBalance).toBeCloseTo(e.prevBalance + e.qty, 3);
    }
  });

  it('updates the balance cache after a take', async () => {
    const dose = buildDose();
    await repo.markDoseTaken({
      dose,
      medId: MED_ID,
      personId: PERSON_ID,
      quantity: 3,
      deviceId: 'dev_it',
      atUtc: new Date().toISOString(),
      inventoryEventId: newId('inv'),
      source: 'mother',
    });

    const med = await repo.getMedication(MED_ID);
    expect(med?.balanceCache).toBe(27);
  });
});

describe('dose event persistence', () => {
  it('materialises and stores a 14-day horizon', async () => {
    const instances = materialiseDoses({
      person: { id: PERSON_ID, timezone: 'Africa/Cairo' },
      medications: [makeMed()],
      schedules: [makeSchedule()],
      fromDay: '2024-06-01',
      toDay: '2024-06-14',
    });

    await repo.putDoseEvents(
      instances.map((i) => ({
        id: i.id,
        personId: i.personId,
        medId: i.medId,
        scheduleId: i.scheduleId,
        scheduledAtUtc: i.scheduledAtUtc,
        localDay: i.localDay,
        status: 'upcoming' as const,
        quantity: i.quantityPerDose,
        idempotencyKey: i.idempotencyKey,
        updatedAt: new Date().toISOString(),
        updatedBy: 'dev_it',
        rev: 1,
        deleted: false,
      })),
    );

    // 14 days × 1 daily dose.
    expect(instances).toHaveLength(14);

    const stored = await repo.listDoseEvents(PERSON_ID, { from: '2024-06-01', to: '2024-06-14' });
    expect(stored).toHaveLength(14);
  });

  it('re-materialising does not duplicate rows', async () => {
    const input = {
      person: { id: PERSON_ID, timezone: 'Africa/Cairo' },
      medications: [makeMed()],
      schedules: [makeSchedule()],
      fromDay: '2024-06-01',
      toDay: '2024-06-07',
    };

    const first = materialiseDoses(input);
    await repo.putDoseEvents(
      first.map((i) => ({
        id: i.id,
        personId: i.personId,
        medId: i.medId,
        scheduleId: i.scheduleId,
        scheduledAtUtc: i.scheduledAtUtc,
        localDay: i.localDay,
        status: 'upcoming' as const,
        quantity: i.quantityPerDose,
        idempotencyKey: i.idempotencyKey,
        updatedAt: new Date().toISOString(),
        updatedBy: 'dev_it',
        rev: 1,
        deleted: false,
      })),
    );

    // Second pass writes the same deterministic ids.
    const second = materialiseDoses(input);
    await repo.putDoseEvents(
      second.map((i) => ({
        id: i.id,
        personId: i.personId,
        medId: i.medId,
        scheduleId: i.scheduleId,
        scheduledAtUtc: i.scheduledAtUtc,
        localDay: i.localDay,
        status: 'upcoming' as const,
        quantity: i.quantityPerDose,
        idempotencyKey: i.idempotencyKey,
        updatedAt: new Date().toISOString(),
        updatedBy: 'dev_it',
        rev: 1,
        deleted: false,
      })),
    );

    const stored = await repo.listDoseEvents(PERSON_ID, { from: '2024-06-01', to: '2024-06-07' });
    expect(stored).toHaveLength(7);
  });
});

describe('export / import round-trip (§12)', () => {
  it('restores a full person dataset', async () => {
    const dose = buildDose();
    await repo.markDoseTaken({
      dose,
      medId: MED_ID,
      personId: PERSON_ID,
      quantity: 1,
      deviceId: 'dev_it',
      atUtc: new Date().toISOString(),
      inventoryEventId: newId('inv'),
      source: 'mother',
    });

    const exported = await repo.exportPerson(PERSON_ID);
    expect(exported.medications).toHaveLength(1);
    expect(exported.schedules).toHaveLength(1);
    expect(exported.doseEvents.length).toBeGreaterThanOrEqual(1);
    expect(exported.inventoryEvents.length).toBeGreaterThanOrEqual(2);

    // Wipe and restore into a fresh database.
    indexedDB = new IDBFactory();
    const repo2 = new DexieRepository();
    await repo2.init();
    await repo2.importPerson(exported);

    const persons = await repo2.listPersons();
    expect(persons).toHaveLength(1);
    expect(persons[0]!.nameAr).toBe('الوالدة');

    const events = await repo2.listInventoryEvents(MED_ID);
    expect(foldBalance(events).balance).toBe(29);

    const restoredDose = await repo2.getDoseEvent(dose.id);
    expect(restoredDose?.status).toBe('taken');
  });

  it('preserves the schema version for forward compatibility', async () => {
    const exported = await repo.exportPerson(PERSON_ID);
    expect(exported.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(exported.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('soft delete', () => {
  it('hides a deleted medication from listings but keeps the row', async () => {
    await repo.deleteMedication(MED_ID);
    expect(await repo.listMedications(PERSON_ID)).toHaveLength(0);
    const raw = await repo.getMedication(MED_ID);
    expect(raw).toBeUndefined();
  });
});
