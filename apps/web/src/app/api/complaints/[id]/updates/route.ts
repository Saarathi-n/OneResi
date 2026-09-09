import type { NextRequest } from 'next/server';
import { UpdateComplaintInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

/** Committee. A permitted transition only, and resolvedAt survives every later update (D-20). */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, UpdateComplaintInput);
  if (!parsed.ok) return parsed.response;
  const { id } = await context.params;
  const complaintId = Number(id);
  if (!Number.isInteger(complaintId) || complaintId <= 0 || complaintId !== parsed.data.complaintId) {
    return toResponse({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'Check the form and try again.', field: 'id' },
    });
  }
  const { complaints } = await services();
  return toResponse(await complaints.update(who.value, parsed.data));
}
