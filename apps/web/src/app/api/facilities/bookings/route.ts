import type { NextRequest } from 'next/server';
import { RequestBookingInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { facilities } = await services();
  return toResponse(await facilities.forHousehold(who.value));
}

export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, RequestBookingInput);
  if (!parsed.ok) return parsed.response;
  const { facilities } = await services();
  return toResponse(await facilities.request(who.value, parsed.data));
}
