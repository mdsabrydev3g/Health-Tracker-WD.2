/**
 * Dexie (IndexedDB) adapter — the web implementation of `Repository`.
 *
 * This is the only file (besides the SQLite adapter) allowed to know about
 * a concrete storage engine. Everything above talks to `Repository`.
 */

import Dexie, { type Table } from 'dexie';
import type {
  AppSettings,
  AuditLog,
  Device,
  DocumentRef,
  DoseEvent,
  FoodLog,
  InventoryEvent,
  LabResult,
  Medication,
  NotifPrefs,
  OutboxItem,
  Person,
  RecurringTest,
  Schedule,
  Symptom,
} from './schema';
import { newId } from './schema';
import {
  CURRENT_SCHEMA_VERSION,
  type MarkDoseTakenInput,
  type PersonExport,
  type QueryRange,
  type Repository,
} from './repository';
import { buildInventoryEvent, foldBalance } from '../engine/inventory.engine';

const DEFAULT_SETTINGS: AppSettings = {
  numeralStyle: 'western',
  theme: 'system',
  language: 'ar',
  largeText: false,
  speakAloud: false,
  appLockEnabled: false,
  autoLockMinutes: 5,
  missedGraceMinutes: 120,
  lowStockThresholdDays: 2,
  activeMode: 'caregiver',
};

class HealthTrackerDb extends Dexie {
  persons!: Table<Person, string>;
  devices!: Table<Device, string>;
  notifPrefs!: Table<NotifPrefs, string>;
  medications!: Table<Medication, string>;
  schedules!: Table<Schedule, string>;
  doseEvents!: Table<DoseEvent, string>;
  inventoryEvents!: Table<InventoryEvent, string>;
  labResults!: Table<LabResult, string>;
  documents!: Table<DocumentRef, string>;
  symptoms!: Table<Symptom, string>;
  foodLogs!: Table<FoodLog, string>;
  recurringTests!: Table<RecurringTest, string>;
  auditLogs!: Table<AuditLog, string>;
  outbox!: Table<OutboxItem, string>;
  settings!: Table<AppSettings & { key: string }, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor(name = 'health-tracker') {
    super(name);

    this.version(1).stores({
      persons: 'id, nameAr, deleted',
      devices: 'id, platform, boundPersonId, deleted',
      notifPrefs: 'id, deviceId, personId, deleted',
      medications: 'id, personId, status, nameAr, deleted',
      schedules: 'id, medId, personId, kind, activeTo, deleted',
      doseEvents: 'id, personId, medId, scheduleId, localDay, scheduledAtUtc, status, idempotencyKey, deleted',
      inventoryEvents: 'id, medId, personId, type, atUtc, doseId, deleted',
      labResults: 'id, personId, date, status, deleted',
      documents: 'id, personId, kind, deleted',
      symptoms: 'id, personId, atUtc, deleted',
      foodLogs: 'id, personId, atUtc, deleted',
      recurringTests: 'id, personId, nextDue, deleted',
      auditLogs: 'id, atUtc, entity, entityId',
      outbox: 'id, entity, entityId, createdAtUtc',
      settings: 'key',
      meta: 'key',
    });

    // v2: compound index for the hot "doses for a person on a day" query.
    this.version(2).stores({
      doseEvents: 'id, personId, medId, scheduleId, localDay, [personId+localDay], [medId+scheduledAtUtc], scheduledAtUtc, status, idempotencyKey, deleted',
    });

    // v3: index active schedules per med for consumption math.
    this.version(CURRENT_SCHEMA_VERSION).stores({
      schedules: 'id, medId, personId, kind, activeTo, [medId+activeTo], deleted',
    });
  }
}

export class DexieRepository implements Repository {
  private db: HealthTrackerDb;
  private currentDeviceId: string | null = null;

  /**
   * `dbName` is injectable so tests (and any second-profile use case) can open
   * an isolated IndexedDB database. Production always uses the default.
   */
  constructor(dbName?: string) {
    this.db = new HealthTrackerDb(dbName);
  }

