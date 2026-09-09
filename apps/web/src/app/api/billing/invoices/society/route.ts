import type { NextRequest } from 'next/server';
import { services } from '@/server/runtime';
import { actor, toResponse } from '@/server/http';

/** The committee's ledger: every invoice in the society, with the home it belongs to. */
export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { billing } = await services();
  return toResponse(await billing.forSociety(who.value));
}
