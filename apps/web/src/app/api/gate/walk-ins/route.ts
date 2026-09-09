import type { NextRequest } from 'next/server';
import { LogWalkInInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

/** A guard logging a visitor with no pass. The household answers, unless the guard overrides (D-21). */
export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, LogWalkInInput);
  if (!parsed.ok) return parsed.response;
  const { visitors } = await services();
  return toResponse(await visitors.logWalkIn(who.value, parsed.data));
}
