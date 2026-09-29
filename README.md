# Health Tracker

**A personal family app for medication reminders, inventory tracking, and health monitoring.**

Built for one elderly mother (cardiac patient, ~9 medications, Arabic-speaking, Android 15/16) and her caregiver child. This is **not a medical device** — it is a reminder and logbook.

## What It Does

- **Medication reminders** — Exact alarms for every scheduled dose. Works offline.
- **Inventory tracking** — Append-only event log. Knows when stock runs out before it happens.
- **Mother Mode** — Giant single-tap card. No navigation, no small text.
- **Caregiver Mode** — Full dashboard: today, medications, inventory, reports, calendar.
- **AI lab summarisation** — Upload a lab report photo, get a plain-Arabic summary (server-side, no client keys).
- **Sync** — Offline-first with Neon Postgres sync when online.
- **Backup** — JSON export/import + nightly cloud backup.

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **State:** Zustand (client) + TanStack Query (server cache)
- **Storage:** IndexedDB (Dexie) locally, Neon Postgres in the cloud
- **Mobile:** Capacitor 6 (Android, targetSdk 35)
- **Desktop:** Tauri 2.x (optional)
- **AI:** OpenAI GPT-4o (server-side proxy)
- **Deploy:** Vercel (static + serverless functions)

## Quick Start

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your Neon DATABASE_URL
npm run dev
```

## Tests

```bash
npm run test        # 110 tests (unit + integration + render)
npm run typecheck   # strict TypeScript
npm run build       # production bundle
npm run test:e2e    # Playwright — needs a real browser (see docs/BUILD.md)
```

## Project Structure

```
src/
  core/           # Pure TypeScript — engine, time, schema, sync
  ui/             # Reusable components (shadcn/ui primitives)
  app/            # Router, store, error boundary
  features/       # Onboarding, Today, Medications, Inventory, …
  modes/          # MotherShell, CaregiverShell
  i18n/           # Arabic strings
api/
  src/            # Vercel serverless functions (sync, AI, backup)
  lib/            # DB connection, sync helpers
docs/
  ARCHITECTURE.md
  DATA-MODEL.md
  NOTIFICATIONS.md
  SECURITY.md
  BUILD.md
tests/
  unit/           # 94 tests — dose, inventory, adherence, time
  integration/    # 12 tests — Dexie adapter, idempotency
  render/         # 4 tests — mounts the real <App/> in jsdom
  e2e/            # Playwright — real browser, real clicking
```

## License

MIT — Personal use only. Not for medical diagnosis.
