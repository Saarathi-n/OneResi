import type { NextRequest } from 'next/server';
import { services } from '@/server/runtime';
import { meta, refreshToken, toResponse, withRefreshCookie } from '@/server/http';

/** Refresh rotates the cookie. A replay of a rotated token revokes the whole family (D-24). */
export async function POST(request: NextRequest) {
  const token = refreshToken(request);
  if (token === null) {
    return toResponse({
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: 'Please sign in again.' },
    });
  }
  const { accounts } = await services();
  const result = await accounts.refresh(token, meta(request));
  if (!result.ok) return toResponse(result);
  return withRefreshCookie(toResponse(result), result.value.refreshToken, result.value.refreshExpiresAt);
}
