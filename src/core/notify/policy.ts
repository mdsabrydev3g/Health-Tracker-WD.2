/**
 * Notification policy — the single rule that decides WHO gets alarmed.
 *
 * §9, as clarified by the family:
 *  - Mother Mode  (وضع الوالدة)  → full alarms + all reminders, for her account.
 *  - Owner/Son Mode (وضع الابن/المالك) → informational notifications only;
 *    a real alarm (المنبّه) fires ONLY when a "very important" medicine is
 *    near depletion.
 *
 * This module is PURE (no Capacitor / React). The alarm service turns the
 * policy into actual scheduled notifications.
 */

import type { AppSettings } from '../db/schema';

export type AppMode = AppSettings['activeMode'];

export type ReminderDelivery = 'alarm' | 'info' | 'none';

export interface NotificationPolicy {
  /** How routine per-dose reminders are delivered. */
  doseReminder: ReminderDelivery;
  /**
   * When true, low-stock critical alerts only escalate to an ALARM for
   * medicines flagged `isImportant`. Other low-stock meds still get a quiet
   * info notification. When false, every low-stock medicine alarms.
   */
  lowStockAlarmImportantOnly: boolean;
}

export function notificationPolicyFor(mode: AppMode): NotificationPolicy {
  if (mode === 'mother') {
    return { doseReminder: 'alarm', lowStockAlarmImportantOnly: false };
  }
  // Owner / Son mode: notifications only, alarm reserved for important meds.
  return { doseReminder: 'info', lowStockAlarmImportantOnly: true };
}

/** Whether a low-stock alert for this medicine should escalate to a real alarm. */
export function shouldAlarmLowStock(
  policy: NotificationPolicy,
  med: { isImportant?: boolean },
): boolean {
  if (!policy.lowStockAlarmImportantOnly) return true;
  return !!med.isImportant;
}
