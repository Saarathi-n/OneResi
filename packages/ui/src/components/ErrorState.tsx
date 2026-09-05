'use client';

import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { Button } from './Button.js';

/**
 * The read failed. Deliberately not the empty state: a request that returned an error must never
 * be presented as an absence of data, which is what the previous build did thirteen times over
 * by dropping the failure and rendering "nothing filed for your flat".
 *
 * It says what failed, it offers the retry, and it announces itself.
 */
export interface ErrorStateProps {
  readonly title?: string | undefined;
  /** What failed, in the reader's terms. Not a stack trace and not a status code. */
  readonly description?: ReactNode | undefined;
  /** Called by the retry button. Absent means no retry is offered. */
  readonly onRetry?: (() => void) | undefined;
  readonly retryLabel?: string | undefined;
  /** The retry is in flight. */
  readonly pending?: boolean | undefined;
  /** A reference a resident can quote when they report it. Shown small, never as the headline. */
  readonly reference?: string | undefined;
  readonly size?: 'compact' | 'default' | undefined;
  readonly className?: string | undefined;
}
export function ErrorState({
  title = 'That did not load',
  description = 'The request did not come back. Nothing has been changed.',
  onRetry,
  retryLabel = 'Try again',
  pending = false,
  reference,
  size = 'default',
  className,
}: ErrorStateProps): ReactNode {
  return (
    <div
      role="alert"
      aria-busy={pending}
      className={cn(
        'flex flex-col items-start gap-3 rounded-xl border border-critical-border',
        'bg-critical-soft text-content',
        size === 'compact' ? 'p-4' : 'p-6',
        className,
      )}
    >
      <span className="flex items-center gap-2 text-critical">
        <AlertTriangle size={18} aria-hidden />
        <h3 className="type-title">{title}</h3>
      </span>

      <p className="type-body max-w-prose text-content-muted">{description}</p>

      <div className="flex flex-wrap items-center gap-3">
        {onRetry !== undefined ? (
          <Button variant="secondary" onClick={onRetry} pending={pending}>
            {retryLabel}
          </Button>
        ) : null}
        {reference !== undefined ? (
          <span className="type-micro text-content-subtle">{reference}</span>
        ) : null}
      </div>
    </div>
  );
}
