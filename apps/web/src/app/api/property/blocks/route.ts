import type { NextRequest } from 'next/server';
import { CreateBlockInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { property } = await services();
  return toResponse(await property.blocks(who.value));
}

export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, CreateBlockInput);
  if (!parsed.ok) return parsed.response;
  const { property } = await services();
  return toResponse(await property.createBlock(who.value, parsed.data));
}
