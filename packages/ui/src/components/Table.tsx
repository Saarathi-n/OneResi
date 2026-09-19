'use client';

import { motion } from 'framer-motion';
import type { TargetAndTransition } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Tone } from '@oneresi/contracts';
import { cn } from '../internal/cn.js';
import { toneMarkClass } from '../internal/tone.js';
import { duration, seconds, toneVar } from '../tokens.js';
import { Skeleton } from './Skeleton.js';

/**
 * A real table: a caption, a header row, `aria-sort` on the column that is sorted, and three
 * distinct states for the body — loading, empty, failed.
 *
 * Sorting is controlled. The desk keeps it in the URL, which is what makes a sorted view
 * something you can send to someone.
 */
export interface Column<Row> {
  readonly id: string;
  readonly header: ReactNode;
  readonly cell: (row: Row) => ReactNode;
  readonly align?: 'start' | 'center' | 'end' | undefined;
  readonly sortable?: boolean | undefined;
  readonly width?: number | string | undefined;
  /** Dropped on a narrow viewport, where a table has to become a list. */
  readonly secondary?: boolean | undefined;
}

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  readonly columnId: string;
  readonly direction: SortDirection;
}

export interface TableProps<Row> {
  /** Always supplied, and announced. Hidden visually unless `showCaption`. */
  readonly caption: string;
  readonly showCaption?: boolean | undefined;
  readonly columns: readonly Column<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly sort?: SortState | undefined;
  readonly onSortChange?: ((sort: SortState) => void) | undefined;
  /** The whole table is loading. Renders placeholder rows under a real header. */
  readonly pending?: boolean | undefined;
  readonly skeletonRows?: number | undefined;
  /** The read failed. Pass an `ErrorState`; it replaces the body, never the empty message. */
  readonly error?: ReactNode | undefined;
  /** There is genuinely nothing. Pass an `EmptyState`. */
  readonly empty?: ReactNode | undefined;
  /** This row has an unconfirmed change against it. */
  readonly rowPending?: ((row: Row) => boolean) | undefined;
  /** A status colour down the leading edge of the row. */
  readonly rowTone?: ((row: Row) => Tone | undefined) | undefined;
  /** The key of the row that just changed: it washes its tone once. */
  readonly flashedRowKey?: string | undefined;
  /** A working tool, not a showcase: tighter rows for a ledger that has to answer at a glance. */
  readonly dense?: boolean | undefined;
  /** Makes rows keyboard-navigable and activatable. */
  readonly onRowActivate?: ((row: Row) => void) | undefined;
  readonly className?: string | undefined;
}

const ALIGN: Readonly<Record<'start' | 'center' | 'end', string>> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
};

function nextDirection(current: SortState | undefined, columnId: string): SortDirection {
  if (current === undefined || current.columnId !== columnId) return 'asc';
  return current.direction === 'asc' ? 'desc' : 'asc';
}

