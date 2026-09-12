import type { NextRequest } from 'next/server';
import { services } from '@/server/runtime';
import { actor, toResponse } from '@/server/http';

/** The committee's five figures, with the previous period beside each (UC-26). */
export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { reports } = await services();
  return toResponse(await reports.dashboard(who.value));
}
