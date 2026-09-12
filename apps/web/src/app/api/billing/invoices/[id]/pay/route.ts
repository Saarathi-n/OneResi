import type { NextRequest } from 'next/server';
import { PayInvoiceInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, invalidInput, parseBody, toResponse } from '@/server/http';

/** Scoped to the caller's own unit. Anyone could settle any invoice before (D-07). */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, PayInvoiceInput);
  if (!parsed.ok) return parsed.response;
  // The body names the invoice and the path must agree with it, so a copied URL can never pay a
  // different invoice than the form says it is paying.
  const { id } = await context.params;
  if (id !== String(parsed.data.invoiceId)) return invalidInput(['id']);
  const { billing } = await services();
  return toResponse(await billing.pay(who.value, parsed.data));
}
