/**
 * Notification scheduler — the single most important feature (§9).
 *
 * Dose reminders are LOCAL notifications scheduled ahead of time from the
 * materialised dose instances. Server push is only an escalation fallback.
 *
 * On web/desktop, local notifications are best-effort (Notification API +
 * setTimeout while the tab lives). On Android they use an exact,
 * Doze-surviving alarm via @capacitor/local-notifications.
 */

import type { AlarmHealth, Device, DoseEvent, Person } from '../db/schema';
import { SNOOZE_PRESETS } from '../engine/dose.engine';

export const CHANNEL_ID = 'dose-reminders';
export const CHANNEL_NAME = 'تذكير الجرعات';
export const CHANNEL_DESCRIPTION = 'تنبيهات مواعيد الجرعات الدوائية';

export type AlarmPermissions = AlarmHealth;

export interface ScheduleRequest {
  dose: DoseEvent;
  personNameAr: string;
  medNameAr: string;
  foodRuleText?: string;
  /** Local time label for the body, e.g. '٠٨:٠٠ ص'. */
  timeLabel: string;
  /** Route to open when the notification is tapped. */
  route: string;
}

export interface ScheduledAlarm {
  /** Capacitor notification id — must be a 32-bit int. */
  id: number;
  doseId: string;
  atUtc: string;
  /** true = the reminder itself, false = the follow-up nudge. */
  isPrimary: boolean;
}

/** Deterministic 32-bit int from a dose id + offset (Capacitor requires int). */
export function alarmId(doseId: string, offset = 0): number {
  let h = 5381;
  for (let i = 0; i < doseId.length; i++) {
    h = ((h << 5) + h + doseId.charCodeAt(i)) | 0;
  }
  return ((h >>> 0) % 2_000_000_000) + offset;
}

/* ------------------------------------------------------------------ */
/* Notification content (§9)                                           */
/* ------------------------------------------------------------------ */

export function buildReminderTitle(medNameAr: string): string {
  return `حان موعد جرعة ${medNameAr}`;
}

export function buildReminderBody(input: {
  medNameAr: string;
  quantity: number;
  strengthValue?: number;
  strengthUnit?: string;
  foodRuleText?: string;
}): string {
  const parts: string[] = [];
  const qty =
    input.strengthValue !== undefined
      ? `${input.quantity} × ${input.strengthValue} ${input.strengthUnit ?? ''}`.trim()
      : `${input.quantity}`;
  parts.push(qty);
  if (input.foodRuleText) parts.push(input.foodRuleText);
  return parts.join(' · ');
}

/** Action button identifiers, kept stable because they cross the native bridge. */
export const NOTIFICATION_ACTIONS = {
  taken: 'TAKEN',
  notYet: 'NOT_YET',
  snooze: 'SNOOZE',
} as const;

/**
 * Neutral missed-dose copy. NEVER suggests doubling a dose (§9).
 */
export const MISSED_DOSE_MESSAGE =
  'لم يتم تسجيل الجرعة. راجع تعليمات الطبيب أو النشرة الدوائية لمعرفة الإجراء المناسب.';

export function buildMissedTitle(medNameAr: string): string {
  return `جرعة لم تُسجَّل: ${medNameAr}`;
}

/** Advisor-safe disclaimer reused by AI output and summaries (§11). */
export const AI_DISCLAIMER =
  'هذا الملخص للمرجعية السريعة فقط ولا يُغني عن مراجعة الطبيب أو قراءة التقرير الأصلي.';

/* ------------------------------------------------------------------ */
/* Permission + health checks (§9, §1.7)                               */
/* ------------------------------------------------------------------ */

export interface NativeAlarmApi {
  checkPermissions(): Promise<{ display: 'granted' | 'denied' | 'prompt' }>;
  requestPermissions(): Promise<{ display: 'granted' | 'denied' | 'prompt' }>;
  /** Android 14+: SCHEDULE_EXACT_ALARM is denied by default. */
  checkExactAlarmPermission?(): Promise<boolean>;
  requestExactAlarmPermission?(): Promise<void>;
  /** Doze exemption. */
  isBatteryOptimizationExempt?(): Promise<boolean>;
  requestBatteryOptimizationExemption?(): Promise<void>;
  schedule(opts: unknown): Promise<void>;
  cancel(opts: { notifications: { id: number }[] }): Promise<void>;
  getDeliveredNotifications?(): Promise<{ notifications: { id: number }[] }>;
  removeAllDeliveredNotifications?(): Promise<void>;
}

