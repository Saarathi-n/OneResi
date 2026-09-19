import type { NextRequest } from 'next/server';
import { actor, toResponse } from '@/server/http';
import { mailLog, requeueFailedMail } from '@/server/mail';

/**
 * The mail log the committee's desk reads: every message the system wrote, with the provider's
 * own verdict on each. GET is the list; POST { action: 'requeue' } is the resend button — the
 * one operation the worker's design leaves for a person. Committee only (the seam checks).
 */
export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  return toResponse(await mailLog(who.value));
}

export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);

  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== 'requeue') {
    return Response.json(
      { code: 'INVALID_INPUT', message: 'Unknown action.', fields: ['action'] },
      { status: 400 },
    );
  }
  return toResponse(await requeueFailedMail(who.value));
}
