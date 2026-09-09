'use client';

import type { ReactNode } from 'react';
import { Skeleton, ErrorState } from '@oneresi/ui';
import type { AsyncState } from '../hooks/useAsync';

/**
 * The tri-state every async view renders: a loading skeleton while the request is out, the
 * caller's empty state when the answer is an empty list, and an error state with a retry when
 * the request failed. A spinner-only or blank screen is not an option anywhere in this app.
 */

export interface AsyncViewProps<T> {
  readonly state: AsyncState<T>;
  /** What the skeleton roughly looks like — rows, cards, whatever this screen lists. */
  readonly skeleton: ReactNode;
  /** Empty is the caller's to explain: it knows what an empty answer means here. */
  readonly empty?: ReactNode;
  readonly render: (data: T) => ReactNode;
  readonly onRetry: () => void;
  readonly retryPending?: boolean;
}

export function AsyncView<T>({
  state,
  skeleton,
  empty,
  render,
  onRetry,
  retryPending = false,
}: AsyncViewProps<T>): ReactNode {
  if (state.state === 'loading') {
    return (
      <div aria-busy>
        <span className="sr-only">Loading</span>
        {skeleton}
      </div>
    );
  }

  if (state.state === 'failed') {
    return (
      <ErrorState
        title="That did not load"
        description={state.error.message}
        onRetry={onRetry}
        pending={retryPending}
      />
    );
  }

  const data = state.data;
  if (empty !== undefined && isEmptyAnswer(data)) {
    return <>{empty}</>;
  }

  return <>{render(data)}</>;
}

function isEmptyAnswer(data: unknown): boolean {
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

/** A ready-made skeleton block for a list of cards. */
export function CardListSkeleton({ rows = 3 }: { readonly rows?: number }): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, row) => (
        <Skeleton key={`skeleton-row-${row}`} height={92} className="rounded-xl" />
      ))}
    </div>
  );
}
