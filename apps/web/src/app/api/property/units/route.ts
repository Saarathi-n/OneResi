import type { NextRequest } from 'next/server';
import { CreateUnitInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, CreateUnitInput);
  if (!parsed.ok) return parsed.response;
  const { property } = await services();
  return toResponse(await property.createUnit(who.value, parsed.data));
}
