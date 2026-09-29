import { describe, expect, it } from 'vitest';
import {
  notificationPolicyFor,
  shouldAlarmLowStock,
  type NotificationPolicy,
} from '@/core/notify/policy';

describe('notificationPolicyFor', () => {
  it('gives Mother Mode full alarms and all low-stock alerts', () => {
    const policy = notificationPolicyFor('mother');
    expect(policy.doseReminder).toBe('alarm');
    expect(policy.lowStockAlarmImportantOnly).toBe(false);
  });

  it('gives Owner/Son Mode info-only reminders, alarm reserved for important meds', () => {
    const policy = notificationPolicyFor('caregiver');
    expect(policy.doseReminder).toBe('info');
    expect(policy.lowStockAlarmImportantOnly).toBe(true);
  });
});

describe('shouldAlarmLowStock', () => {
  const motherPolicy: NotificationPolicy = { doseReminder: 'alarm', lowStockAlarmImportantOnly: false };
  const ownerPolicy: NotificationPolicy = { doseReminder: 'info', lowStockAlarmImportantOnly: true };

  it('alarms every low-stock medicine in Mother Mode', () => {
    expect(shouldAlarmLowStock(motherPolicy, { isImportant: false })).toBe(true);
    expect(shouldAlarmLowStock(motherPolicy, { isImportant: true })).toBe(true);
  });

  it('alarms important low-stock medicines in Owner/Son Mode', () => {
    expect(shouldAlarmLowStock(ownerPolicy, { isImportant: true })).toBe(true);
  });

  it('keeps a quiet info alert (no alarm) for non-important low-stock in Owner/Son Mode', () => {
    expect(shouldAlarmLowStock(ownerPolicy, { isImportant: false })).toBe(false);
    expect(shouldAlarmLowStock(ownerPolicy, {})).toBe(false);
  });
});