  async init(): Promise<void> {
    await this.db.open();
    const existing = await this.db.meta.get('schemaVersion');
    if (!existing) {
      await this.db.meta.put({ key: 'schemaVersion', value: String(CURRENT_SCHEMA_VERSION) });
    }
    // Ensure a device row exists for this browser/installation.
    await this.getCurrentDevice();
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /* ---------------- People & devices ---------------- */

  listPersons = async (): Promise<Person[]> =>
    (await this.db.persons.toArray()).filter((p) => !p.deleted);

  getPerson = async (id: string): Promise<Person | undefined> => {
    const p = await this.db.persons.get(id);
    return p && !p.deleted ? p : undefined;
  };

  putPerson = async (person: Person): Promise<void> => {
    await this.db.persons.put(person);
  };

  deletePerson = async (id: string): Promise<void> => {
    const p = await this.db.persons.get(id);
    if (p) await this.db.persons.put({ ...p, deleted: true, rev: p.rev + 1, updatedAt: new Date().toISOString() });
  };

  listDevices = async (): Promise<Device[]> => (await this.db.devices.toArray()).filter((d) => !d.deleted);

  getDevice = async (id: string): Promise<Device | undefined> => {
    const d = await this.db.devices.get(id);
    return d && !d.deleted ? d : undefined;
  };

  getCurrentDevice = async (): Promise<Device> => {
    const stored = await this.db.meta.get('deviceId');
    if (stored) {
      this.currentDeviceId = stored.value;
      const existing = await this.db.devices.get(stored.value);
      if (existing) return existing;
    }
    const id = this.currentDeviceId ?? newId('dev');
    this.currentDeviceId = id;
    await this.db.meta.put({ key: 'deviceId', value: id });

    const now = new Date().toISOString();
    const device: Device = {
      id,
      label: detectPlatformLabel(),
      platform: detectPlatform(),
      boundPersonId: null,
      lastSeenAt: now,
      updatedAt: now,
      updatedBy: id,
      rev: 1,
      deleted: false,
      alarmHealth: {
        exactAlarmGranted: false,
        batteryExempt: false,
        notifGranted: false,
      },
    };
    await this.db.devices.put(device);
    return device;
  };

  putDevice = async (device: Device): Promise<void> => {
    await this.db.devices.put(device);
  };

  listNotifPrefs = async (): Promise<NotifPrefs[]> =>
    (await this.db.notifPrefs.toArray()).filter((p) => !p.deleted);

  putNotifPrefs = async (prefs: NotifPrefs): Promise<void> => {
    await this.db.notifPrefs.put(prefs);
  };

  /* ---------------- Medications & schedules ---------------- */

  listMedications = async (personId: string): Promise<Medication[]> =>
    (await this.db.medications.where('personId').equals(personId).toArray()).filter((m) => !m.deleted);

  getMedication = async (id: string): Promise<Medication | undefined> => {
    const m = await this.db.medications.get(id);
    return m && !m.deleted ? m : undefined;
  };

  putMedication = async (med: Medication): Promise<void> => {
    await this.db.medications.put(med);
  };

  deleteMedication = async (id: string): Promise<void> => {
    const m = await this.db.medications.get(id);
    if (m) await this.db.medications.put({ ...m, deleted: true, rev: m.rev + 1, updatedAt: new Date().toISOString() });
  };

  listSchedules = async (personId: string): Promise<Schedule[]> =>
    (await this.db.schedules.where('personId').equals(personId).toArray()).filter((s) => !s.deleted);

  listSchedulesForMed = async (medId: string): Promise<Schedule[]> =>
    (await this.db.schedules.where('medId').equals(medId).toArray())
      .filter((s) => !s.deleted)
      .sort((a, b) => a.activeFrom.localeCompare(b.activeFrom));

  putSchedule = async (schedule: Schedule): Promise<void> => {
    await this.db.schedules.put(schedule);
  };

  deleteSchedule = async (id: string): Promise<void> => {
    const s = await this.db.schedules.get(id);
    if (s) await this.db.schedules.put({ ...s, deleted: true, rev: s.rev + 1, updatedAt: new Date().toISOString() });
  };

  /* ---------------- Dose events ---------------- */

  listDoseEvents = async (personId: string, range?: QueryRange): Promise<DoseEvent[]> => {
    const all = await this.db.doseEvents.where('personId').equals(personId).toArray();
    return all.filter((e) => {
      if (e.deleted) return false;
      if (range?.from && e.localDay < range.from) return false;
      if (range?.to && e.localDay > range.to) return false;
      return true;
    });
  };

  getDoseEvent = async (id: string): Promise<DoseEvent | undefined> => this.db.doseEvents.get(id);

  putDoseEvent = async (event: DoseEvent): Promise<void> => {
    await this.db.doseEvents.put(event);
  };

  putDoseEvents = async (events: DoseEvent[]): Promise<void> => {
    await this.db.transaction('rw', this.db.doseEvents, async () => {
      await this.db.doseEvents.bulkPut(events);
    });
  };

  /* ---------------- Inventory ---------------- */

  listInventoryEvents = async (medId: string, range?: QueryRange): Promise<InventoryEvent[]> => {
    const all = await this.db.inventoryEvents.where('medId').equals(medId).toArray();
    return all
      .filter((e) => {
        if (e.deleted) return false;
        if (range?.from && e.atUtc < range.from) return false;
        if (range?.to && e.atUtc > range.to) return false;
        return true;
      })
      .sort((a, b) => a.atUtc.localeCompare(b.atUtc));
  };

  putInventoryEvent = async (event: InventoryEvent): Promise<void> => {
    await this.db.inventoryEvents.put(event);
  };

  /* ---------------- Clinical & logs ---------------- */

  listLabResults = async (personId: string): Promise<LabResult[]> =>
    (await this.db.labResults.where('personId').equals(personId).toArray())
      .filter((r) => !r.deleted)
      .sort((a, b) => b.date.localeCompare(a.date));

  putLabResult = async (result: LabResult): Promise<void> => {
    await this.db.labResults.put(result);
  };

  getLabResult = async (id: string): Promise<LabResult | undefined> => {
    const r = await this.db.labResults.get(id);
    return r && !r.deleted ? r : undefined;
  };

  deleteLabResult = async (id: string): Promise<void> => {
    const r = await this.db.labResults.get(id);
    if (r) {
      await this.db.labResults.put({ ...r, deleted: true, rev: r.rev + 1, updatedAt: new Date().toISOString() });
    }
  };

  listDocuments = async (personId: string): Promise<DocumentRef[]> =>
    (await this.db.documents.where('personId').equals(personId).toArray()).filter((d) => !d.deleted);

  putDocument = async (doc: DocumentRef): Promise<void> => {
    await this.db.documents.put(doc);
  };

  listSymptoms = async (personId: string): Promise<Symptom[]> =>
    (await this.db.symptoms.where('personId').equals(personId).toArray())
      .filter((s) => !s.deleted)
      .sort((a, b) => b.atUtc.localeCompare(a.atUtc));

  putSymptom = async (symptom: Symptom): Promise<void> => {
    await this.db.symptoms.put(symptom);
  };

  listFoodLogs = async (personId: string): Promise<FoodLog[]> =>
    (await this.db.foodLogs.where('personId').equals(personId).toArray())
      .filter((l) => !l.deleted)
      .sort((a, b) => b.atUtc.localeCompare(a.atUtc));

  putFoodLog = async (log: FoodLog): Promise<void> => {
    await this.db.foodLogs.put(log);
  };

  listRecurringTests = async (personId: string): Promise<RecurringTest[]> =>
    (await this.db.recurringTests.where('personId').equals(personId).toArray())
      .filter((t) => !t.deleted)
      .sort((a, b) => a.nextDue.localeCompare(b.nextDue));

  putRecurringTest = async (test: RecurringTest): Promise<void> => {
    await this.db.recurringTests.put(test);
  };

  /* ---------------- System ---------------- */

  listAuditLogs = async (limit = 200): Promise<AuditLog[]> =>
    (await this.db.auditLogs.orderBy('atUtc').reverse().limit(limit).toArray());

  appendAuditLog = async (log: AuditLog): Promise<void> => {
    await this.db.auditLogs.put(log);
  };

  getSettings = async (): Promise<AppSettings> => {
    const row = await this.db.settings.get('app');
    if (!row) return { ...DEFAULT_SETTINGS };
    const { key: _key, ...rest } = row;
    return { ...DEFAULT_SETTINGS, ...rest };
  };

  putSettings = async (settings: AppSettings): Promise<void> => {
    await this.db.settings.put({ key: 'app', ...settings });
  };

  /* ---------------- Outbox ---------------- */

  enqueueOutbox = async (item: OutboxItem): Promise<void> => {
    await this.db.outbox.put(item);
  };

  listOutbox = async (): Promise<OutboxItem[]> => {
    const items = await this.db.outbox.toArray();
    return items.sort((a, b) => a.createdAtUtc.localeCompare(b.createdAtUtc));
  };

  removeOutbox = async (id: string): Promise<void> => {
    await this.db.outbox.delete(id);
  };

  bumpOutboxAttempt = async (id: string, error: string): Promise<void> => {
    const item = await this.db.outbox.get(id);
    if (!item) return;
    await this.db.outbox.put({ ...item, attempts: item.attempts + 1, lastError: error });
  };

  /* ---------------- Atomic operations ---------------- */

  /**
   * §7 idempotency: the dose event and the inventory deduction are written
   * in one transaction. A re-send finds the existing doseTaken event for
   * this doseId and becomes a no-op.
   */
  markDoseTaken = async (input: MarkDoseTakenInput): Promise<{ applied: boolean; newBalance: number }> => {
    return this.db.transaction(
      'rw',
      this.db.doseEvents,
      this.db.inventoryEvents,
      this.db.medications,
      this.db.auditLogs,
      this.db.outbox,
      async () => {
        const existing = await this.db.inventoryEvents.where('medId').equals(input.medId).toArray();
        const already = existing.some(
          (e) => !e.deleted && e.doseId === input.dose.id && e.type === 'doseTaken',
        );
        if (already) {
          const { balance } = foldBalance(existing);
          return { applied: false, newBalance: balance };
        }

        const now = input.atUtc;

        await this.db.doseEvents.put({
          ...input.dose,
          status: 'taken',
          actedAtUtc: now,
          actedByDeviceId: input.deviceId,
          quantity: input.quantity,
          source: input.source,
          updatedAt: now,
          updatedBy: input.deviceId,
          rev: input.dose.rev + 1,
          deleted: false,
        });

        const { balance } = foldBalance(existing);
        const inv = buildInventoryEvent({
          id: input.inventoryEventId,
          personId: input.personId,
          medId: input.medId,
          type: 'doseTaken',
          qty: -input.quantity,
          prevBalance: balance,
          atUtc: now,
          deviceId: input.deviceId,
          doseId: input.dose.id,
        });
        await this.db.inventoryEvents.put(inv);

        const med = await this.db.medications.get(input.medId);
        if (med) await this.db.medications.put({ ...med, balanceCache: inv.newBalance });

        await this.db.outbox.put({
          id: newId('out'),
          entity: 'dose+inventory',
          entityId: input.dose.id,
          op: 'upsert',
          payload: { doseId: input.dose.id, inventoryEventId: inv.id },
          createdAtUtc: now,
          attempts: 0,
        });

        return { applied: true, newBalance: inv.newBalance };
      },
    );
  };

  exportPerson = async (personId: string): Promise<PersonExport> => {
    const person = await this.db.persons.get(personId);
    if (!person) throw new Error(`Person ${personId} not found`);

    const meds = await this.db.medications.where('personId').equals(personId).toArray();
    const medIds = new Set(meds.map((m) => m.id));

    const schedules = (await this.db.schedules.where('personId').equals(personId).toArray());
    const doseEvents = await this.db.doseEvents.where('personId').equals(personId).toArray();
    const inventoryEvents = (await this.db.inventoryEvents.where('personId').equals(personId).toArray())
      .filter((e) => medIds.has(e.medId));

    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      person,
      medications: meds,
      schedules,
      doseEvents,
      inventoryEvents,
      labResults: await this.db.labResults.where('personId').equals(personId).toArray(),
      documents: await this.db.documents.where('personId').equals(personId).toArray(),
      symptoms: await this.db.symptoms.where('personId').equals(personId).toArray(),
      foodLogs: await this.db.foodLogs.where('personId').equals(personId).toArray(),
      recurringTests: await this.db.recurringTests.where('personId').equals(personId).toArray(),
      notifPrefs: await this.db.notifPrefs.where('personId').equals(personId).toArray(),
    };
  };

