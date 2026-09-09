import type { NextRequest } from 'next/server';
import { CancelInvoiceInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

/** The only way to void a wrongly raised invoice. */
export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, CancelInvoiceInput);
  if (!parsed.ok) return parsed.response;
  const { billing } = await services();
  return toResponse(await billing.cancel(who.value, parsed.data));
}
