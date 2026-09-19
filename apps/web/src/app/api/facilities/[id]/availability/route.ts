import { NextResponse, type NextRequest } from 'next/server';
import { CalendarDate } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, toResponse } from '@/server/http';

/** Slots already held are returned disabled with a reason, not rejected on submit (D-72). */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { id } = await context.params;
  const facilityId = Number(id);
  if (!Number.isInteger(facilityId) || facilityId <= 0) {
    return toResponse({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'Check the form and try again.', field: 'id' },
    });
  }
  const on = request.nextUrl.searchParams.get('on');
  const parsedOn = CalendarDate.safeParse(on);
  if (!parsedOn.success) {
    return NextResponse.json(
      { code: 'INVALID_INPUT', message: 'Check the form and try again.', fields: ['on'] },
      { status: 400 },
    );
  }
  const { facilities } = await services();
  return toResponse(await facilities.availability(who.value, { facilityId, on: parsedOn.data }));
}
