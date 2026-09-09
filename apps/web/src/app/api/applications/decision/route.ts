import type { NextRequest } from 'next/server';
import { DecideRegistrationInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, meta, parseBody, toResponse } from '@/server/http';

/** Approving resolves a unit claim; declining must not leave the unit occupied (D-42). */
export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, DecideRegistrationInput);
  if (!parsed.ok) return parsed.response;
  const { accounts } = await services();
  return toResponse(await accounts.decideRegistration(who.value, parsed.data, meta(request)));
}
