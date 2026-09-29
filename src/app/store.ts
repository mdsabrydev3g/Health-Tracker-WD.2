/**
 * Central app store — the single place features read data from.
 *
 * It owns the Repository instance, materialises doses, derives statuses,
 * and exposes actions that keep local state + the outbox consistent.
 */

import { create } from 'zustand';
import type {
  AppSettings,
  Device,
  DoseEvent,
  InventoryEvent,
  Medication,
  Person,
  Schedule,
} from '@/core/db/schema';
import { newId } from '@/core/db/schema';
import { DexieRepository } from '@/core/db/dexie.adapter';
import type { Repository } from '@/core/db/repository';
import {
  computeStatuses,
  materialisationWindow,
  materialiseDoses,
} from '@/core/engine/dose.engine';
import { foldBalance, buildInventoryEvent, alreadyConsumed, projectStock } from '@/core/engine/inventory.engine';
import type { StockProjection } from '@/core/engine/inventory.engine';
import { todayIn } from '@/lib/utils';
import { rescheduleAlarms, cancelAllAlarms } from '@/core/notify/alarmService';
import { createSeed } from '@/features/onboarding/seed';
import { isCloudSyncConfigured, runSync } from '@/core/sync/cloudSync';
import type { SyncConflict, SyncStatus } from '@/core/sync/cloudSync';
import { registerConnectivityHandlers } from '@/core/sync/outbox';

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt?: string;
  lastError?: string;
  conflicts: SyncConflict[];
}

export interface AppState {
  ready: boolean;
  error: string | null;
  repo: Repository;
  settings: AppSettings;
  device: Device | null;
  persons: Person[];
  activePersonId: string | null;
  medications: Medication[];
  schedules: Schedule[];
  doseEvents: DoseEvent[];
  inventoryByMed: Record<string, InventoryEvent[]>;
  statuses: Map<string, DoseEvent['status']>;
  busy: boolean;

  /* lifecycle */
  bootstrap: () => Promise<void>;
  refresh: () => Promise<void>;
  setActivePerson: (personId: string) => Promise<void>;
  setSettings: (patch: Partial<AppSettings>) => Promise<void>;
  switchMode: (mode: AppSettings['activeMode']) => Promise<void>;

  /* people */
  addPerson: (input: Partial<Person> & { nameAr: string; timezone: string }) => Promise<Person>;

  /* medications */
  saveMedication: (med: Partial<Medication> & { personId: string; nameAr: string }) => Promise<Medication>;
  archiveMedication: (medId: string, reason: string) => Promise<void>;
  deleteMedication: (medId: string) => Promise<void>;
  deleteSchedule: (scheduleId: string) => Promise<void>;
  deleteLab: (labId: string) => Promise<void>;

  /* schedules */
  saveSchedule: (schedule: Partial<Schedule> & { medId: string; personId: string }) => Promise<Schedule>;

  /* doses */
  markTaken: (doseId: string, source: 'mother' | 'caregiver', quantity?: number) => Promise<void>;
  skipDose: (doseId: string, source: 'mother' | 'caregiver') => Promise<void>;
  snoozeDose: (doseId: string, minutes: number) => Promise<void>;
  logPrnDose: (medId: string, quantity: number, source: 'mother' | 'caregiver') => Promise<void>;

  /* inventory */
  adjustInventory: (input: {
    medId: string;
    qty: number;
    type: InventoryEvent['type'];
    reason: string;
    atUtc?: string;
  }) => Promise<void>;

  /* sync — keeps phone / desktop / web in step */
  syncState: SyncState;
  syncNow: () => Promise<void>;
  /** Start periodic + reconnect syncing. Returns a stop function. */
  startAutoSync: () => () => void;

  /** Reschedule device alarms from current state (consumes planAlarms). */
  rescheduleAlarms: () => Promise<void>;

  /* derived helpers */
  activePerson: () => Person | undefined;
  dosesForDay: (day: string) => DoseEvent[];
  inventoryFor: (medId: string) => InventoryEvent[];
  balanceOf: (medId: string) => number;
  medById: (medId: string) => Medication | undefined;
}

const seedRepo = new DexieRepository();

/*
 * Sync guards.
 *
 * `syncInFlight` keeps one cycle at a time — without it, the refresh() that
 * sync itself triggers after applying remote rows would schedule another
 * sync, which would refresh again, forever.
 */
