'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, CodeDisplay, Field, Input, Sheet, StatusPill, Tabs, useToast } from '@oneresi/ui';
import * as C from '@oneresi/contracts';
import { Icon } from '@/components/icons';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { WaitingDecision } from '@/components/WaitingDecision';
import { call, simple } from '@/lib/api';
import { RESIDENT_TABS } from '@/lib/tabs';
import { useAsync } from '@/hooks/useAsync';
import { usePolling } from '@/hooks/usePolling';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { enqueue } from '@/lib/replay-queue';
import { rowStyle } from '@/lib/motion';
import { formatDay, formatWeekday, todayInput, tomorrowInput } from '@/lib/format';
import type { EntryLogWire, PassWire, WaitingVisitorWire } from '@/lib/types';

/**
 * The visitor screen: four views of one truth — passes issued, who is expected today, who is
 * waiting at the gate right now, and the diary of everyone who came. The waiting view polls (the
 * route map's SSE wrapper cannot carry a Bearer header from an EventSource; polling the same
 * endpoint is the documented alternative). The pass form pre-fills from the household's own
 * history: the last three visitor names and the most-used purposes (the pre-filling table).
 */

const RECENT_PURPOSES = ['Delivery', 'Cab', 'Guest', 'Household help', 'Service visit'];

