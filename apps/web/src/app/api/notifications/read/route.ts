import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

const Body = z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) });

export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, Body);
  if (!parsed.ok) return parsed.response;
  const { notifications } = await services();
  return toResponse(await notifications.markRead(who.value, parsed.data.ids));
}
