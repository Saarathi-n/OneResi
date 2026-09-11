import type { NextRequest } from 'next/server';
import { PushUnsubscribeInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

/**
 * Retires the caller's own subscription. Scoped to the caller in the service: a foreign endpoint
 * retires nothing, and an unknown endpoint is a no-op rather than an error, because the browser
 * may have already dropped the subscription by the time the person toggles it off.
 */
export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, PushUnsubscribeInput);
  if (!parsed.ok) return parsed.response;
  const { notifications } = await services();
  return toResponse(await notifications.unsubscribe(who.value, parsed.data));
}
