import type { NextRequest } from 'next/server';
import { CreateFacilityInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

/** The committee's amenity list for management, retired ones included (UC-22). */
export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { facilities } = await services();
  return toResponse(await facilities.listAll(who.value));
}

/** A new amenity. The name is the natural key — a taken name is a CONFLICT. */
export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, CreateFacilityInput);
  if (!parsed.ok) return parsed.response;
  const { facilities } = await services();
  return toResponse(await facilities.create(who.value, parsed.data));
}