let syncInFlight = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced sync kick, so a burst of edits costs one round trip. */
function scheduleSync(get: () => AppState, delay = 4000): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void get().syncNow();
  }, delay);
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  error: null,
  repo: seedRepo,
  settings: {
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
  },
  device: null,
  persons: [],
  activePersonId: null,
  medications: [],
  schedules: [],
  doseEvents: [],
  inventoryByMed: {},
  statuses: new Map(),
  busy: false,
  syncState: { status: 'idle', conflicts: [] },

  /* ---------------- lifecycle ---------------- */

  bootstrap: async () => {
    set({ busy: true, error: null });
    try {
      const repo = get().repo;
      await repo.init();

      const device = await repo.getCurrentDevice();
      let settings = await repo.getSettings();
      let persons = await repo.listPersons();

      // First run on an empty database: seed a realistic family so the
      // caregiver sees a working app immediately (§15 phase 2).
      if (persons.length === 0) {
        const seeded = await createSeed(repo, device.id);
        persons = [seeded];
        settings = { ...settings, activePersonId: seeded.id };
        await repo.putSettings(settings);
      }

      const activePersonId = settings.activePersonId ?? persons[0]?.id ?? null;
      if (activePersonId && activePersonId !== settings.activePersonId) {
        settings = { ...settings, activePersonId };
        await repo.putSettings(settings);
      }

      set({ device, settings, persons, activePersonId, ready: true, busy: false });
      await get().refresh();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), busy: false, ready: true });
    }
  },

  refresh: async () => {
    const { repo, activePersonId, settings } = get();
    if (!activePersonId) return;

    const person = get().persons.find((p) => p.id === activePersonId);
    if (!person) return;

    const medications = await repo.listMedications(activePersonId);
    const schedules = await repo.listSchedules(activePersonId);

    // Materialise a fresh window and persist any newly-created instances so
    // they exist offline and survive restarts (§6).
    const { fromDay, toDay } = materialisationWindow(person.timezone, new Date(), 14);
    const instances = materialiseDoses({ person, medications, schedules, fromDay, toDay });

    const existing = await repo.listDoseEvents(activePersonId, { from: fromDay, to: toDay });
    const existingIds = new Set(existing.map((e) => e.id));
    const toCreate = instances
      .filter((i) => !existingIds.has(i.id))
      .map((i) => ({
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
        updatedBy: get().device?.id ?? 'system',
        rev: 1,
        deleted: false,
      }));
    if (toCreate.length) await repo.putDoseEvents(toCreate);

    // Load a window wide enough for reports and streaks.
    const reportFrom = todayIn(person.timezone, new Date(Date.now() - 120 * 86400_000));
    const doseEvents = await repo.listDoseEvents(activePersonId, { from: reportFrom, to: toDay });

    const statuses = computeStatuses({
      events: doseEvents,
      timezone: person.timezone,
      graceMinutes: settings.missedGraceMinutes,
      now: new Date(),
    });

    const inventoryByMed: Record<string, InventoryEvent[]> = {};
    for (const med of medications) {
      inventoryByMed[med.id] = await repo.listInventoryEvents(med.id);
    }

    // Persist any status transitions the clock just caused, so the caregiver
    // dashboard and the audit trail agree with what the user sees.
    const changed: DoseEvent[] = [];
    for (const e of doseEvents) {
      const derived = statuses.get(e.id);
      if (derived && derived !== e.status && derived === 'missed') {
        changed.push({
          ...e,
          status: 'missed',
          source: 'auto-missed',
          updatedAt: new Date().toISOString(),
          rev: e.rev + 1,
        });
      }
    }
    if (changed.length) {
      await repo.putDoseEvents(changed);
      const map = new Map(changed.map((c) => [c.id, c]));
      for (let i = 0; i < doseEvents.length; i++) {
        const c = map.get(doseEvents[i]!.id);
        if (c) doseEvents[i] = c;
      }
      for (const c of changed) statuses.set(c.id, 'missed');
    }

    set({ medications, schedules, doseEvents, inventoryByMed, statuses });

    // Re-arm the device alarms for the freshly-loaded state. This is the
    // critical path that actually registers per-dose + low-stock alarms.
    void get().rescheduleAlarms();

    // Any local change should reach the other devices. Debounced so a burst
    // of writes is one round trip, and skipped while a sync is applying
    // remote rows (that would loop).
    if (!syncInFlight) scheduleSync(get);
  },

  setActivePerson: async (personId) => {
    const settings = { ...get().settings, activePersonId: personId };
    await get().repo.putSettings(settings);
    set({ activePersonId: personId, settings });
    // Drop alarms belonging to the previous person before loading the new one.
    await cancelAllAlarms();
    await get().refresh();
  },

  setSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    await get().repo.putSettings(settings);
    set({ settings });
  },

  switchMode: async (mode) => {
    await get().setSettings({ activeMode: mode });
    // The notification policy hinges on mode — drop the old policy's alarms
    // and reschedule under the new one (Mother gets dose alarms, Owner doesn't).
    await cancelAllAlarms();
    await get().rescheduleAlarms();
  },

  /* ---------------- people ---------------- */

  addPerson: async (input) => {
    const now = new Date().toISOString();
    const deviceId = get().device?.id ?? 'system';
    const person: Person = {
      id: newId('per'),
      nameAr: input.nameAr,
      timezone: input.timezone,
      allergies: input.allergies ?? [],
      dob: input.dob,
      gender: input.gender,
      bloodType: input.bloodType,
      notes: input.notes,
      emergencyContact: input.emergencyContact,
      colorTag: input.colorTag,
      isMinor: input.isMinor ?? false,
      largeTextDefault: input.largeTextDefault,
      updatedAt: now,
      updatedBy: deviceId,
      rev: 1,
      deleted: false,
    };
    await get().repo.putPerson(person);
    const persons = [...get().persons, person];
    set({ persons });
    return person;
  },

  /* ---------------- medications ---------------- */

  saveMedication: async (input) => {
    const now = new Date().toISOString();
    const deviceId = get().device?.id ?? 'system';
    const existing = input.id ? await get().repo.getMedication(input.id) : undefined;

    const med: Medication = {
      id: input.id ?? newId('med'),
      personId: input.personId,
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      activeIngredients: input.activeIngredients ?? [],
      strength: input.strength ?? { value: 1, unit: 'mg' },
      form: input.form ?? 'tablet',
      package: input.package ?? { kind: 'strips', strips: 1, pillsPerStrip: 30, pillCount: 30 },
      manufacturer: input.manufacturer,
      notes: input.notes,
      rx: input.rx ?? { isPrescription: true, isControlled: false },
      packExpiry: input.packExpiry,
      startDate: input.startDate ?? todayIn(findTimezone(get().persons, input.personId)),
      endDate: input.endDate,
      foodRule: input.foodRule ?? { mode: 'with' },
      cost: input.cost ?? { packagePrice: 0, currency: 'EGP', packageSize: 30 },
      doctor: input.doctor,
      condition: input.condition,
      status: input.status ?? 'active',
      discontinuedReason: input.discontinuedReason,
      balanceCache: input.balanceCache ?? existing?.balanceCache ?? 0,
      updatedAt: now,
      updatedBy: deviceId,
      rev: (existing?.rev ?? 0) + 1,
      deleted: false,
    };

    await get().repo.putMedication(med);

    // A brand-new medication with no stock gets an `initial` inventory event
    // so the balance is always explainable by the event log (§5).
    if (!existing && input.balanceCache && input.balanceCache > 0) {
      await get().adjustInventory({
        medId: med.id,
        qty: input.balanceCache,
        type: 'initial',
        reason: 'الرصيد الافتتاحي',
        atUtc: now,
      });
    }

    await get().refresh();
    return med;
  },

  archiveMedication: async (medId, reason) => {
    const med = await get().repo.getMedication(medId);
    if (!med) return;
    const now = new Date().toISOString();
    const deviceId = get().device?.id ?? 'system';

    await get().repo.putMedication({
      ...med,
      status: 'discontinued',
      discontinuedReason: reason,
      updatedAt: now,
      updatedBy: deviceId,
      rev: med.rev + 1,
    });

    // Close every live schedule so no further doses are generated.
    for (const s of get().schedules.filter((s) => s.medId === medId && s.activeTo === null)) {
      await get().repo.putSchedule({
        ...s,
        activeTo: todayIn(findTimezone(get().persons, med.personId)),
        updatedAt: now,
        updatedBy: deviceId,
        rev: s.rev + 1,
      });
    }

    await get().repo.appendAuditLog({
      id: newId('aud'),
      actorDeviceId: deviceId,
      atUtc: now,
      entity: 'medications',
      entityId: medId,
      action: 'discontinue',
      before: { status: med.status },
      after: { status: 'discontinued', reason },
      updatedAt: now,
      updatedBy: deviceId,
      rev: 1,
      deleted: false,
    });

    await get().refresh();
  },

  deleteMedication: async (medId) => {
    const { repo } = get();
    const med = await repo.getMedication(medId);
    if (!med) return;
    const deviceId = get().device?.id ?? 'system';
    const now = new Date().toISOString();

    await repo.deleteMedication(medId);

    // Cascade: remove its schedules and soft-cancel its dose events so no
    // orphan doses keep showing up (§5 — history is never physically removed).
    for (const s of get().schedules.filter((s) => s.medId === medId && !s.deleted)) {
      await repo.deleteSchedule(s.id);
    }
    for (const d of get().doseEvents.filter((d) => d.medId === medId && !d.deleted)) {
      await repo.putDoseEvent({ ...d, deleted: true, rev: d.rev + 1, updatedAt: now });
    }

    await repo.appendAuditLog({
      id: newId('aud'),
      actorDeviceId: deviceId,
      atUtc: now,
      entity: 'medications',
      entityId: medId,
      action: 'delete',
      after: { name: med.nameAr },
      updatedAt: now,
      updatedBy: deviceId,
      rev: 1,
      deleted: false,
    });

    await get().refresh();
  },

  deleteSchedule: async (scheduleId) => {
    const { repo } = get();
    await repo.deleteSchedule(scheduleId);
    await get().refresh();
  },

  deleteLab: async (labId) => {
    const { repo } = get();
    await repo.deleteLabResult(labId);
    await get().refresh();
  },

  /* ---------------- schedules ---------------- */

  saveSchedule: async (input) => {
    const now = new Date().toISOString();
    const deviceId = get().device?.id ?? 'system';
    const today = todayIn(findTimezone(get().persons, input.personId));

    // Editing a schedule CLOSES the old one and inserts a new one so past
    // doses keep pointing at history (§5).
    if (input.id) {
      const prev = get().schedules.find((s) => s.id === input.id);
      if (prev && prev.activeTo === null) {
        await get().repo.putSchedule({
          ...prev,
          activeTo: today,
          updatedAt: now,
          updatedBy: deviceId,
          rev: prev.rev + 1,
        });
      }
    }

    const schedule: Schedule = {
      id: newId('sch'),
      medId: input.medId,
      personId: input.personId,
      kind: input.kind ?? 'daily',
      times: input.times ?? ['08:00'],
      quantityPerDose: input.quantityPerDose ?? 1,
      dosesPerDay:
        input.dosesPerDay ?? (input.kind === 'prn' ? 0 : (input.times ?? ['08:00']).length),
      anchorDate: input.anchorDate ?? today,
      endDate: input.endDate,
      weekdays: input.weekdays,
      intervalN: input.intervalN,
      prnMaxPerDay: input.prnMaxPerDay,
      taperSteps: input.taperSteps,
      activeFrom: today,
      activeTo: null,
      updatedAt: now,
      updatedBy: deviceId,
      rev: 1,
      deleted: false,
    };

    await get().repo.putSchedule(schedule);
    await get().refresh();
    return schedule;
  },

  /* ---------------- doses ---------------- */

  markTaken: async (doseId, source, quantity) => {
    const { repo, doseEvents, medications } = get();
    const dose = doseEvents.find((d) => d.id === doseId) ?? (await repo.getDoseEvent(doseId));
    if (!dose) return;

    const med = medications.find((m) => m.id === dose.medId);
    const qty = quantity ?? dose.quantity ?? 1;
    const deviceId = get().device?.id ?? 'system';
    const now = new Date().toISOString();

    // §7: guard against a double tap / offline retry deducting twice.
    const events = await repo.listInventoryEvents(dose.medId);
    if (alreadyConsumed(events, dose.id)) {
      await get().refresh();
      return;
    }

    await repo.markDoseTaken({
      dose,
      medId: dose.medId,
      personId: dose.personId,
      quantity: qty,
      deviceId,
      atUtc: now,
      inventoryEventId: newId('inv'),
      source,
    });

    await repo.appendAuditLog({
      id: newId('aud'),
      actorDeviceId: deviceId,
      atUtc: now,
      entity: 'doseEvents',
      entityId: dose.id,
      action: 'taken',
      after: { status: 'taken', quantity: qty, medName: med?.nameAr ?? '' },
      updatedAt: now,
      updatedBy: deviceId,
      rev: 1,
      deleted: false,
    });

    await get().refresh();
  },

  skipDose: async (doseId, source) => {
    const { repo, doseEvents } = get();
    const dose = doseEvents.find((d) => d.id === doseId) ?? (await repo.getDoseEvent(doseId));
    if (!dose) return;
    const deviceId = get().device?.id ?? 'system';
    const now = new Date().toISOString();

    await repo.putDoseEvent({
      ...dose,
      status: 'skipped',
      actedAtUtc: now,
      actedByDeviceId: deviceId,
      source,
      updatedAt: now,
      updatedBy: deviceId,
      rev: dose.rev + 1,
    });

    await repo.appendAuditLog({
      id: newId('aud'),
      actorDeviceId: deviceId,
      atUtc: now,
      entity: 'doseEvents',
      entityId: dose.id,
      action: 'skipped',
      updatedAt: now,
      updatedBy: deviceId,
      rev: 1,
      deleted: false,
    });

    await get().refresh();
  },

  snoozeDose: async (doseId, minutes) => {
    const { repo, doseEvents } = get();
    const dose = doseEvents.find((d) => d.id === doseId) ?? (await repo.getDoseEvent(doseId));
    if (!dose) return;
    const now = new Date();
    const deviceId = get().device?.id ?? 'system';
    const until = new Date(now.getTime() + minutes * 60_000).toISOString();

    await repo.putDoseEvent({
      ...dose,
      status: 'snoozed',
      snoozedUntil: until,
      actedAtUtc: now.toISOString(),
      actedByDeviceId: deviceId,
      updatedAt: now.toISOString(),
      updatedBy: deviceId,
      rev: dose.rev + 1,
    });

    await get().refresh();
  },

  logPrnDose: async (medId, quantity, source) => {
    const { repo, medications, schedules } = get();
    const med = medications.find((m) => m.id === medId);
    if (!med) return;
    const prnSchedule = schedules.find((s) => s.medId === medId && s.kind === 'prn');
    const deviceId = get().device?.id ?? 'system';
    const now = new Date();
    const nowIso = now.toISOString();
    const person = get().persons.find((p) => p.id === med.personId);
    const tz = person?.timezone ?? 'Africa/Cairo';

    // PRN doses are recorded after the fact — never scheduled, never "missed".
    const dose: DoseEvent = {
      id: newId('prn'),
      personId: med.personId,
      medId,
      scheduleId: prnSchedule?.id ?? 'prn',
      scheduledAtUtc: nowIso,
      localDay: todayIn(tz, now),
      status: 'taken',
      actedAtUtc: nowIso,
      actedByDeviceId: deviceId,
      quantity,
      source,
      idempotencyKey: `prn::${medId}::${nowIso}`,
      updatedAt: nowIso,
      updatedBy: deviceId,
      rev: 1,
      deleted: false,
    };
    await repo.putDoseEvent(dose);

    const events = await repo.listInventoryEvents(medId);
    const { balance } = foldBalance(events);
    await repo.putInventoryEvent(
      buildInventoryEvent({
        id: newId('inv'),
        personId: med.personId,
        medId,
        type: 'doseTaken',
        qty: -quantity,
        prevBalance: balance,
        reason: 'جرعة عند الحاجة',
        atUtc: nowIso,
        deviceId,
        doseId: dose.id,
      }),
    );

    await get().refresh();
  },

  /* ---------------- inventory ---------------- */

  adjustInventory: async ({ medId, qty, type, reason, atUtc }) => {
    const { repo, medications } = get();
    const med = medications.find((m) => m.id === medId);
    if (!med) return;
    const deviceId = get().device?.id ?? 'system';
    const iso = atUtc ?? new Date().toISOString();

    const events = await repo.listInventoryEvents(medId);
    const { balance } = foldBalance(events);

    const event = buildInventoryEvent({
      id: newId('inv'),
      personId: med.personId,
      medId,
      type,
      qty,
      prevBalance: balance,
      reason,
      atUtc: iso,
      deviceId,
    });
    await repo.putInventoryEvent(event);
    await repo.putMedication({ ...med, balanceCache: event.newBalance, updatedAt: iso, rev: med.rev + 1 });

    await repo.appendAuditLog({
      id: newId('aud'),
      actorDeviceId: deviceId,
      atUtc: iso,
      entity: 'inventoryEvents',
      entityId: event.id,
      action: type,
      before: { balance },
      after: { balance: event.newBalance, qty, reason },
      updatedAt: iso,
      updatedBy: deviceId,
      rev: 1,
      deleted: false,
    });

    await get().refresh();
  },

  /* ---------------- sync ---------------- */

  syncNow: async () => {
    if (syncInFlight) return;

    if (!isCloudSyncConfigured()) {
      set((s) => ({ syncState: { ...s.syncState, status: 'idle', lastError: undefined } }));
      return;
    }

    const { repo, activePersonId } = get();
    if (!activePersonId) return;

    syncInFlight = true;
    set((s) => ({ syncState: { ...s.syncState, status: 'syncing', lastError: undefined } }));
    try {
      const result = await runSync({ repo, personId: activePersonId });
      set((s) => ({
        syncState: {
          status: result.status,
          lastSyncedAt: result.lastSyncedAt ?? s.syncState.lastSyncedAt,
          lastError: result.lastError,
          conflicts: result.conflicts,
        },
      }));
      // Remote rows changed local data, so reload it. syncInFlight is still
      // true here, which is exactly why this refresh won't schedule another
      // sync — otherwise applying remote data would loop forever.
      if (result.pulled > 0) await get().refresh();
    } catch (e) {
      set((s) => ({
        syncState: {
          ...s.syncState,
          status: 'error',
          lastError: e instanceof Error ? e.message : String(e),
        },
      }));
    } finally {
      syncInFlight = false;
    }
  },

  startAutoSync: () => {
    // Periodic, so a device left open still picks up the other's changes.
    const interval = setInterval(() => void get().syncNow(), 60_000);

    // Straight away when connectivity returns (offline-first, §12).
    const stopConnectivity = registerConnectivityHandlers((online) => {
      if (online) void get().syncNow();
    });

    // And once early, so a second device's edits land soon after opening.
    const bootTimer = setTimeout(() => void get().syncNow(), 3000);

    return () => {
      clearInterval(interval);
      clearTimeout(bootTimer);
      stopConnectivity();
    };
  },

  /* ---------------- alarms ---------------- */

  rescheduleAlarms: async () => {
    const { medications, schedules, doseEvents, inventoryByMed, settings, persons, activePersonId } =
      get();
    const person = persons.find((p) => p.id === activePersonId);
    const today = todayIn(person?.timezone ?? 'Africa/Cairo');

    const projections = new Map<string, StockProjection>();
    for (const med of medications) {
      const events = inventoryByMed[med.id] ?? [];
      const medSchedules = schedules.filter((s) => s.medId === med.id);
      projections.set(
        med.id,
        projectStock({
          medication: med,
          schedules: medSchedules,
          events,
          today,
          lowStockThresholdDays: settings.lowStockThresholdDays,
        }),
      );
    }

    await rescheduleAlarms({
      doses: doseEvents,
      medications,
      projections,
      mode: settings.activeMode,
      getMed: (id) => get().medById(id),
    });
  },

  /* ---------------- derived ---------------- */

  activePerson: () => {
    const { persons, activePersonId } = get();
    return persons.find((p) => p.id === activePersonId);
  },

  dosesForDay: (day) => {
    const { doseEvents } = get();
    return doseEvents
      .filter((e) => e.localDay === day)
      .sort((a, b) => a.scheduledAtUtc.localeCompare(b.scheduledAtUtc));
  },

  inventoryFor: (medId) => get().inventoryByMed[medId] ?? [],

  balanceOf: (medId) => foldBalance(get().inventoryByMed[medId] ?? []).balance,

  medById: (medId) => get().medications.find((m) => m.id === medId),
}));

function findTimezone(persons: Person[], personId: string): string {
  return persons.find((p) => p.id === personId)?.timezone ?? 'Africa/Cairo';
}

/** Apply a status override for display without mutating stored data. */
export function derivedStatus(state: AppState, dose: DoseEvent): DoseEvent['status'] {
  return state.statuses.get(dose.id) ?? dose.status;
}
