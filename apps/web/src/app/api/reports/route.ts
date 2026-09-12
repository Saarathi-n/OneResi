import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ReportQuery } from '@oneresi/contracts';
import { services } from '@/server/runtime';
import { actor, toResponse } from '@/server/http';

/**
 * The committee's exports (UC-27): one CSV, one kind, one range. The service returns parsed
 * cells — this route is the only place a cell becomes CSV text, and the only place quoting
 * happens: a cell containing a comma, quote or newline is wrapped and escaped per RFC 4180, so
 * a comma inside a resident's note cannot split one report row into two broken ones.
 */
export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);

  const query = ReportQuery.safeParse({
    kind: request.nextUrl.searchParams.get('kind') ?? undefined,
    from: request.nextUrl.searchParams.get('from') ?? undefined,
    to: request.nextUrl.searchParams.get('to') ?? undefined,
  });
  if (!query.success) {
    return NextResponse.json(
      { code: 'INVALID_INPUT', message: 'Check the form and try again.', fields: ['kind'] },
      { status: 400 },
    );
  }

  const { reports } = await services();
  const result = await reports.csv(who.value, query.data);
  if (!result.ok) return toResponse(result);

  const cell = (value: string): string =>
    /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

  const lines = [result.value.header.map(cell).join(','), ...result.value.rows.map((row) => row.map(cell).join(','))];

  return new NextResponse(`${lines.join('\r\n')}\r\n`, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${result.value.filename}"`,
      // An empty range is a header-only file, stated in the header rather than as an error —
      // the file opens and shows its emptiness (UC-27 alternative flow 4a).
      'x-report-empty': result.value.empty ? '1' : '0',
    },
  });
}
