import type { NextRequest } from 'next/server';
import { services } from '@/server/runtime';
import { actor, toResponse } from '@/server/http';

/**
 * One route, two scopes: a resident reads their household's queue, the gate reads the whole
 * society's. The kiosk feed and the resident list ask the same question at different widths, so
 * they share the endpoint — and the service, not the route, is what refuses a role that reads
 * neither.
 */
export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { visitors } = await services();
  return toResponse(
    who.value.role === 'S'
      ? await visitors.waitingForSociety(who.value)
      : await visitors.waitingForHousehold(who.value),
  );
}
