import type { NextRequest } from 'next/server';
import { RaiseInvoicesInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { billing } = await services();
  return toResponse(await billing.forHousehold(who.value));
}

/** One transaction. Refuses outright if the period already exists (D-17). */
export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, RaiseInvoicesInput);
  if (!parsed.ok) return parsed.response;
  const { billing } = await services();
  return toResponse(await billing.raiseForPeriod(who.value, parsed.data));
}
