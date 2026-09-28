# Build & Deploy

## Prerequisites

- Node.js 22+ (managed binary included)
- npm 10+
- Android Studio (for Android builds)
- A Neon Postgres project (free tier is enough)
- A Vercel account (for deployment)

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy environment variables
cp .env.example .env.local
# Edit .env.local with your Neon DATABASE_URL and OpenAI key

# 3. Start Vite dev server
npm run dev
# Open http://localhost:5173
```

## Tests

```bash
# Unit tests (pure engine + time)
npm run test

# Integration tests (Dexie adapter + fake-indexeddb)
npx vitest run tests/integration/

# Type-check
npm run typecheck

# Lint
npm run lint
```

## Production Build

```bash
npm run build
```

Output goes to `dist/`:
- `index.html` — SPA entry
- `assets/` — JS/CSS bundles
- `sw.js` — Service worker (VitePWA)
- `manifest.webmanifest` — PWA manifest

## Deploy to Vercel

```bash
# 1. Link your project
vercel

# 2. Set environment variables in Vercel dashboard
#    DATABASE_URL, OPENAI_API_KEY, BACKUP_SECRET

# 3. Deploy
vercel --prod
```

The API routes in `api/src/` are automatically handled by Vercel's serverless functions.

## Android Build

```bash
# 1. Sync the web build into the Android project
npm run cap:sync

# 2. Open in Android Studio
npm run cap:open

# 3. In Android Studio:
#    - Build → Generate Signed Bundle/APK
#    - Target SDK: 35 (Android 15)
#    - Minimum SDK: 26 (Android 8)
```

## Capacitor Plugins Used

| Plugin | Purpose |
|--------|---------|
| `@capacitor/local-notifications` | Exact alarms |
| `@capacitor-community/sqlite` | Optional native SQLite (future) |
| `@capacitor/haptics` | Touch feedback |
| `@capacitor/splash-screen` | Launch screen |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `DATABASE_URL` not found | Check `.env.local` and Vercel env vars |
| Android alarms not firing | Verify `SCHEDULE_EXACT_ALARM` granted + battery exempt |
| Tests fail with "database blocked" | `singleFork: true` is set in `vitest.config.ts` |
| PWA not installing | Check `manifest.webmanifest` in DevTools → Application |
