import type { NextRequest } from 'next/server';
import { UpdateFacilityInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, invalidInput, parseBody, toResponse } from '@/server/http';

/** An edit or a retirement. `active: false` retires; bookings in flight keep their records. */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ facilityId: string }> },
) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);

  const parsed = await parseBody(request, UpdateFacilityInput);
  if (!parsed.ok) return parsed.response;

  // The body names the facility and the path must agree with it, so a copied URL can never record
  // against a different facility than the form says it is updating.
  const { facilityId } = await context.params;
  if (facilityId !== String(parsed.data.facilityId)) return invalidInput(['facilityId']);

  const { facilities } = await services();
  return toResponse(await facilities.update(who.value, parsed.data));
}