export function Table<Row>({
  caption,
  showCaption = false,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  pending = false,
  skeletonRows = 5,
  error,
  empty,
  rowPending,
  rowTone,
  flashedRowKey,
  dense = false,
  onRowActivate,
  className,
}: TableProps<Row>): ReactNode {
  const body = useRef<HTMLTableSectionElement>(null);
  const [focusRow, setFocusRow] = useState(0);
  const interactive = onRowActivate !== undefined;
  const span = columns.length;
  const cellPad = dense ? 'px-3 py-1.5' : 'px-3 py-3';
  const headPad = dense ? 'px-3 py-1.5' : 'px-3 py-2.5';

  function focusAt(index: number): void {
    const bounded = Math.min(Math.max(index, 0), rows.length - 1);
    setFocusRow(bounded);
    body.current?.querySelectorAll<HTMLElement>('tr')[bounded]?.focus();
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: Row, index: number): void {
    if (!interactive) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(index + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(index - 1);
        return;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        return;
      case 'End':
        event.preventDefault();
        focusAt(rows.length - 1);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onRowActivate?.(row);
        return;
      default:
        return;
    }
  }
  function rowTarget(row: Row, key: string): TargetAndTransition {
    const isPending = rowPending?.(row) === true;
    const tone = rowTone?.(row);

    if (key !== flashedRowKey || tone === undefined) {
      return { opacity: isPending ? 0.6 : 1 };
    }

    /* Both ends resolve to real colours, so the wash interpolates rather than snapping. It is
       an acknowledgement of a change, which is why it stays under reduced motion. */
    const wash = toneVar(tone, 'soft');
    return {
      opacity: isPending ? 0.6 : 1,
      backgroundColor: [wash, wash, 'var(--surface-raised)'],
      transition: { duration: seconds(duration.slow), times: [0, 0.22, 1] },
    };
  }

  return (
    <div className={cn('w-full overflow-x-auto rounded-xl border border-border', className)}>
      <table
        className="w-full border-collapse bg-surface-raised"
        {...(interactive ? { role: 'grid' } : {})}
        aria-busy={pending}
      >
        <caption
          className={cn(
            'type-label px-3 py-2 text-left text-content-muted',
            showCaption ? undefined : 'sr-only',
          )}
        >
          {caption}
        </caption>

        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => {
              const sorted = sort?.columnId === column.id;
              const align = ALIGN[column.align ?? 'start'];
              return (
                <th
                  key={column.id}
                  scope="col"
                  style={{ width: column.width }}
                  aria-sort={
                    sorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                  className={cn(
                    'type-label bg-surface-sunken font-medium text-content-muted',
                    headPad,
                    align,
                    column.secondary === true ? 'hidden md:table-cell' : undefined,
                  )}
                >
                  {column.sortable === true && onSortChange !== undefined ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSortChange({
                          columnId: column.id,
                          direction: nextDirection(sort, column.id),
                        })
                      }
                      className="focus-ring-inset inline-flex items-center gap-1 hover:text-content"
                    >
                      {column.header}
                      {sorted ? (
                        sort.direction === 'asc' ? (
                          <ChevronUp size={14} aria-hidden />
                        ) : (
                          <ChevronDown size={14} aria-hidden />
                        )
                      ) : (
                        <ChevronDown size={14} className="opacity-30" aria-hidden />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody ref={body}>
          {error !== undefined ? (
            <tr>
              <td colSpan={span} className="p-3">
                {error}
              </td>
            </tr>
          ) : pending ? (
            Array.from({ length: skeletonRows }, (_unused, index) => (
              <tr key={index} className="border-b border-border last:border-0">
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      cellPad,
                      column.secondary === true ? 'hidden md:table-cell' : undefined,
                    )}
                  >
                    <Skeleton variant="text" width={column.align === 'end' ? '40%' : '70%'} />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={span} className="p-3">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const key = rowKey(row);
              const tone = rowTone?.(row);
              const isPending = rowPending?.(row) === true;

              return (
                <motion.tr
                  key={key}
                  animate={rowTarget(row, key)}
                  tabIndex={interactive ? (index === focusRow ? 0 : -1) : undefined}
                  aria-busy={isPending || undefined}
                  onClick={interactive ? () => onRowActivate?.(row) : undefined}
                  onKeyDown={(event) => onRowKeyDown(event, row, index)}
                  onFocus={() => setFocusRow(index)}
                  className={cn(
                    'border-b border-border last:border-0',
                    interactive
                      ? 'focus-ring-inset cursor-pointer hover:bg-surface-sunken'
                      : undefined,
                  )}
                >
                  {columns.map((column, columnIndex) => (
                    <td
                      key={column.id}
                      className={cn(
                        'type-body relative text-content',
                        cellPad,
                        ALIGN[column.align ?? 'start'],
                        column.secondary === true ? 'hidden md:table-cell' : undefined,
                      )}
                    >
                      {columnIndex === 0 && tone !== undefined ? (
                        <span
                          className={cn(
                            'absolute inset-y-0 left-0 w-1',
                            toneMarkClass[tone],
                          )}
                          aria-hidden
                        />
                      ) : null}
                      {column.cell(row)}
                    </td>
                  ))}
                </motion.tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

