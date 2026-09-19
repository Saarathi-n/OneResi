import type { NextRequest } from 'next/server';
import { DecideWalkInInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

/** The walk-in is addressed by path; the decision body carries the log id the service expects. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, DecideWalkInInput);
  if (!parsed.ok) return parsed.response;
  const { id } = await context.params;
  const logId = Number(id);
  if (!Number.isInteger(logId) || logId <= 0 || logId !== parsed.data.logId) {
    return toResponse({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'Check the form and try again.', field: 'id' },
    });
  }
  const { visitors } = await services();
  return toResponse(await visitors.decideWalkIn(who.value, parsed.data));
}
