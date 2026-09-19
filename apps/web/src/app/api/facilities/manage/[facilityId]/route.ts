import type { NextRequest } from 'next/server';
import { UpdateFacilityInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

/** An edit or a retirement. `active: false` retires; bookings in flight keep their records. */
export async function PATCH(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, UpdateFacilityInput);
  if (!parsed.ok) return parsed.response;
  const { facilities } = await services();
  return toResponse(await facilities.update(who.value, parsed.data));
}
