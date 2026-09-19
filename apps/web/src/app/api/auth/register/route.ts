import type { NextRequest } from 'next/server';
import { RegisterInput } from '@grihaone/contracts';
import { services } from '@/server/runtime';
import { meta, parseBody, toResponse } from '@/server/http';

/** The one public write. Everyone after the first account queues as PENDING (D-01). */
export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, RegisterInput);
  if (!parsed.ok) return parsed.response;
  const { accounts } = await services();
  const result = await accounts.register(parsed.data, meta(request));
  return toResponse(result);
}
