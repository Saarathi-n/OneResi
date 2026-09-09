import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

const Body = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z.string().min(1, 'Choose a new password'),
});

/** Kills every session, including the changer's own (D-23). */
export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, Body);
  if (!parsed.ok) return parsed.response;
  const { accounts } = await services();
  return toResponse(await accounts.changePassword(who.value, parsed.data));
}
