import type { NextRequest } from 'next/server';
import { RecordOfflinePaymentInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

/** Money received outside the system — the path ADR 0002 keeps. */
export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, RecordOfflinePaymentInput);
  if (!parsed.ok) return parsed.response;
  const { billing } = await services();
  return toResponse(await billing.recordOffline(who.value, parsed.data));
}
