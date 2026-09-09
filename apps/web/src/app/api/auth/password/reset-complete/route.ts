import type { NextRequest } from 'next/server';
import { CompletePasswordResetInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { parseBody, toResponse } from '@/server/http';

export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, CompletePasswordResetInput);
  if (!parsed.ok) return parsed.response;
  const { accounts } = await services();
  return toResponse(await accounts.completePasswordReset(parsed.data));
}
