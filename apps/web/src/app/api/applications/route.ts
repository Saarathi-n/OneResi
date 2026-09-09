import type { NextRequest } from 'next/server';
import { services } from '@/server/runtime';
import { actor, toResponse } from '@/server/http';

/** The committee's queue, oldest first. Role checks live in the service, not here. */
export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { accounts } = await services();
  return toResponse(await accounts.pendingApplications(who.value));
}
