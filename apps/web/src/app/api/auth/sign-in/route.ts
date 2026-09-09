import type { NextRequest } from 'next/server';
import { SignInInput } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { meta, parseBody, toResponse, withRefreshCookie } from '@/server/http';

/** Sign-in sets the `oneresi_rt` cookie. */
export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, SignInInput);
  if (!parsed.ok) return parsed.response;
  const { accounts } = await services();
  const result = await accounts.signIn(parsed.data, meta(request));
  if (!result.ok) return toResponse(result);
  return withRefreshCookie(toResponse(result), result.value.refreshToken, result.value.refreshExpiresAt);
}