/** Lazily resolve the Capacitor plugin, if we're running natively. */
export async function getNativeAlarmApi(): Promise<NativeAlarmApi | null> {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as Record<string, unknown>)['Capacitor'] as
    | { isNativePlatform?: () => boolean; getPlatform?: () => string }
    | undefined;
  if (!cap?.isNativePlatform?.()) return null;
  try {
    const mod = await import(/* @vite-ignore */ '@capacitor/local-notifications');
    return mod.LocalNotifications as unknown as NativeAlarmApi;
  } catch {
    return null;
  }
}

/**
 * Collect alarm health for the watchdog.
 * Any false flag raises a red banner on the caregiver dashboard (§9).
 */
export async function checkAlarmHealth(api: NativeAlarmApi | null): Promise<AlarmHealth> {
  if (!api) {
    // Web/desktop: no exact alarms, but the browser notification API counts.
    const notifGranted =
      typeof Notification !== 'undefined' && Notification.permission === 'granted';
    return {
      exactAlarmGranted: false,
      batteryExempt: true,
      notifGranted,
      lastRescheduleAtUtc: new Date().toISOString(),
    };
  }

  const perms = await api.checkPermissions();
  const exact = api.checkExactAlarmPermission ? await api.checkExactAlarmPermission() : true;
  const battery = api.isBatteryOptimizationExempt ? await api.isBatteryOptimizationExempt() : false;

  return {
    exactAlarmGranted: exact,
    batteryExempt: battery,
    notifGranted: perms.display === 'granted',
    lastRescheduleAtUtc: new Date().toISOString(),
  };
}

export interface AlarmHealthIssue {
  key: 'notifGranted' | 'exactAlarmGranted' | 'batteryExempt' | 'staleReschedule';
  messageAr: string;
  actionAr: string;
}

/**
 * Explain, in plain Arabic, what is wrong and what to do — never a silent
 * fallback to inexact alarms (§9).
 */
export function describeAlarmHealthIssues(
  health: AlarmHealth,
  now: Date = new Date(),
): AlarmHealthIssue[] {
  const issues: AlarmHealthIssue[] = [];

  if (!health.notifGranted) {
    issues.push({
      key: 'notifGranted',
      messageAr: 'إذن الإشعارات غير مُمنوح على هذا الجهاز، فلن تظهر تذكيرات الجرعات.',
      actionAr: 'افتح الإعدادات واسمح بالإشعارات لتطبيق Health Tracker.',
    });
  }

  if (!health.exactAlarmGranted) {
    issues.push({
      key: 'exactAlarmGranted',
      messageAr: 'التنبيهات الدقيقة غير مسموح بها، وقد تتأخر التذكيرات عند نوم الهاتف.',
      actionAr: 'من إعدادات الهاتف: التطبيقات ← Health Tracker ← التنبيهات والتذكيرات ← السماح بالمنبّهات الدقيقة.',
    });
  }

  if (!health.batteryExempt) {
    issues.push({
      key: 'batteryExempt',
      messageAr: 'تحسين البطارية قد يؤجل التذكيرات لأن الهاتف يوقف التطبيق في وضع السكون.',
      actionAr: 'اسمح للتطبيق بالعمل في الخلفية دون قيود من إعدادات البطارية.',
    });
  }

  if (health.lastRescheduleAtUtc) {
    const hours = (now.getTime() - new Date(health.lastRescheduleAtUtc).getTime()) / 3_600_000;
    if (hours > 36) {
      issues.push({
        key: 'staleReschedule',
        messageAr: 'لم يتم تحديث التذكيرات على جهاز الوالدة منذ أكثر من ٣٦ ساعة.',
        actionAr: 'افتح التطبيق على جهازها مرة واحدة ليُعيد جدولة التذكيرات.',
      });
    }
  }

  return issues;
}

/** Is the caregiver's device's health acceptable? Drives the red banner. */
export function hasCriticalAlarmIssue(health: AlarmHealth | undefined): boolean {
  if (!health) return true;
  return !health.notifGranted || !health.exactAlarmGranted;
}

