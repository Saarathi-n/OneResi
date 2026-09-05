import type { ReactNode } from 'react';
import { cn } from '../internal/cn.js';

/**
 * Nothing here yet — which is a different fact from a request that failed, and has to look
 * different. This one is calm, describes what would be here, and offers the action that puts
 * something in it.
 */
export interface EmptyStateProps {
  readonly title: string;
  readonly description?: ReactNode | undefined;
  /** A line drawing, not a mascot. */
  readonly icon?: ReactNode | undefined;
  /** The one action that resolves the emptiness. */
  readonly action?: ReactNode | undefined;
  readonly size?: 'compact' | 'default' | undefined;
  readonly className?: string | undefined;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  size = 'default',
  className,
}: EmptyStateProps): ReactNode {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl',
        'border border-dashed border-border bg-surface text-center',
        size === 'compact' ? 'px-4 py-6' : 'px-6 py-12',
        className,
      )}
    >
      {icon !== undefined ? (
        <span className="flex text-content-subtle" aria-hidden>
          {icon}
        </span>
      ) : null}
      <h3 className="type-title text-content">{title}</h3>
      {description !== undefined ? (
        <p className="type-body max-w-prose text-content-muted">{description}</p>
      ) : null}
      {action !== undefined ? <div className="mt-1 flex gap-2">{action}</div> : null}
    </div>
  );
}
