import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * The dev-origin CORS bridge for the PWA.
 *
 * In development the two frontends are two dev servers: the API on 3000, the installable app on
 * 3001 (apps/app/src/lib/api.ts). A browser treats that as cross-origin, and the app's fetches
 * carry `credentials: 'include'` — so without `Access-Control-Allow-Origin` naming the app's
 * origin plus `Allow-Credentials`, every response is unreadable and the PWA cannot even sign in.
 *
 * In production this adds nothing: the two apps ship in ONE container behind one origin
 * (docs/plan/02-architecture.md — "/a/*" to the app, everything else to the web), and same-origin
 * requests never carry a cross-origin `Origin` header that matches the dev address below. The
 * guard is the literal origin string, not a prefix or a regex, so nothing else can talk its way
 * into credentialed access.
 */
const DEV_APP_ORIGIN = 'http://localhost:3001';

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    Vary: 'Origin',
  };
}

export function middleware(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');
  if (origin !== DEV_APP_ORIGIN) return NextResponse.next();

  // The preflight. Answered here rather than in every route, because every route needs the same
  // answer and none of them cares about it.
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }

  const response = NextResponse.next();
  for (const [name, value] of Object.entries(corsHeaders(origin))) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
