/**
 * Repository contract — the ONE interface every feature depends on.
 *
 * HARD RULE (§3): no SQL and no Dexie/Capacitor types leak past this file.
 * UI and features talk only to this interface. The Dexie adapter (web) and
 * the SQLite adapter (Android/Desktop) both implement it.
 */

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

export interface QueryRange {
  /** Inclusive lower bound. */
  from?: string;
  /** Inclusive upper bound. */
  to?: string;
}

export interface Repository {
  /** Initialise storage, run migrations. Safe to call repeatedly. */
  init(): Promise<void>;
  /** Close connections (used on app teardown / tests). */
  close(): Promise<void>;

  /* ---------------- People & devices ---------------- */

  listPersons(): Promise<Person[]>;
  getPerson(id: string): Promise<Person | undefined>;
  putPerson(person: Person): Promise<void>;
  deletePerson(id: string): Promise<void>;

  listDevices(): Promise<Device[]>;
  getDevice(id: string): Promise<Device | undefined>;
  /** The device running this build. Created on first launch. */
  getCurrentDevice(): Promise<Device>;
  putDevice(device: Device): Promise<void>;

  listNotifPrefs(): Promise<NotifPrefs[]>;
  putNotifPrefs(prefs: NotifPrefs): Promise<void>;

  /* ---------------- Medications & schedules ---------------- */

  listMedications(personId: string): Promise<Medication[]>;
  getMedication(id: string): Promise<Medication | undefined>;
  putMedication(med: Medication): Promise<void>;
  deleteMedication(id: string): Promise<void>;

  listSchedules(personId: string): Promise<Schedule[]>;
  listSchedulesForMed(medId: string): Promise<Schedule[]>;
  putSchedule(schedule: Schedule): Promise<void>;
  deleteSchedule(id: string): Promise<void>;

  /* ---------------- Dose events ---------------- */

  listDoseEvents(personId: string, range?: QueryRange): Promise<DoseEvent[]>;
  getDoseEvent(id: string): Promise<DoseEvent | undefined>;
  putDoseEvent(event: DoseEvent): Promise<void>;
  /** Bulk write inside a single transaction. */
  putDoseEvents(events: DoseEvent[]): Promise<void>;

  /* ---------------- Inventory ---------------- */

  listInventoryEvents(medId: string, range?: QueryRange): Promise<InventoryEvent[]>;
  putInventoryEvent(event: InventoryEvent): Promise<void>;

  /* ---------------- Clinical & logs ---------------- */

  listLabResults(personId: string): Promise<LabResult[]>;
  getLabResult(id: string): Promise<LabResult | undefined>;
  putLabResult(result: LabResult): Promise<void>;
  /** Soft-delete a lab result so it disappears from lists but keeps history. */
  deleteLabResult(id: string): Promise<void>;

  listDocuments(personId: string): Promise<DocumentRef[]>;
  putDocument(doc: DocumentRef): Promise<void>;

  listSymptoms(personId: string): Promise<Symptom[]>;
  putSymptom(symptom: Symptom): Promise<void>;

  listFoodLogs(personId: string): Promise<FoodLog[]>;
  putFoodLog(log: FoodLog): Promise<void>;

  listRecurringTests(personId: string): Promise<RecurringTest[]>;
  putRecurringTest(test: RecurringTest): Promise<void>;

  /* ---------------- System ---------------- */

  listAuditLogs(limit?: number): Promise<AuditLog[]>;
  appendAuditLog(log: AuditLog): Promise<void>;

  getSettings(): Promise<AppSettings>;
  putSettings(settings: AppSettings): Promise<void>;

  /* ---------------- Outbox (offline sync) ---------------- */

  enqueueOutbox(item: OutboxItem): Promise<void>;
  listOutbox(): Promise<OutboxItem[]>;
  removeOutbox(id: string): Promise<void>;
  bumpOutboxAttempt(id: string, error: string): Promise<void>;

  /* ---------------- Atomic operations ---------------- */

  /**
   * Mark a dose taken and deduct inventory in ONE transaction (§7).
   * Idempotent: calling twice with the same doseId is a no-op.
   * Returns whether the write actually happened.
   */
  markDoseTaken(input: MarkDoseTakenInput): Promise<{ applied: boolean; newBalance: number }>;

  /** Bulk export of one person's full dataset — used by backup/restore. */
  exportPerson(personId: string): Promise<PersonExport>;

  /** Restore a dataset. Never overwrites without the caller confirming. */
  importPerson(dataset: PersonExport): Promise<void>;
}

export interface MarkDoseTakenInput {
  dose: DoseEvent;
  medId: string;
  personId: string;
  quantity: number;
  deviceId: string;
  atUtc: string;
  inventoryEventId: string;
  /** 'mother' | 'caregiver' */
  source: 'mother' | 'caregiver';
  /** true when the caregiver acted on the mother's behalf. */
  makeAuditEntry?: boolean;
}

export interface PersonExport {
  schemaVersion: number;
  exportedAt: string;
  person: Person;
  medications: Medication[];
  schedules: Schedule[];
  doseEvents: DoseEvent[];
  inventoryEvents: InventoryEvent[];
  labResults: LabResult[];
  documents: DocumentRef[];
  symptoms: Symptom[];
  foodLogs: FoodLog[];
  recurringTests: RecurringTest[];
  notifPrefs: NotifPrefs[];
}

export const CURRENT_SCHEMA_VERSION = 3;
