import type { NextRequest } from 'next/server';
import { RequestPasswordResetInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { meta, parseBody, toResponse } from '@/server/http';

/** Same result shape whether or not the address has an account (D-22's lesson, kept). */
export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, RequestPasswordResetInput);
  if (!parsed.ok) return parsed.response;
  const { accounts } = await services();
  return toResponse(await accounts.requestPasswordReset(parsed.data, meta(request)));
}
