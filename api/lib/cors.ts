/**
 * Shared CORS handling for the API routes.
 *
 * The web app calls these endpoints same-origin, but the Capacitor/APK build
 * runs in a webview whose origin (e.g. capacitor://localhost) is different from
 * the Vercel domain. A POST with Content-Type: application/json triggers a
 * CORS preflight (OPTIONS), so every handler must (a) echo the right headers
 * and (b) answer OPTIONS with 204. Without this, the Android app's sync is
 * blocked by the browser even though the server is healthy.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

function allowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS ?? '*';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(req: VercelRequest): Record<string, string> {
  const origins = allowedOrigins();
  const origin = req.headers.origin;
  // Default to '*'. If a specific allow-list is configured, reflect the
  // requesting origin only when it is on the list (otherwise fall back to '*').
  let allowOrigin = '*';
  if (origin && origins[0] !== '*' && origins.includes(origin)) {
    allowOrigin = origin;
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-backup-secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/**
 * Apply CORS headers and short-circuit OPTIONS preflight requests.
 * Returns true when the response has already been sent (caller must return).
 */
export function handleCors(req: VercelRequest, res: VercelResponse): boolean {
  const headers = corsHeaders(req);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
