/**
 * Shared data model — the single source of truth for every layer.
 * Mirrors the Firestore collections 1:1 (see docs/DATA-MODEL.md).
 *
 * HARD RULE: this file is pure TypeScript. No React, Dexie, Capacitor, or Firebase imports.
 */

export type ISODate = string; // 'YYYY-MM-DD' — a *local* calendar day
export type ISODateTime = string; // ISO 8601 UTC instant
export type HHmm = string; // 'HH:mm' in the person's local timezone

export type Platform = 'android' | 'web' | 'desktop';

/* ------------------------------------------------------------------ */
/* Sync envelope                                                       */
/* ------------------------------------------------------------------ */

/** Every synced document carries this envelope. */
export interface SyncEnvelope {
  id: string;
  /** Server-authoritative timestamp of last write. */
  updatedAt: ISODateTime;
  /** Device that produced the write. */
  updatedBy: string;
  /** Monotonic integer, bumped on every write. Drives conflict detection. */
  rev: number;
  /** Soft-delete. Rows are never physically removed on sync. */
  deleted: boolean;
}

/* ------------------------------------------------------------------ */
/* People & devices                                                    */
/* ------------------------------------------------------------------ */

export interface EmergencyContact {
  name: string;
  phone: string;
  relation: string;
}

export interface Person extends SyncEnvelope {
  nameAr: string;
  nameEn?: string;
  dob?: ISODate;
  gender?: 'male' | 'female';
  bloodType?: string;
  allergies: string[];
  notes?: string;
  emergencyContact?: EmergencyContact;
  colorTag?: string;
  isMinor?: boolean;
  /** IANA timezone, e.g. 'Africa/Cairo'. NEVER hardcode a fixed UTC offset. */
  timezone: string;
  /** Mother Mode large-text default. */
  largeTextDefault?: boolean;
}

export type AlertMode = 'off' | 'escalationOnly' | 'mirrorAll' | 'digest';

export interface NotifPrefs extends SyncEnvelope {
  /** Per (device, person) alert preference for caregiver devices. */
  deviceId: string;
  personId: string;
  mode: AlertMode;
  escalationDelayMin: number;
}

/** Alarm-health watchdog payload — see §9. Zero silent failures. */
export interface AlarmHealth {
  exactAlarmGranted: boolean;
  batteryExempt: boolean;
  notifGranted: boolean;
  lastRescheduleAtUtc?: ISODateTime;
  nextAlarmAtUtc?: ISODateTime;
}

export interface Device extends SyncEnvelope {
  label: string;
  platform: Platform;
  /** A device is bound to at most ONE person. null = caregiver device. */
  boundPersonId: string | null;
  fcmToken?: string;
  lastSeenAt?: ISODateTime;
  alarmHealth?: AlarmHealth;
}

/* ------------------------------------------------------------------ */
/* Medication                                                          */
/* ------------------------------------------------------------------ */

export type DoseForm =
  | 'tablet'
  | 'capsule'
  | 'syrup'
  | 'injection'
  | 'drops'
  | 'inhaler'
  | 'patch'
  | 'other';

export type PackageKind = 'strips' | 'direct';

export interface PackageInfo {
  kind: PackageKind;
  /** Only when kind === 'strips'. */
  strips?: number;
  pillsPerStrip?: number;
  /** Total units in the package (for 'direct', the unit count). */
  pillCount: number;
}

export interface Strength {
  value: number;
  unit: string; // 'mg' | 'ml' | 'IU' | 'mcg' ...
}

export interface FoodRule {
  mode: 'with' | 'before' | 'after' | 'emptyStomach' | 'avoid' | 'custom';
  text?: string;
}

export interface CostInfo {
  packagePrice: number;
  currency: string; // 'EGP' | 'SAR' | ...
  purchasedAt?: ISODate;
  packageSize: number;
}

export type MedStatus = 'active' | 'paused' | 'finished' | 'discontinued';

export interface Medication extends SyncEnvelope {
  personId: string;
  nameAr: string;
  nameEn?: string;
  activeIngredients: string[];
  strength: Strength;
  form: DoseForm;
  package: PackageInfo;
  manufacturer?: string;
  notes?: string;
  rx: { isPrescription: boolean; isControlled: boolean; renewalDate?: ISODate };
  packExpiry?: ISODate;
  startDate: ISODate;
  endDate?: ISODate;
  foodRule: FoodRule;
  cost: CostInfo;
  doctor?: string;
  condition?: string;
  status: MedStatus;
  discontinuedReason?: string;
  /** Fast-read cache. ALWAYS recomputable by folding inventoryEvents (§7). */
  balanceCache?: number;
}

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

export type ScheduleKind = 'daily' | 'everyNDays' | 'weekdays' | 'prn' | 'taper';

export interface TaperStep {
  from: ISODate;
  to: ISODate;
  quantityPerDose: number;
}

/**
 * History is never destroyed. Editing a schedule CLOSES the old one
 * (sets activeTo) and inserts a new one. Past doses keep pointing at
 * the old schedule id.
 */