export default function VisitorsPage(): ReactNode {
  const reduced = useReducedMotion();
  const toast = useToast();
  const [view, setView] = useState('passes');
  const [issuing, setIssuing] = useState(false);

  const passes = useAsync(() => simple<readonly PassWire[]>('/api/visitors/passes'), []);
  const expected = useAsync(() => simple<readonly PassWire[]>('/api/visitors/expected-today'), []);
  const waiting = useAsync(() => simple<readonly WaitingVisitorWire[]>('/api/visitors/waiting'), []);
  const entries = useAsync(() => simple<readonly EntryLogWire[]>('/api/visitors/entries'), []);

  const refreshAll = useCallback(async () => {
    passes.reload();
    expected.reload();
    waiting.reload();
    entries.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [passes, expected, waiting, entries]);

  usePolling(
    useCallback(() => {
      waiting.reload();
    }, [waiting]),
    20_000,
  );

  // The pre-filling table: names from the household's own log, purposes from the same.
  const recentNames = useMemo(() => {
    if (entries.state.state !== 'ready') return [] as string[];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const item of entries.state.data) {
      if (!seen.has(item.visitorName)) {
        seen.add(item.visitorName);
        names.push(item.visitorName);
        if (names.length === 3) break;
      }
    }
    return names;
  }, [entries.state]);

  const commonPurposes = useMemo(() => {
    if (entries.state.state !== 'ready') return RECENT_PURPOSES.slice(0, 3);
    const counts = new Map<string, number>();
    for (const item of entries.state.data) {
      counts.set(item.purpose, (counts.get(item.purpose) ?? 0) + 1);
    }
    const ranked = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([purpose]) => purpose)
      .slice(0, 3);
    for (const fallback of RECENT_PURPOSES) {
      if (ranked.length >= 3) break;
      if (!ranked.includes(fallback)) ranked.push(fallback);
    }
    return ranked.slice(0, 3);
  }, [entries.state]);

  return (
    <Shell
      title="Visitors"
      tabs={RESIDENT_TABS}
      activeTab="/home/visitors"
      onRefresh={refreshAll}
      headerRight={
        <Button size="sm" leadingIcon={<Icon name="plus" size={16} />} onClick={() => { setIssuing(true); }}>
          Pass
        </Button>
      }
    >
      <Tabs
        variant="pill"
        label="Visitor views"
        value={view}
        onValueChange={setView}
        items={[
          { value: 'passes', label: 'Passes' },
          { value: 'expected', label: 'Expected' },
          { value: 'waiting', label: 'Waiting', badge: waiting.state.state === 'ready' && waiting.state.data.length > 0 ? waiting.state.data.length : undefined },
          { value: 'entries', label: 'Entries' },
        ]}
      >
        {view === 'passes' ? (
          <AsyncView
            state={passes.state}
            reloading={passes.reloading}
            skeleton={<CardListSkeleton rows={3} />}
            empty={
              <EmptyVisitors
                title="No passes yet"
                body="A pass gets your visitor through the gate without a call to you. Issue one for a delivery, a guest, anyone expected."
                action={<Button size="sm" onClick={() => { setIssuing(true); }}>Issue a pass</Button>}
              />
            }
            onRetry={passes.reload}
            render={(list) => (
              <div className="mt-3 flex flex-col gap-3">
                {list.map((pass, index) => (
                  <div key={pass.id} className="row-in" style={rowStyle(index, reduced)}>
                    <PassCard
                      pass={pass}
                      onCancelled={() => {
                        toast.show({
                          title: 'Pass cancelled',
                          description: 'The gate will turn this code away.',
                        });
                        passes.reload();
                        expected.reload();
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          />
        ) : null}

        {view === 'expected' ? (
          <AsyncView
            state={expected.state}
            reloading={expected.reloading}
            skeleton={<CardListSkeleton rows={2} />}
            empty={
              <EmptyVisitors
                title="Nobody expected today"
                body="Passes you issue for today show up here, and the gate sees them as pre-approved."
              />
            }
            onRetry={expected.reload}
            render={(list) => (
              <div className="mt-3 flex flex-col gap-3">
                <p className="type-label text-content-subtle">
                  {formatWeekday(new Date())} · {list.length} expected
                </p>
                {list.map((pass, index) => (
                  <div key={pass.id} className="row-in" style={rowStyle(index, reduced)}>
                    <PassCard pass={pass} onCancelled={() => { expected.reload(); passes.reload(); }} />
                  </div>
                ))}
              </div>
            )}
          />
        ) : null}

        {view === 'waiting' ? (
          <AsyncView
            state={waiting.state}
            reloading={waiting.reloading}
            skeleton={<CardListSkeleton rows={1} />}
            empty={
              <EmptyVisitors
                title="Nobody is waiting"
                body="When the gate logs a walk-in for your flat, it appears here and on your home screen until you answer it."
              />
            }
            onRetry={waiting.reload}
            render={(list) => (
              <div className="mt-3 flex flex-col gap-3">
                {list.map((visitor, index) => (
                  <WaitingDecision
                    key={visitor.logId}
                    visitor={visitor}
                    index={index}
                    reduced={reduced}
                    onDecided={(name, admitted) => {
                      toast.show({
                        title: admitted ? `${name} is on the way in` : `${name} was turned away`,
                        description: 'The gate has been told.',
                      });
                      waiting.ready(list.filter((item) => item.logId !== visitor.logId));
                      entries.reload();
                    }}
                  />
                ))}
                <p className="type-label text-content-subtle">
                  This view checks for new arrivals every 20 seconds while the app is open.
                </p>
              </div>
            )}
          />
        ) : null}

        {view === 'entries' ? (
          <AsyncView
            state={entries.state}
            reloading={entries.reloading}
            skeleton={<CardListSkeleton rows={4} />}
            empty={
              <EmptyVisitors
                title="No visitors logged yet"
                body="Everyone the gate logs for your flat lands here — pass arrivals, walk-ins, and refusals."
              />
            }
            onRetry={entries.reload}
            render={(list) => (
              <div className="mt-3 flex flex-col gap-2">
                {list.map((item, index) => (
                  <div key={item.logId} className="row-in" style={rowStyle(index, reduced)}>
                    <Card padding="tight" tone={C.APPROVAL_STATUS[item.approvalStatus].tone}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate type-body font-medium">{item.visitorName}</p>
                          <p className="truncate type-label text-content-subtle">
                            {item.purpose}
                            {item.overrideReason !== null
                              ? ' — guard let them in without waiting'
                              : item.exitedAt !== null
                                ? ' — has left'
                                : item.enteredAt !== null
                                  ? ' — inside'
                                  : ''}
                          </p>
                        </div>
                        <StatusPill descriptor={C.APPROVAL_STATUS[item.approvalStatus]} size="sm" />
                      </div>
                    </Card>
                  </div>
                ))}
              </div>
            )}
          />
        ) : null}
      </Tabs>

      <IssuePassSheet
        open={issuing}
        onClose={() => {
          setIssuing(false);
        }}
        recentNames={recentNames}
        commonPurposes={commonPurposes}
        onIssued={(pass) => {
          setIssuing(false);
          toast.show({
            title: `Pass ready for ${pass.visitorName}`,
            description: 'Share the code — the gate will recognise it.',
          });
          passes.reload();
          expected.reload();
          setView('passes');
        }}
      />
    </Shell>
  );
}

function EmptyVisitors({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
}): ReactNode {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
      <p className="type-body font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-72 type-label text-content-subtle">{body}</p>
      {action !== undefined ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

function PassCard({
  pass,
  onCancelled,
}: {
  readonly pass: PassWire;
  readonly onCancelled: () => void;
}): ReactNode {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function cancel(): Promise<void> {
    if (pending) return;
    setPending(true);
    setFailed(null);
    const result = await simple<PassWire>(`/api/visitors/passes/${pass.id}/cancel`, { method: 'POST' });
    setPending(false);
    if (result.ok) {
      onCancelled();
      return;
    }
    setFailed(result.error.message);
  }

  return (
    <Card tone={C.PASS_STATUS[pass.status].tone}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate type-body font-medium">{pass.visitorName}</p>
          <p className="truncate type-label text-content-subtle">{pass.purpose}</p>
        </div>
        <StatusPill descriptor={C.PASS_STATUS[pass.status]} size="sm" />
      </div>
      <div className="mt-3">
        <CodeDisplay code={pass.code} label={`Gate code for ${pass.visitorName}`} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="type-label text-content-muted">
          Valid {formatWeekday(pass.validOn)}, {formatDay(pass.validOn)}
          {pass.arrivedAt !== null ? ' — arrived' : ''}
        </p>
        {pass.status === 'ACTIVE' ? (
          <Button size="sm" variant="ghost" pending={pending} onClick={() => { void cancel(); }}>
            Cancel pass
          </Button>
        ) : null}
      </div>
      {failed !== null ? (
        <p role="alert" className="mt-2 rounded-lg border border-critical-border bg-critical-soft px-3 py-2 type-label text-critical">
          {failed}
        </p>
      ) : null}
    </Card>
  );
}

function IssuePassSheet({
  open,
  onClose,
  recentNames,
  commonPurposes,
  onIssued,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly recentNames: readonly string[];
  readonly commonPurposes: readonly string[];
  readonly onIssued: (pass: PassWire) => void;
}): ReactNode {
  const [visitorName, setVisitorName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [validDate, setValidDate] = useState(todayInput());
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ visitorName?: string; purpose?: string; validDate?: string }>({});
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (pending) return;
    const problems: { visitorName?: string; purpose?: string; validDate?: string } = {};
    if (visitorName.trim().length < 2) problems.visitorName = 'Who is coming? A name the gate can read out.';
    if (purpose.trim().length < 2) problems.purpose = 'What are they coming for?';
    if (validDate === '') problems.validDate = 'Pick a day';
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    setErrors({});
    setPending(true);

    const body = { visitorName: visitorName.trim(), purpose: purpose.trim(), validDate };

    const outcome = await call<PassWire>('/api/visitors/passes', { method: 'POST', json: body });
    if (outcome.ok) {
      setPending(false);
      setVisitorName('');
      setPurpose('');
      setValidDate(todayInput());
      onIssued(outcome.data);
      return;
    }
    if ('network' in outcome && outcome.network) {
      // No connection. The pass is queued with its idempotency key and replayed in order later;
      // the code only exists once the server accepts it, so the person is told exactly that.
      enqueue({
        path: '/api/visitors/passes',
        method: 'POST',
        body,
        description: `Visitor pass for ${body.visitorName}`,
      });
      setPending(false);
      setOfflineNotice(
        `You are offline — the pass for ${body.visitorName} is saved on this phone and will be issued the moment you are back on the network.`,
      );
      setVisitorName('');
      setPurpose('');
      return;
    }
    setPending(false);
    if (outcome.error.field === 'visitorName') setErrors({ visitorName: outcome.error.message });
    else if (outcome.error.field === 'purpose') setErrors({ purpose: outcome.error.message });
    else if (outcome.error.field === 'validDate') setErrors({ validDate: outcome.error.message });
    else setErrors({ purpose: outcome.error.message });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Issue a visitor pass"
      description="The gate reads the code and lets them in without calling you."
      pending={pending}
      footer={
        <Button size="lg" fullWidth pending={pending} pendingLabel="Issuing" onClick={() => { void submit(); }}>
          Issue pass
        </Button>
      }
    >
      {offlineNotice !== null ? (
        <p role="status" className="mb-4 rounded-lg border border-caution-border bg-caution-soft px-4 py-3 type-body text-caution">
          {offlineNotice}
        </p>
      ) : null}
      <div className="flex flex-col gap-4">
        <Field label="Visitor's name" required error={errors.visitorName}>
          <Input
            value={visitorName}
            autoComplete="off"
            onChange={(event) => {
              setVisitorName(event.target.value);
            }}
          />
        </Field>
        {recentNames.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {recentNames.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setVisitorName(name);
                }}
                className="tab-target rounded-pill border border-border bg-surface-raised px-3 py-1 type-label text-content-muted focus-ring-inset"
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}

        <Field label="Purpose" required error={errors.purpose}>
          <Input
            value={purpose}
            onChange={(event) => {
              setPurpose(event.target.value);
            }}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {commonPurposes.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                setPurpose(suggestion);
              }}
              className="tab-target rounded-pill border border-border bg-surface-raised px-3 py-1 type-label text-content-muted focus-ring-inset"
            >
              {suggestion}
            </button>
          ))}
        </div>

        <Field label="Valid on" required error={errors.validDate} hint="Today or a later day.">
          <Input
            type="date"
            value={validDate}
            min={todayInput()}
            onChange={(event) => {
              setValidDate(event.target.value);
            }}
          />
        </Field>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setValidDate(todayInput());
            }}
            className="tab-target flex-1 rounded-pill border border-border bg-surface-raised px-3 py-2 type-label text-content-muted focus-ring-inset"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => {
              setValidDate(tomorrowInput());
            }}
            className="tab-target flex-1 rounded-pill border border-border bg-surface-raised px-3 py-2 type-label text-content-muted focus-ring-inset"
          >
            Tomorrow
          </button>
        </div>
      </div>
    </Sheet>
  );
}
