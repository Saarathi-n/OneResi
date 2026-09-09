import type { NextRequest } from 'next/server';
import { services } from '@/server/runtime';
import { actor } from '@/server/http';

/** How often the wrapper re-calls the service and re-evaluates whether anything changed. */
const POLL_INTERVAL_MS = 5_000;
/** The comment heartbeat keeps intermediaries from closing an otherwise-quiet stream. */
const HEARTBEAT_MS = 15_000;

export const dynamic = 'force-dynamic';

/**
 * The waiting-visitor stream: a thin wrapper over `visitors.waitingForHousehold`, not a new use
 * case. An interval re-calls the service and emits only when the queue actually changed; between
 * emissions, comment heartbeats hold the connection open.
 */
export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) {
    return new Response(JSON.stringify({ code: who.error.code, message: who.error.message }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { visitors } = await services();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastSignature: string | null = null;

      const send = (event: string, data: unknown): void => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const close = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          // The consumer already went away; the enqueue failure is theirs to notice.
        }
      };

      const poll = async (): Promise<void> => {
        if (closed) return;
        const result = await visitors.waitingForHousehold(who.value);
        if (!result.ok) {
          // The session died mid-stream: tell the consumer and end, never throw into the stream.
          send('error', { code: result.error.code, message: result.error.message });
          close();
          return;
        }
        const signature = JSON.stringify(result.value);
        if (signature !== lastSignature) {
          lastSignature = signature;
          send('waiting', result.value);
        }
      };

      const pollTimer: ReturnType<typeof setInterval> = setInterval(() => {
        void poll();
      }, POLL_INTERVAL_MS);
      const heartbeatTimer: ReturnType<typeof setInterval> = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, HEARTBEAT_MS);

      request.signal.addEventListener('abort', close);
      await poll();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
