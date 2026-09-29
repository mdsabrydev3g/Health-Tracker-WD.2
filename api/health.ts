/**
 * GET /api/health
 *
 * Simple liveness + DB connectivity check.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { dbHealth } from './lib/db';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const now = await dbHealth();
    return res.status(200).json({ ok: true, db: now });
  } catch (e) {
    return res.status(503).json({ ok: false, error: String(e) });
  }
}
