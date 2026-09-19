import type { NextRequest } from 'next/server';
import { ReopenComplaintInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

/** Resident, within the window, measured from resolvedAt. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, ReopenComplaintInput);
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
  return toResponse(await complaints.reopen(who.value, parsed.data));
}