/** Watchdog: should the caregiver receive an FCM alert about a device? */
export function needsCaregiverAlarmAlert(
  deviceBoundToPerson: boolean,
  health: AlarmHealth | undefined,
  now: Date = new Date(),
): boolean {
  if (!deviceBoundToPerson) return false;
  if (!health) return true;
  if (!health.notifGranted || !health.exactAlarmGranted) return true;
  if (!health.lastRescheduleAtUtc) return true;
  const hours = (now.getTime() - new Date(health.lastRescheduleAtUtc).getTime()) / 3_600_000;
  return hours > 36;
}

/* ------------------------------------------------------------------ */
/* Snooze helpers                                                      */
/* ------------------------------------------------------------------ */

export function snoozeOptions(): { labelAr: string; minutes: number }[] {
  return [
    ...SNOOZE_PRESETS.map((m: number) => ({ labelAr: `${m} دقائق`, minutes: m })),
    { labelAr: 'ساعة', minutes: 60 },
  ];
}

/** Reminder offset before the exact dose time, in minutes (0 = exactly on time). */
export const PRIMARY_REMINDER_OFFSET_MIN = 0;
/** Follow-up nudge after the grace window. */
export const FOLLOW_UP_OFFSET_MIN = 30;

export interface PlannedAlarm {
  id: number;
  doseId: string;
  atUtc: string;
  isPrimary: boolean;
}

/**
 * Turn materialised doses into the exact set of alarms to register.
 * Only future alarms are planned; past ones are dropped.
 */
export function planAlarms(
  doses: DoseEvent[],
  now: Date = new Date(),
  options: { includeFollowUp?: boolean; graceMinutes?: number } = {},
): PlannedAlarm[] {
  const nowMs = now.getTime();
  const grace = options.graceMinutes ?? 120;
  const out: PlannedAlarm[] = [];

  for (const dose of doses) {
    if (dose.deleted) continue;
    if (dose.status === 'taken' || dose.status === 'skipped' || dose.status === 'cancelled') continue;

    const atMs = new Date(dose.scheduledAtUtc).getTime();
    if (atMs > nowMs) {
      out.push({
        id: alarmId(dose.id, 0),
        doseId: dose.id,
        atUtc: dose.scheduledAtUtc,
        isPrimary: true,
      });
    }
    if (options.includeFollowUp) {
      const followUpMs = atMs + grace * 60_000 + FOLLOW_UP_OFFSET_MIN * 60_000;
      if (followUpMs > nowMs) {
        out.push({
          id: alarmId(dose.id, 1),
          doseId: dose.id,
          atUtc: new Date(followUpMs).toISOString(),
          isPrimary: false,
        });
      }
    }
  }

  return out.sort((a, b) => a.atUtc.localeCompare(b.atUtc));
}

/** Android events that must trigger a full re-schedule (§9). */
export const RESCHEDULE_TRIGGERS = [
  'BOOT_COMPLETED',
  'TIME_SET',
  'TIMEZONE_CHANGED',
  'APP_FOREGROUND',
  'SCHEDULE_EDIT',
  'NIGHTLY',
] as const;

export type RescheduleTrigger = (typeof RESCHEDULE_TRIGGERS)[number];

/** How far ahead we materialise and schedule alarms. */
export const ALARM_HORIZON_DAYS = 14;

export function boundDoseCount(device: Device | undefined): boolean {
  return !!device?.boundPersonId;
}

/** Interactive prompts go ONLY to the device bound to that person (§9). */
export function shouldShowInteractivePrompt(device: Device | undefined, person: Person): boolean {
  return device?.boundPersonId === person.id;
}

/** Informational notification policy per (device, person) preference. */
export function caregiverNotificationBehaviour(
  mode: 'off' | 'escalationOnly' | 'mirrorAll' | 'digest',
  isEscalation: boolean,
): 'none' | 'info' | 'digest' {
  switch (mode) {
    case 'off':
      return 'none';
    case 'escalationOnly':
      return isEscalation ? 'info' : 'none';
    case 'mirrorAll':
      return 'info';
    case 'digest':
      return 'digest';
    default:
      return 'none';
  }
}
