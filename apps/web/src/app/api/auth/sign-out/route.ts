import type { NextRequest } from 'next/server';
import { services } from '@/server/runtime';
import { refreshToken, toResponse, withClearedRefreshCookie } from '@/server/http';

/** Sign-out clears the cookie; an unknown token is already as signed-out as it can be. */
export async function POST(request: NextRequest) {
  const token = refreshToken(request);
  const { accounts } = await services();
  const result = await accounts.signOut(token ?? '');
  if (!result.ok) return toResponse(result);
  return withClearedRefreshCookie(toResponse(result));
}
