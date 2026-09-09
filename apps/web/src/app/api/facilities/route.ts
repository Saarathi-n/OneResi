import type { NextRequest } from 'next/server';
import { services } from '@/server/runtime';
import { actor, toResponse } from '@/server/http';

/** The bookable list. The committee sees retired facilities too (UC-22, D-27). */
export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { facilities } = await services();
  return toResponse(await facilities.list(who.value));
}
