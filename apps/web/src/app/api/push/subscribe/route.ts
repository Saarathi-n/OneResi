import type { NextRequest } from 'next/server';
import { PushSubscribeInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

/**
 * Stores or refreshes the caller's own push subscription. Any authenticated actor may subscribe —
 * a committee member's phone wants its visitor-arrival pings exactly like a resident's — and the
 * service scopes the row to the caller, so the endpoint is the browser's, not a claim on anybody
 * else's. `expirationTime` is accepted (the browser sends it) and deliberately not stored; the
 * push service announces the real expiry with a 410.
 */
export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, PushSubscribeInput);
  if (!parsed.ok) return parsed.response;
  const { notifications } = await services();
  return toResponse(await notifications.subscribe(who.value, parsed.data));
}