  importPerson = async (dataset: PersonExport): Promise<void> => {
    await this.db.transaction(
      'rw',
      [
        this.db.persons,
        this.db.medications,
        this.db.schedules,
        this.db.doseEvents,
        this.db.inventoryEvents,
        this.db.labResults,
        this.db.documents,
        this.db.symptoms,
        this.db.foodLogs,
        this.db.recurringTests,
        this.db.notifPrefs,
      ],
      async () => {
        await this.db.persons.put(dataset.person);
        await this.db.medications.bulkPut(dataset.medications);
        await this.db.schedules.bulkPut(dataset.schedules);
        await this.db.doseEvents.bulkPut(dataset.doseEvents);
        await this.db.inventoryEvents.bulkPut(dataset.inventoryEvents);
        await this.db.labResults.bulkPut(dataset.labResults);
        await this.db.documents.bulkPut(dataset.documents);
        await this.db.symptoms.bulkPut(dataset.symptoms);
        await this.db.foodLogs.bulkPut(dataset.foodLogs);
        await this.db.recurringTests.bulkPut(dataset.recurringTests);
        await this.db.notifPrefs.bulkPut(dataset.notifPrefs);
      },
    );
  };
}

/* ------------------------------------------------------------------ */
/* Platform detection                                                  */
/* ------------------------------------------------------------------ */

export function detectPlatform(): Device['platform'] {
  if (typeof window === 'undefined') return 'web';
  const w = window as unknown as Record<string, unknown>;
  if (w['__TAURI__'] || w['__TAURI_INTERNALS__']) return 'desktop';
  const cap = (w['Capacitor'] as { getPlatform?: () => string } | undefined)?.getPlatform?.();
  if (cap === 'android') return 'android';
  return 'web';
}

export function detectPlatformLabel(): string {
  const p = detectPlatform();
  if (p === 'android') return 'هاتف أندرويد';
  if (p === 'desktop') return 'كمبيوتر ويندوز';
  return 'متصفح الويب';
}
