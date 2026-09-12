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
  /**
   * True while a background reload refreshes data the person is already looking at: the previous
   * content stays up, gently dimmed. The skeleton is for the first load only.
   */
  readonly reloading?: boolean;
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
  reloading = false,
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
  const content =
    empty !== undefined && isEmptyAnswer(data) ? <>{empty}</> : <>{render(data)}</>;
  if (!reloading) return content;
  return (
    <div aria-busy className="opacity-60 transition-opacity">
      <span className="sr-only">Refreshing</span>
      {content}
    </div>
  );
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
