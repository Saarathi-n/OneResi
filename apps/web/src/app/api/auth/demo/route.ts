import { NextResponse, type NextRequest } from 'next/server';
import { services } from '@/server/runtime';
import { meta, toResponse, withRefreshCookie } from '@/server/http';

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'starling-marble-97-QUAY';

interface DemoTarget {
  readonly email: string;
  readonly destination: string;
}

const RESIDENT_TARGET: DemoTarget = {
  email: 'saarathin@gmail.com',
  destination: '/home',
};

const TARGETS: Record<string, DemoTarget> = {
  resident: RESIDENT_TARGET,
  committee: { email: 'ashvinksg@gmail.com', destination: '/desk' },
  gate: { email: 'ashvin.ks2024@vitstudent.ac.in', destination: '/gate' },
};

/**
 * Demo entrance endpoint. Signs in as the requested role (resident, committee, or gate)
 * and redirects immediately to the appropriate role dashboard.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const roleParam = request.nextUrl.searchParams.get('role')?.toLowerCase() ?? 'resident';
  const target = TARGETS[roleParam] ?? RESIDENT_TARGET;

  const { accounts } = await services();
  const result = await accounts.signIn(
    { email: target.email, password: DEMO_PASSWORD },
    meta(request),
  );

  if (!result.ok) {
    return toResponse(result);
  }

  const redirectResponse = NextResponse.redirect(new URL(target.destination, request.nextUrl));
  return withRefreshCookie(
    redirectResponse,
    result.value.refreshToken,
    result.value.refreshExpiresAt,
  );
}
