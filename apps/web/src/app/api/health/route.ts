import { NextResponse } from 'next/server';
import { databaseReachable } from '@/server/health';

/**
 * The load balancer's health check, and the only route that answers it. The check itself lives in
 * the server module where database access belongs (WIRING rule 4); this handler maps its answer.
 * Unauthenticated by design: the load balancer carries no session, and the response says only
 * `ok` — nothing about a person or their data.
 */
export async function GET() {
  const ok = await databaseReachable();
  return NextResponse.json({ ok }, { status: ok ? 200 : 503 });
}
