/**
 * GET /api/health
 *
 * Liveness + DB connectivity check.
 *
 * The database module throws at import time when DATABASE_URL is missing, and
 * that import is static — so this handler used to die before it could answer,
 * turning a configuration gap into an opaque FUNCTION_INVOCATION_FAILED 500.
 * Importing lazily and reporting the reason keeps the endpoint honest: a client
 * (including the APK) can tell "not configured yet" apart from "server broken".
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleCors } from './lib/cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  if (!process.env.DATABASE_URL) {
    return res.status(200).json({
      ok: false,
      reason: 'DATABASE_URL is not set on this deployment',
      // The function itself is alive — only the database is unconfigured.
      reachable: true,
    });
  }

  try {
    const { dbHealth } = await import('./lib/db');
    const now = await dbHealth();
    return res.status(200).json({ ok: true, db: now });
  } catch (e) {
    return res.status(503).json({ ok: false, error: String(e) });
  }
}
