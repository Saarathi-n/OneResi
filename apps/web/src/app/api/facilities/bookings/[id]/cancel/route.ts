import type { NextRequest } from 'next/server';
import { CancelBookingInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, CancelBookingInput);
  if (!parsed.ok) return parsed.response;
  const { id } = await context.params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId) || bookingId <= 0 || bookingId !== parsed.data.bookingId) {
    return toResponse({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'Check the form and try again.', field: 'id' },
    });
  }
  const { facilities } = await services();
  return toResponse(await facilities.cancel(who.value, parsed.data));
}
