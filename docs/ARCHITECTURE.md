# Architecture

## Layer Cake

```
┌─────────────────────────────────────────┐
│  UI (React + Tailwind + shadcn/ui)      │  Arabic-first, RTL, large-text mode
│  ├─ modes/caregiver/                    │  Full dashboard
│  └─ modes/mother/                       │  One-tap giant card
├─────────────────────────────────────────┤
│  App (Zustand + TanStack Query)         │  State + server cache
│  ├─ store.ts                            │  All mutations go through here
│  └─ Router (Mother mode bypasses it)    │
├─────────────────────────────────────────┤
│  Features                               │  Onboarding, Today, Medications, …
├─────────────────────────────────────────┤
│  Core                                   │
│  ├─ db/schema.ts          (pure TS)     │  Single source of truth for types
│  ├─ db/repository.ts      (interface)   │  Abstract CRUD + atomic ops
│  ├─ db/dexie.adapter.ts   (IndexedDB)   │  Web implementation
│  ├─ engine/dose.engine.ts (pure TS)     │  Materialisation, reconciliation
│  ├─ engine/inventory.engine.ts          │  Fold balance, project stock
│  ├─ engine/adherence.engine.ts          │  Streaks, grades, Arabic pluralisation
│  ├─ engine/cost.engine.ts               │  Cost reports, refill projections
│  ├─ time/index.ts         (pure TS)     │  DST-safe timezone math
│  ├─ sync/outbox.ts                      │  Offline queue, conflict resolution
│  └─ notify/scheduler.ts                 │  Alarm health, notification content
├─────────────────────────────────────────┤
│  Capacitor (Android) / Tauri (desktop)  │  Native notifications, haptics
├─────────────────────────────────────────┤
│  Neon Postgres  ←──→  Vercel Functions  │  Sync push/pull, AI proxy, backup
└─────────────────────────────────────────┘
```

## Hard Rules

1. **Pure core** — `src/core/engine/**` and `src/core/time/**` must be pure TypeScript. Zero imports of React, Dexie, Capacitor, or Firebase.
2. **Offline-first** — Every mutation lands in IndexedDB first. The outbox replays when online.
3. **Idempotency** — `markDoseTaken` is atomic and double-tap-safe. Inventory is never double-deducted.
4. **DST-safe** — All time math uses IANA timezones. Never hardcode a fixed UTC offset.
5. **Arabic-first** — All user-facing strings are Arabic. English is secondary.
6. **Zero silent failures** — If an alarm cannot be scheduled, the user sees a banner. If sync fails, the outbox retries with backoff.

## Sync Flow

```
Device A (offline)          Neon Postgres           Device B
    │                            │                      │
    │  markDoseTaken()           │                      │
    │  → Dexie (local)           │                      │
    │  → outbox.enqueue()        │                      │
    │                            │                      │
    │  ← online                  │                      │
    │  POST /api/sync/push       │                      │
    │  ─────────────────────────>│                      │
    │                            │  applyMutation()     │
    │                            │  → INSERT/UPDATE     │
    │                            │                      │
    │  200 OK (conflicts: [])    │                      │
    │  <─────────────────────────│                      │
    │  outbox.clear()            │                      │
    │                            │                      │
    │                            │  ← online            │
    │                            │  POST /api/sync/pull │
    │                            │  <───────────────────│
    │                            │  → return changes    │
    │                            │  ───────────────────>│
    │                            │                      │  → Dexie.put()
```

## Notification Stack (Android 15/16)

- **Exact alarms** — `SCHEDULE_EXACT_ALARM` permission requested at onboarding. If denied, fall back to inexact alarms with a warning banner.
- **Battery exemption** — Prompted during onboarding. Required for reliable alarms.
- **FCM** — Used only for caregiver escalation (missed critical dose). Never for primary reminders.
- **Local notifications** — Primary reminder channel. Fires from the device, works offline.

## Build Targets

| Target | Command | Output |
|--------|---------|--------|
| Web dev | `npm run dev` | Vite dev server |
| Web prod | `npm run build` | `dist/` (PWA) |
| Android | `npm run cap:sync && npm run cap:open` | Android Studio project |
| Desktop | `npm run tauri:dev` | Tauri dev window |
| Tests | `npm run test` | Vitest (unit + integration) |
| Type-check | `npm run typecheck` | `tsc --noEmit` |
