import type { NextRequest } from 'next/server';
import { UpdateUnitInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, UpdateUnitInput);
  if (!parsed.ok) return parsed.response;
  const { id } = await context.params;
  const unitId = Number(id);
  if (!Number.isInteger(unitId) || unitId <= 0 || unitId !== parsed.data.unitId) {
    return toResponse({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'Check the form and try again.', field: 'id' },
    });
  }
  const { property } = await services();
  return toResponse(await property.updateUnit(who.value, parsed.data));
}