export interface Schedule extends SyncEnvelope {
  medId: string;
  personId: string;
  kind: ScheduleKind;
  /** 'HH:mm' local times. Ignored for `prn`. */
  times: HHmm[];
  quantityPerDose: number;
  /** Derived, stored for convenience. */
  dosesPerDay: number;
  anchorDate: ISODate;
  endDate?: ISODate;
  /** 0 = Sunday … 6 = Saturday. Used by kind === 'weekdays'. */
  weekdays?: number[];
  intervalN?: number;
  prnMaxPerDay?: number;
  taperSteps?: TaperStep[];
  activeFrom: ISODate;
  /** null = this is the current schedule. */
  activeTo: ISODate | null;
  supersededBy?: string;
}

/* ------------------------------------------------------------------ */
/* Dose events                                                         */
/* ------------------------------------------------------------------ */

export type DoseStatus =
  | 'upcoming'
  | 'due'
  | 'taken'
  | 'missed'
  | 'skipped'
  | 'snoozed'
  | 'cancelled';

export type DoseSource = 'mother' | 'caregiver' | 'auto-missed';

export interface DoseEvent extends SyncEnvelope {
  personId: string;
  medId: string;
  scheduleId: string;
  scheduledAtUtc: ISODateTime;
  /** The local calendar day this dose belongs to. */
  localDay: ISODate;
  status: DoseStatus;
  actedAtUtc?: ISODateTime;
  actedByDeviceId?: string;
  quantity?: number;
  source?: DoseSource;
  snoozedUntil?: ISODateTime;
  /** UNIQUE: personId + medId + scheduledAtUtc. Makes re-sends a no-op. */
  idempotencyKey: string;
}

/* ------------------------------------------------------------------ */
/* Inventory events (append-only)                                      */
/* ------------------------------------------------------------------ */

export type InventoryEventType =
  | 'initial'
  | 'doseTaken'
  | 'manualAdd'
  | 'manualRemove'
  | 'purchase'
  | 'correction'
  | 'discontinued';

export interface InventoryEvent extends SyncEnvelope {
  personId: string;
  medId: string;
  type: InventoryEventType;
  /** Signed: negative for consumption, positive for additions. */
  qty: number;
  reason?: string;
  prevBalance: number;
  newBalance: number;
  atUtc: ISODateTime;
  deviceId: string;
  doseId?: string;
}

/* ------------------------------------------------------------------ */
/* Clinical & logs                                                     */
/* ------------------------------------------------------------------ */

export interface AiSummary {
  schemaVersion: number;
  model: string;
  atUtc: ISODateTime;
  sections: Record<string, unknown>;
}

export interface LabResult extends SyncEnvelope {
  personId: string;
  type: string;
  date: ISODate;
  fileRef?: string;
  aiSummary?: AiSummary;
  status: 'pending' | 'summarised' | 'failed';
}

export interface DocumentRef extends SyncEnvelope {
  personId: string;
  kind: string;
  title: string;
  storagePath: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: ISODateTime;
}

export interface Symptom extends SyncEnvelope {
  personId: string;
  atUtc: ISODateTime;
  severity: 1 | 2 | 3 | 4 | 5;
  note: string;
  relatedMedId?: string;
}

export interface FoodLog extends SyncEnvelope {
  personId: string;
  atUtc: ISODateTime;
  text: string;
  relatedMedId?: string;
}

export type TestInterval = 'monthly' | '3m' | '6m' | 'yearly' | 'custom';

export interface RecurringTest extends SyncEnvelope {
  personId: string;
  name: string;
  interval: TestInterval;
  customIntervalDays?: number;
  nextDue: ISODate;
  lastDone?: ISODate;
}

/* ------------------------------------------------------------------ */
/* System                                                              */
/* ------------------------------------------------------------------ */

export interface AuditLog extends SyncEnvelope {
  actorDeviceId: string;
  atUtc: ISODateTime;
  entity: string;
  entityId: string;
  action: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** Local-only outbox row awaiting connectivity. */
export interface OutboxItem {
  id: string;
  entity: string;
  entityId: string;
  op: 'upsert' | 'delete';
  payload: unknown;
  createdAtUtc: ISODateTime;
  attempts: number;
  lastError?: string;
}

/** Settings that live on the device, not the cloud. */
export interface AppSettings {
  numeralStyle: 'western' | 'eastern';
  theme: 'light' | 'dark' | 'system';
  language: 'ar';
  largeText: boolean;
  speakAloud: boolean;
  appLockEnabled: boolean;
  autoLockMinutes: number;
  missedGraceMinutes: number;
  lowStockThresholdDays: number;
  activePersonId?: string;
  activeMode: 'caregiver' | 'mother';
}

/* ------------------------------------------------------------------ */
/* Idempotency helpers                                                 */
/* ------------------------------------------------------------------ */

export function doseIdempotencyKey(
  personId: string,
  medId: string,
  scheduledAtUtc: ISODateTime,
): string {
  return `${personId}::${medId}::${scheduledAtUtc}`;
}

export function doseEventId(personId: string, medId: string, scheduledAtUtc: ISODateTime): string {
  // Deterministic id → same dose always maps to the same row, so an
  // offline retry or a double tap cannot create a duplicate.
  return `dose_${hashString(doseIdempotencyKey(personId, medId, scheduledAtUtc))}`;
}

/** Small non-crypto hash — stable ids, not security. */
export function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  const a = (h1 >>> 0).toString(36);
  const b = (h2 >>> 0).toString(36);
  return (a + b).slice(0, 16);
}

export function newId(prefix = 'x'): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `${prefix}_${rnd}`;
}
