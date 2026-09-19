import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { services } from './runtime.js';
import type { Actor, RequestMeta, Result, DomainError, ErrorCode } from '@grihaone/domain';
import { REFRESH_TOKEN_TTL_SECONDS } from '@grihaone/contracts';

/**
 * The HTTP edge every route handler shares: actor resolution, request meta, the one error
 * mapper, contract parsing, and the refresh cookie. A handler authenticates, parses with a
 * contract, calls one service, and maps the result — nothing else (WIRING rule 4).
 */

// ---------------------------------------------------------------- actor and meta

/** Resolves the Bearer token to the live actor, or a 401-shaped `Result` failure. */
export async function actor(request: NextRequest): Promise<Result<Actor>> {
  const header = request.headers.get('authorization');
  if (header === null || !header.startsWith('Bearer ')) {
    return { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please sign in again.' } };
  }
  const token = header.slice('Bearer '.length).trim();
  if (token.length === 0) {
    return { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please sign in again.' } };
  }
  const { accounts } = await services();
  return accounts.resolveActor(token);
}

/**
 * `x-forwarded-for` (first hop) falling back to the socket address, `userAgent` from the
 * header, `correlationId` from `x-request-id` or generated. Meta rides every service call
 * that takes one — it is what the outbox correlates by.
 */
export function meta(request: NextRequest): RequestMeta {
  const forwarded = request.headers.get('x-forwarded-for');
  // The viewer's address, not the first hop the client typed. In production every request walks
  // CloudFront then the ALB, and both APPEND: the last hop was written by our own ALB (a CloudFront
  // edge), the hop before it by CloudFront (the viewer), and anything before that is the viewer's
  // own forgery — a client that sends X-Forwarded-For chooses its first hop, so keying a rate
  // window on it lets the client rotate identities (D-83). One hop is the client itself, direct,
  // with nothing appended after it.
  const hops =
    forwarded === null
      ? []
      : forwarded
          .split(',')
          .map((hop) => hop.trim())
          .filter((hop) => hop.length > 0);
  const viewer = hops.length >= 2 ? hops[hops.length - 2] : hops[0];
  const ip = viewer ?? (request.headers.get('x-real-ip') ?? 'unknown');
  const userAgent = request.headers.get('user-agent');
  const requested = request.headers.get('x-request-id');
  return {
    ip,
    userAgent: userAgent === null ? null : userAgent,
    correlationId: requested === null || requested.length === 0 ? randomUUID() : requested,
  };
}

// ---------------------------------------------------------------- error mapping

/**
 * HTTP status per error code, per the route map's conventions. WINDOW_CLOSED is 409 here —
 * the route map overrides the domain's STATUS_FOR (which maps it to 410) for the web surface.
 */
const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  STATE_NOT_ALLOWED: 409,
  LIMIT_REACHED: 409,
  WINDOW_CLOSED: 409,
  ALREADY_DONE: 409,
};

function errorBody(error: DomainError): { code: string; message: string; field?: string } {
  return { code: error.code, message: error.message, ...(error.field === undefined ? {} : { field: error.field }) };
}

/** The one result mapper. A `Result` becomes a JSON response; expected outcomes never throw. */
export function toResponse<T>(result: Result<T>): NextResponse {
  if (result.ok) {
    return NextResponse.json(result.value);
  }
  const status = STATUS[result.error.code];
  const body = errorBody(result.error);
  if (result.error.code === 'RATE_LIMITED') {
    // The minutes the person-facing message quotes, back to seconds for the header. The service
    // rounds up to whole minutes in the message, so the header is at least as long as the window.
    const minutes = Number(result.error.message.match(/\d+/)?.[0] ?? 1);
    return NextResponse.json(body, {
      status,
      headers: { 'Retry-After': String(Math.max(1, minutes) * 60) },
    });
  }
  return NextResponse.json(body, { status });
}

/** Failure of the parse step — a 400 with the field paths, never a throw (route map convention). */
export function invalidInput(paths: readonly string[]): NextResponse {
  return NextResponse.json(
    { code: 'INVALID_INPUT', message: 'Check the form and try again.', fields: paths },
    { status: 400 },
  );
}

// ---------------------------------------------------------------- parsing

/** Parses the JSON body against a contract, returning either the data or the 400 response. */
export async function parseBody<S extends z.ZodTypeAny>(
  request: NextRequest,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: invalidInput(['body']) };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    // safeParse on a ZodTypeAny widens to `any`; the schema has already vouched for the shape.
    return { ok: true, data: parsed.data as z.infer<S> };
  }
  return { ok: false, response: invalidInput(issuePaths(parsed.error)) };
}

export function parseJson<S extends z.ZodTypeAny>(
  raw: string | null,
  schema: S,
): { ok: true; data: z.infer<S> } | { ok: false; response: NextResponse } {
  if (raw === null) {
    return { ok: false, response: invalidInput(['query']) };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, response: invalidInput(['query']) };
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    // safeParse on a ZodTypeAny widens to `any`; the schema has already vouched for the shape.
    return { ok: true, data: parsed.data as z.infer<S> };
  }
  return { ok: false, response: invalidInput(issuePaths(parsed.error)) };
}

function issuePaths(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.path.map(String).join('.') || 'body');
}

// ---------------------------------------------------------------- refresh cookie

const REFRESH_COOKIE = 'grihaone_rt';

/** Sets the httpOnly `grihaone_rt` cookie after sign-in or refresh. */
export function withRefreshCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
): NextResponse {
  response.cookies.set(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/api/auth',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
  });
  return response;
}

/** Clears the refresh cookie on sign-out. */
export function withClearedRefreshCookie(response: NextResponse): NextResponse {
  response.cookies.set(REFRESH_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/api/auth',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  });
  return response;
}

/** Reads the refresh cookie, if present. */
export function refreshToken(request: NextRequest): string | null {
  return request.cookies.get(REFRESH_COOKIE)?.value ?? null;
}

/** The TTL as seconds, for the one place it is needed at the edge (cookie maxAge). */
export const REFRESH_COOKIE_MAX_AGE_SECONDS = REFRESH_TOKEN_TTL_SECONDS;
