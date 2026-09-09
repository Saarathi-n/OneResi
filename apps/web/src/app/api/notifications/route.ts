import type { NextRequest } from 'next/server';
import { services } from '@/server/runtime';
import { actor, toResponse } from '@/server/http';

export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { notifications } = await services();
  return toResponse(await notifications.unread(who.value));
}
