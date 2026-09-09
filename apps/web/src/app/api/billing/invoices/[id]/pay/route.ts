import type { NextRequest } from 'next/server';
import { PayInvoiceInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

/** Scoped to the caller's own unit. Anyone could settle any invoice before (D-07). */
export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, PayInvoiceInput);
  if (!parsed.ok) return parsed.response;
  const { billing } = await services();
  return toResponse(await billing.pay(who.value, parsed.data));
}
