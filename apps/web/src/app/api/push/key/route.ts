import { NextResponse } from 'next/server';
import { pushPublicKey } from '@grihaone/mail';

/**
 * The browser's first step towards subscribing: the application server's public VAPID key.
 *
 * Public by design — the key is what a browser encrypts TO, not a secret — and unauthenticated,
 * because the subscribe prompt this enables has to exist before a person has any reason to be
 * asked for permission. When push is not configured (the console driver, or half-set VAPID
 * variables) the answer is an honest `configured: false` so the client hides the enable-push
 * control instead of showing a button that can never work (D-30's argument, one layer out).
 *
 * The PWA is a different origin in development, so the response is readable cross-origin: a bare
 * fetch with no credentials sends no preflight, and `*` is safe for a value that is public. The
 * key route is the only push route this applies to — subscribe and unsubscribe are
 * authenticated, and a browser sends those same-origin through the app.
 */
export function GET() {
  const publicKey = pushPublicKey();
  return NextResponse.json(
    publicKey === null ? { configured: false } : { configured: true, publicKey },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
