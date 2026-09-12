import type { NextRequest } from 'next/server';
import { RecordEntryInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, parseBody, toResponse } from '@/server/http';

/** Idempotent per pass: a second check-in must not create a second log row. */
export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const parsed = await parseBody(request, RecordEntryInput);
  if (!parsed.ok) return parsed.response;
  const { visitors } = await services();
  return toResponse(await visitors.recordEntry(who.value, parsed.data));
}
