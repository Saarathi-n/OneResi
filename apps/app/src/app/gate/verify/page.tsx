'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card } from '@oneresi/ui';
import { Shell } from '@/components/Shell';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { call } from '@/lib/api';
import { ROW_SHAKE_CLASS, screenClass } from '@/lib/motion';
import type { GateDecisionWire } from '@/lib/types';
import { CodeKeypad, CODE_LENGTH } from '../components/CodeKeypad';
import { DecisionCard } from '../components/DecisionCard';

/**
 * The core gate screen: type six digits, get a decision. The sixth digit IS the submit — a guard
 * holding a visitor's phone never hunts for an extra button — and the answer arrives as a
 * full-screen ADMIT or TURN AWAY, never a row of data (D-40). Verification is a read: it is
 * never queued, and a failed lookup shakes the code and says why.
 */

export default function VerifyPage(): ReactNode {
  const reduced = useReducedMotion();
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [decision, setDecision] = useState<GateDecisionWire | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  // The last code this screen auto-submitted. Auto-submit fires once per distinct code, so a
  // failed lookup never re-fires itself in a loop, and a manual retry is always available.
  const lastAutoVerified = useRef('');

  const verify = useCallback(async (candidate: string): Promise<void> => {
    setChecking(true);
    setFailure(null);
    setInvalid(false);
    const outcome = await call<GateDecisionWire>('/api/gate/verify', {
      method: 'POST',
      json: { code: candidate },
    });
    setChecking(false);
    if (outcome.ok) {
      setDecision(outcome.data);
      return;
    }
    setFailure(outcome.error.message);
    setInvalid(true);
  }, []);

  // Auto-submit the moment the sixth digit lands — from the keypad or from the segments; the
  // OtpInput's own completion callback only fires on internal typing, so completion is detected
  // here, on the value itself, whichever input path produced it.
  useEffect(() => {
    if (code.length === CODE_LENGTH && code !== lastAutoVerified.current && decision === null) {
      lastAutoVerified.current = code;
      void verify(code);
    }
  }, [code, decision, verify]);

  const reset = useCallback(() => {
    setCode('');
    setDecision(null);
    setFailure(null);
    setInvalid(false);
    lastAutoVerified.current = '';
  }, []);

  return (
    <Shell title="Check a pass code" backHref="/gate">
      <div className={screenClass('forward', reduced)}>
        {decision !== null ? (
          <DecisionCard decision={decision} reduced={reduced} onReset={reset} />
        ) : (
          <div>
            <p className="type-body text-content-subtle">
              Type the six digits from the visitor&apos;s phone. The code checks itself.
            </p>
            <div className="mt-6">
              <CodeKeypad
                value={code}
                onValueChange={setCode}
                pending={checking}
                invalid={invalid}
              />
            </div>
            <div className="mt-6" aria-live="polite">
              {checking ? (
                <Card padding="tight" pending>
                  <p className="type-body text-content-subtle">Checking the code…</p>
                </Card>
              ) : null}
              {failure !== null ? (
                <div key={failure} className={ROW_SHAKE_CLASS}>
                  <p
                    role="alert"
                    className="rounded-lg border border-critical-border bg-critical-soft px-3 py-2 type-label text-critical"
                  >
                    {failure}
                  </p>
                  <div className="mt-3">
                    <Button
                      size="kiosk"
                      variant="secondary"
                      fullWidth
                      disabled={code.length < CODE_LENGTH}
                      onClick={() => {
                        void verify(code);
                      }}
                    >
                      Check again
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
