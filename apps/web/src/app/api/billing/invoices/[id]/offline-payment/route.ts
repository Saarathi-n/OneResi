import type { NextRequest } from 'next/server';
import { RecordOfflinePaymentInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, invalidInput, parseBody, toResponse } from '@/server/http';

/** Money received outside the system — the path ADR 0002 keeps. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, RecordOfflinePaymentInput);
  if (!parsed.ok) return parsed.response;
  // The body names the invoice and the path must agree with it, so a copied URL can never record
  // against a different invoice than the form says it is recording against.
  const { id } = await context.params;
  if (id !== String(parsed.data.invoiceId)) return invalidInput(['id']);
  const { billing } = await services();
  return toResponse(await billing.recordOffline(who.value, parsed.data));
}
