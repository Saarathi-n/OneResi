import type { NextRequest } from 'next/server';
import { services } from '@/server/runtime';
import { actor, toResponse } from '@/server/http';

/**
 * A receipt addressed by number, not row id, so the URL survives a target switch (D-26).
 * The route path segment is cosmetic — the number is the address the service understands.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ receiptNo: string }> },
) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const { receiptNo } = await context.params;
  const { billing } = await services();
  return toResponse(await billing.receipt(who.value, receiptNo));
}
