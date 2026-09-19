import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { COMPLAINT_STATUSES } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { actor, toResponse } from '@/server/http';

const Query = z.object({ status: z.enum(COMPLAINT_STATUSES).optional() });

/** The committee's list, narrowed by the optional `status` query parameter. */
export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  const rawStatus = request.nextUrl.searchParams.get('status');
  const { complaints } = await services();
  if (rawStatus !== null && rawStatus !== '') {
    const parsed = Query.safeParse({ status: rawStatus });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Check the form and try again.', fields: ['status'] },
        { status: 400 },
      );
    }
    const status = parsed.data.status;
    if (status !== undefined) {
      return toResponse(await complaints.forSociety(who.value, { status }));
    }
  }
  return toResponse(await complaints.forSociety(who.value));
}
