# Notifications — Android 15/16 Alarm Rules

## The Problem

Android 15 (API 35) and 16 restrict exact alarms heavily:
- `SCHEDULE_EXACT_ALARM` is no longer granted automatically.
- The user must explicitly allow it in Settings → Apps → Special app access.
- If denied, `setExactAlarm()` throws `SecurityException`.

## Our Strategy

1. **Request at onboarding** — Step 3 of the onboarding wizard asks for exact-alarm permission.
2. **Check before every schedule** — `planAlarms()` verifies `exactAlarmGranted` via `checkAlarmHealth()`.
3. **Fallback** — If exact alarms are denied, use `setInexactRepeating()` with a warning banner: "قد لا تصل التنبيهات في الوقت المحدد بالضبط."
4. **Battery exemption** — Also requested at onboarding. Without it, Doze mode delays alarms.
5. **FCM escalation only** — Firebase Cloud Messaging is used ONLY for caregiver alerts (missed critical dose). Primary reminders are always local alarms.

## Alarm Health Checklist

`checkAlarmHealth()` returns a bitmask:
- `exactAlarmGranted`
- `batteryExempt`
- `notifGranted`

If any are false, `hasCriticalAlarmIssue()` returns true and the UI shows a red banner.

## Notification Channels

| Channel | ID | Usage |
|---------|-----|-------|
| Dose reminders | `dose-reminders` | Primary alarm for every scheduled dose |
| Missed dose | `missed-dose` | Fired when grace period expires |
| Caregiver alert | `caregiver-alert` | FCM push for missed critical dose |
| Stock low | `stock-low` | When projected stock < threshold |

## Testing Alarms

1. Set a medication with a time 2 minutes from now.
2. Background the app.
3. Wait. The notification must fire within ±30 seconds.
4. If it doesn't, check `AlarmHealth` in Settings → Diagnostics.

## Known Vendor Issues

- **Samsung** — "Optimize battery usage" must be set to "Not optimized" for the app.
- **Xiaomi** — Autostart permission may be required.
- **Huawei** — App launch management must allow "manual management".

The onboarding wizard includes vendor-specific instructions when `detectPlatformLabel()` identifies the manufacturer.
