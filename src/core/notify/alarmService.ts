/**
 * Alarm scheduling service — turns the policy + planned alarms into real,
 * device-level notifications.
 *
 * This is the critical-path gap that was missing: `planAlarms()` existed but
 * nothing ever consumed it. Here we schedule:
 *   1. Per-dose reminders (mode-aware: alarm for Mother, info for Owner).
 *   2. Low-stock critical alerts (alarm only for important meds in Owner mode).
 *
 * Native (Android): exact, Doze-surviving alarms via @capacitor/local-notifications.
 * Web / Desktop: best-effort Notification API + setTimeout while the tab lives.
 *
 * PURE of React. Talks to the native bridge only through `getNativeAlarmApi`.
 */

import type { DoseEvent, Medication } from '../db/schema';
import type { StockProjection } from '../engine/inventory.engine';
import {
  CHANNEL_ID,
  buildReminderBody,
  buildReminderTitle,
  getNativeAlarmApi,
  planAlarms,
} from './scheduler';
import { notificationPolicyFor, shouldAlarmLowStock, type AppMode } from './policy';

/** Module-level state so we never re-spam the same low-stock alert. */
let alertedLowStock = new Set<string>();
let webTimers: ReturnType<typeof setTimeout>[] = [];
/** Every native notification id we have scheduled — used to cancel on mode switch. */
let scheduledNativeIds: number[] = [];

export interface AlarmContext {
  doses: DoseEvent[];
  medications: Medication[];
  projections: Map<string, StockProjection>;
  mode: AppMode;
  getMed: (id: string) => Medication | undefined;
}

/** Deterministic notification id for a medicine's low-stock alert. */
function lowStockAlarmId(medId: string): number {
  let h = 99173;
  for (let i = 0; i < medId.length; i++) h = ((h << 5) + h + medId.charCodeAt(i)) | 0;
  return (h >>> 0) % 2_000_000_000;
}

function clearWebTimers(): void {
  for (const t of webTimers) clearTimeout(t);
  webTimers = [];
}

/**
 * Recompute and (re)schedule every alarm for the current state.
 * Idempotent for dose reminders (deterministic ids). Low-stock alerts fire
 * once per newly-low medicine.
 */
export async function rescheduleAlarms(ctx: AlarmContext): Promise<void> {
  const policy = notificationPolicyFor(ctx.mode);
  const api = await getNativeAlarmApi();
  const now = new Date();

  // --- 1. Per-dose reminders ---------------------------------------------
  const planned = planAlarms(ctx.doses, now, {
    includeFollowUp: true,
    graceMinutes: 120,
  });

  clearWebTimers();

  const doseNotifications = planned.map((a) => {
    const dose = ctx.doses.find((d) => d.id === a.doseId);
    const med = dose ? ctx.getMed(dose.medId) : undefined;
    const title = buildReminderTitle(med?.nameAr ?? 'دواء');
    const body = buildReminderBody({
      medNameAr: med?.nameAr ?? 'دواء',
      quantity: dose?.quantity ?? 1,
    });
    return {
      id: a.id,
      title,
      body,
      schedule: { at: new Date(a.atUtc) },
      channelId: CHANNEL_ID,
      extra: { doseId: a.doseId, route: '/today', followUp: a.isPrimary ? '0' : '1' },
    };
  });

  if (api) {
    // Android: schedule exactly. Info vs alarm is soft (same channel) but the
    // policy still governs WHETHER we schedule routine reminders at all.
    if (policy.doseReminder !== 'none' && doseNotifications.length > 0) {
      try {
        await (api as unknown as {
          schedule: (o: { notifications: unknown[] }) => Promise<void>;
        }).schedule({ notifications: doseNotifications });
        scheduledNativeIds.push(...doseNotifications.map((n) => n.id));
      } catch {
        /* a denied permission / unsupported platform must never crash the app */
      }
    }
  } else if (policy.doseReminder !== 'none' && typeof Notification !== 'undefined') {
    // Web / Desktop fallback.
    for (const n of doseNotifications) {
      const at = n.schedule.at.getTime();
      const delay = at - now.getTime();
      if (delay <= 0) continue;
      const silent = policy.doseReminder === 'info';
      const timer = setTimeout(
        () => {
          if (Notification.permission === 'granted') {
            new Notification(n.title, { body: n.body, silent });
          }
        },
        Math.min(delay, 2_147_483_647),
      );
      webTimers.push(timer);
    }
  }

  // --- 2. Low-stock critical alerts --------------------------------------
  const lowNow = new Set<string>();
  for (const med of ctx.medications) {
    const proj = ctx.projections.get(med.id);
    if (!proj || !proj.isLow) continue;
    lowNow.add(med.id);

    const escalate = shouldAlarmLowStock(policy, med);
    if (!escalate) {
      // Owner mode, non-important med: quiet info only — but don't alarm-spam.
      continue;
    }
    if (alertedLowStock.has(med.id)) continue; // already alerted this low episode

    alertedLowStock.add(med.id);
    const remaining =
      proj.remainingDays === Number.POSITIVE_INFINITY
        ? '—'
        : String(Math.floor(proj.remainingDays));
    const title = `تنبيه هام: اقتراب نفاذ ${med.nameAr}`;
    const body = `يكفي ${remaining} يوم فقط. يُرجى تجهيز عبوة جديدة.`;
    const fireAt = new Date(now.getTime() + 2000);

    if (api) {
      try {
        await (api as unknown as {
          schedule: (o: { notifications: unknown[] }) => Promise<void>;
        }).schedule({
          notifications: [
            {
              id: lowStockAlarmId(med.id),
              title,
              body,
              schedule: { at: fireAt },
              channelId: CHANNEL_ID,
              extra: { kind: 'lowStock', medId: med.id },
            },
          ],
        });
        scheduledNativeIds.push(lowStockAlarmId(med.id));
      } catch {
        /* best effort */
      }
    } else if (typeof Notification !== 'undefined') {
      const timer = setTimeout(() => {
        if (Notification.permission === 'granted') {
          new Notification(title, { body, silent: false });
        }
      }, 2500);
      webTimers.push(timer);
    }
  }

  // Forgive medicines that are no longer low so a future low episode re-alerts.
  for (const id of [...alertedLowStock]) {
    if (!lowNow.has(id)) alertedLowStock.delete(id);
  }
}

/** Wipe the in-memory low-stock alert memory (used on logout / person switch). */
export function resetAlarmState(): void {
  alertedLowStock = new Set();
  clearWebTimers();
}

/**
 * Cancel every alarm we have scheduled (native + web) and reset memory.
 * Called when the notification mode changes so the old policy's alarms don't
 * linger (e.g. switching from Mother → Owner must stop routine dose alarms).
 */
export async function cancelAllAlarms(): Promise<void> {
  const api = await getNativeAlarmApi();
  if (api && scheduledNativeIds.length > 0) {
    try {
      await (api as unknown as {
        cancel: (o: { notifications: { id: number }[] }) => Promise<void>;
      }).cancel({ notifications: scheduledNativeIds.map((id) => ({ id })) });
    } catch {
      /* best effort */
    }
  }
  scheduledNativeIds = [];
  alertedLowStock = new Set();
  clearWebTimers();
}
