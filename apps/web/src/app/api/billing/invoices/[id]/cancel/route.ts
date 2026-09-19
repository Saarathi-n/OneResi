import type { NextRequest } from 'next/server';
import { CancelInvoiceInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, invalidInput, parseBody, toResponse } from '@/server/http';

/** The only way to void a wrongly raised invoice. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, CancelInvoiceInput);
  if (!parsed.ok) return parsed.response;
  // The body names the invoice and the path must agree with it, so a copied URL can never cancel a
  // different invoice than the form says it is cancelling.
  const { id } = await context.params;
  if (id !== String(parsed.data.invoiceId)) return invalidInput(['id']);
  const { billing } = await services();
  return toResponse(await billing.cancel(who.value, parsed.data));
}
