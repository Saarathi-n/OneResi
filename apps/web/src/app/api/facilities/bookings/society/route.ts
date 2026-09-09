import type { NextRequest } from 'next/server';
import { services } from '@/server/runtime';
import { actor, toResponse } from '@/server/http';

/** The committee's decision queue: every booking in the society, with the home that asked. */
export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { facilities } = await services();
  return toResponse(await facilities.bookingsForSociety(who.value));
}
