'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, useToast } from '@oneresi/ui';
import { Icon } from '@/components/icons';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import {
  currentPushState,
  disablePush,
  enablePush,
  fetchPushKey,
  pushSupported,
  type PushState,
} from '@/lib/push';

/**
 * The lock-screen switch, on the notifications screen — the one place a person is already
 * thinking about what reaches them. Renders nothing at all when there is nothing honest to
 * offer: a browser without push support, or a server with no VAPID key (a dev checkout without
 * keys) never shows a button that can only fail (D-30's argument, from the client side).
 *
 * A permission already denied is rendered as the sentence it is — the browser only lets the
 * person undo that in its own site settings, so a retry button here would bounce forever.
 */
export function PushSetting(): ReactNode {
  const reduced = useReducedMotion();
  const toast = useToast();
  const [state, setState] = useState<PushState | 'checking' | 'hidden'>('checking');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!pushSupported()) {
      setState('hidden');
      return;
    }
    let alive = true;
    void (async () => {
      const key = await fetchPushKey();
      if (!alive) return;
      // No key from the server: nothing to offer, and nothing broken-looking either.
      if (key === null || !key.configured) {
        setState('hidden');
        return;
      }
      setState(await currentPushState());
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state === 'hidden' || state === 'checking') return null;

  const description =
    state === 'blocked'
      ? 'Notifications are blocked for this app. Allow them in your browser’s site settings to get alerts here.'
      : state === 'subscribed'
        ? 'Arrivals, payments and booking decisions reach this phone until you turn them off.'
        : 'Get arrivals, payments and booking decisions on this phone’s lock screen.';

  async function turnOn(): Promise<void> {
    if (pending) return;
    setPending(true);
    const outcome = await enablePush();
    setPending(false);
    if (outcome.ok) {
      setState('subscribed');
      toast.show({ title: 'Notifications on', description: 'Alerts will reach this phone.' });
      return;
    }
    if (outcome.reason === 'denied') {
      setState('blocked');
      toast.show({ title: 'Notifications blocked', description: outcome.message });
      return;
    }
    toast.show({ title: 'Could not turn on notifications', description: outcome.message });
  }

  async function turnOff(): Promise<void> {
    if (pending) return;
    setPending(true);
    const outcome = await disablePush();
    setPending(false);
    if (outcome.ok) {
      setState('off');
      toast.show({
        title: 'Notifications off',
        description: 'You can turn them back on any time.',
      });
      return;
    }
    toast.show({ title: 'Could not turn off notifications', description: outcome.message });
  }

  return (
    <div className="row-in" style={rowStyle(0, reduced)}>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="type-body font-medium">On this phone</p>
            <p className="mt-1 type-label text-content-muted">{description}</p>
          </div>
          {state === 'off' ? (
            <Button
              size="sm"
              pending={pending}
              pendingLabel="Turning on"
              onClick={() => {
                void turnOn();
              }}
            >
              Turn on
            </Button>
          ) : state === 'subscribed' ? (
            <Button
              size="sm"
              variant="ghost"
              pending={pending}
              pendingLabel="Turning off"
              onClick={() => {
                void turnOff();
              }}
            >
              Turn off
            </Button>
          ) : (
            <Icon name="bell" size={18} className="shrink-0 text-content-muted" />
          )}
        </div>
      </Card>
    </div>
  );
}
