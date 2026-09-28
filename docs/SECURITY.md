# Security

## Threat Model

This is a **family app**, not a medical device. The primary threats are:
1. **Data loss** — Phone broken, app uninstalled, mother forgets PIN.
2. **Unauthorized access** — Child or stranger opens the app.
3. **Sync corruption** — Two devices write conflicting data.

## Mitigations

### Local Data
- IndexedDB is sandboxed to the app's origin. No other website can read it.
- The caregiver PIN is hashed with SHA-256 + a per-device salt (stored in `localStorage`).
- Mother Mode has no PIN — it's a single-tap interface with a long-press heart to exit.

### Sync
- All mutations are rev-based. The server rejects stale writes.
- Clinical fields (dose, schedule, strength) trigger caregiver confirmation on conflict.
- The outbox retries with exponential backoff. Failed items are surfaced, not silently dropped.

### AI
- **API keys are server-side only** (§11). The client never sees `OPENAI_API_KEY`.
- AI responses include a mandatory disclaimer: "هذا التلخيص مُنشأ بواسطة ذكاء اصطناعي وليس تشخيصًا طبيًا."
- No PII is sent to AI providers. Lab text is anonymised before summarisation.

### Backup
- JSON export is encrypted at rest if the device supports it.
- The export file includes a schema version so future versions can migrate it.
- Cloud backup runs nightly via Vercel Cron. The endpoint requires `x-backup-secret`.

## What We Don't Do
- No end-to-end encryption (threat model: family, not nation-state).
- No biometric auth (target device may not have a fingerprint sensor).
- No certificate pinning (not a banking app).

## Compliance Notes
- Not a medical device (EU MDR / FDA).
- Not HIPAA-covered (no healthcare provider relationship).
- GDPR: all data is stored with explicit family consent. Export and delete are one-tap operations.
