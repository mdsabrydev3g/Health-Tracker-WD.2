# Deploy Log

## Live Deployment

**URL:** https://health-tracker-1790596730-ov5bz8u4b-mdsabrydev3g.vercel.app
**Aliases:**
- https://health-tracker-1790596730.vercel.app
- https://health-tracker-1790596730-mdsabrydev3g.vercel.app

**Build status:** Ready (51s build, 29s post-build)
**Region:** Washington D.C. (iad1)
**Project:** mdsabrydev3g/health-tracker-1790596730

### Build Artifacts

| Function | Size |
|----------|------|
| api/lib/db | 105 KB |
| api/lib/sync | 4.6 KB |
| api/src/ai-scan | 5.7 KB |
| api/src/ai-summarise | 5.2 KB |
| api/src/backup | 108 KB |
| SPA bundle | ~635 KB (195 KB gzipped) |
| Service worker | generated |

### Access

The deployment is **live and reachable** (HTTP 200 on `/` and `/api/health`), but the Vercel team has **Bot Management / Authentication Wall** enabled on the team account. This is a Vercel account-level safeguard (not a project config) that serves a "Log in to Vercel" page to non-authenticated traffic as protection.

To view the site:

1. **Sign in to Vercel** at the verification page (any team member can authenticate).
2. The site will then serve normally.
3. For public access, the team owner needs to disable Bot Management under **Team Settings → Security**.

### API Endpoints (when accessible)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sync/push` | Sync mutations from device → Neon |
| POST | `/api/sync/pull` | Pull changes from Neon → device |
| POST | `/api/ai/summarise` | Server-side AI for lab summaries |
| POST | `/api/ai/scan` | Server-side AI for medication photos |
| POST | `/api/backup` | Nightly cron backup (Auth: x-backup-secret) |
| GET | `/api/health` | Liveness check |

### Environment Variables (Required)

Set in Vercel project settings:

```
DATABASE_URL        = postgresql://...neon.tech/health_tracker?sslmode=require
OPENAI_API_KEY      = sk-...
BACKUP_SECRET       = <long random string>
```

### Cron Schedule

`/api/backup` is triggered nightly at 02:00 UTC via `vercel.json` cron.