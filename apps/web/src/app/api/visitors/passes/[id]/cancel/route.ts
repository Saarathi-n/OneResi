import type { NextRequest } from 'next/server';
import { services } from '@/server/runtime';
import { actor, toResponse } from '@/server/http';

/** The id in the path addresses the pass; the service owns the guarded ACTIVE -> CANCELLED. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { id } = await context.params;
  const passId = Number(id);
  if (!Number.isInteger(passId) || passId <= 0) {
    return toResponse({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'Check the form and try again.', field: 'id' },
    });
  }
  const { visitors } = await services();
  return toResponse(await visitors.cancelPass(who.value, passId));
}
