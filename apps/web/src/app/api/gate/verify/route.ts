import type { NextRequest } from 'next/server';
import { VerifyPassInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, meta, parseBody, toResponse } from '@/server/http';

/** A decision, never a row — a cancelled pass must not render as admitted (D-40). */
export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, VerifyPassInput);
  if (!parsed.ok) return parsed.response;
  const { visitors } = await services();
  return toResponse(await visitors.verifyCode(who.value, parsed.data, meta(request)));
}
