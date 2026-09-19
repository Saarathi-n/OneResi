import type { NextRequest } from 'next/server';
import { CreatePassInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { visitors } = await services();
  return toResponse(await visitors.passesForHousehold(who.value));
}

export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, CreatePassInput);
  if (!parsed.ok) return parsed.response;
  const { visitors } = await services();
  return toResponse(await visitors.issuePass(who.value, parsed.data));
}
