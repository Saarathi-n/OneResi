import type { NextRequest } from 'next/server';
import { RaiseComplaintInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { complaints } = await services();
  return toResponse(await complaints.forHousehold(who.value));
}

export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, RaiseComplaintInput);
  if (!parsed.ok) return parsed.response;
  const { complaints } = await services();
  return toResponse(await complaints.raise(who.value, parsed.data));
}
