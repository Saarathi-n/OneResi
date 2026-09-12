import type { NextRequest } from 'next/server';
import { PublishAnnouncementInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { notices } = await services();
  return toResponse(await notices.feed(who.value));
}

export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, PublishAnnouncementInput);
  if (!parsed.ok) return parsed.response;
  const { notices } = await services();
  return toResponse(await notices.publish(who.value, parsed.data));
}
