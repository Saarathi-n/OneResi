'use client';

import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { Spinner } from '../internal/Spinner.js';
import { useControllable } from '../internal/useControllable.js';
import { tabPanelVariants, tabUnderlineTransition } from '../motion/transitions.js';
import { useMotion } from '../motion/useMotion.js';

/**
 * A tab strip with the underline as a shared layout animation, so it slides from the old tab to
 * the new one instead of blinking between two positions.
 *
 * Controlled by preference: in the applications the value comes from the URL, because thirteen
 * tabs held in component state is thirteen screens nobody can link to.
 */
export interface TabItem {
  readonly value: string;
  /** What a person reads. Pass the descriptor label for anything enumerated. */
  readonly label: string;
  readonly icon?: ReactNode | undefined;
  /** A count beside the label — unread notices, waiting approvals. */
  readonly badge?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  readonly pending?: boolean | undefined;
}

export interface TabsProps {
  readonly items: readonly TabItem[];
  readonly value?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly onValueChange?: ((value: string) => void) | undefined;
  /** Names the strip. Two tab strips on one screen need two names. */
  readonly label: string;
  readonly size?: 'md' | 'lg' | undefined;
  /**
   * `underline` is the document idiom for wide screens; `pill` is the segmented control a
   * narrow phone column wants — a sunken track with the selection as a sliding capsule.
   */
  readonly variant?: 'underline' | 'pill' | undefined;
  readonly className?: string | undefined;
  /** The panel for the current value. Rendered inside a `tabpanel` and cross-faded on change. */
  readonly children?: ReactNode | undefined;
}

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  label,
  size = 'md',
  variant = 'underline',
  className,
  children,
}: TabsProps): ReactNode {
  const base = useId();
  const motionTokens = useMotion();
  const strip = useRef<HTMLDivElement>(null);
  const first = items[0]?.value ?? '';
  const [active, setActive] = useControllable(value, defaultValue ?? first, onValueChange);
  const pill = variant === 'pill';

  const enabled = items.filter((item) => item.disabled !== true);

  function move(offset: number): void {
    if (enabled.length === 0) return;
    const current = enabled.findIndex((item) => item.value === active);
    const nextIndex = (current + offset + enabled.length) % enabled.length;
    const next = enabled[nextIndex];
    if (next === undefined) return;
    setActive(next.value);
    strip.current?.querySelector<HTMLElement>(`[data-tab="${next.value}"]`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        move(1);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        move(-1);
        return;
      case 'Home': {
        event.preventDefault();
        const head = enabled[0];
        if (head !== undefined) setActive(head.value);
        return;
      }
      case 'End': {
        event.preventDefault();
        const tail = enabled[enabled.length - 1];
        if (tail !== undefined) setActive(tail.value);
        return;
      }
      default:
        return;
    }
  }
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <LayoutGroup id={base}>
        <div
          ref={strip}
          role="tablist"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={cn(
            'flex gap-1 overflow-x-auto',
            pill ? 'rounded-full bg-surface-sunken p-1' : 'border-b border-border',
          )}
        >
          {items.map((item) => {
            const selected = item.value === active;
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                data-tab={item.value}
                id={`${base}-tab-${item.value}`}
                aria-selected={selected}
                aria-controls={`${base}-panel-${item.value}`}
                aria-busy={item.pending}
                disabled={item.disabled}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(item.value)}
                className={cn(
                  'focus-ring-inset relative flex shrink-0 items-center justify-center gap-2 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
                  pill ? 'min-h-9 rounded-full px-3.5 py-1.5' : 'px-3 pb-2.5 pt-2',
                  size === 'lg' ? 'type-body' : 'type-label',
                  selected ? 'text-content' : 'text-content-muted hover:text-content',
                )}
              >
                {pill && selected ? (
                  <motion.span
                    layoutId="tab-segment"
                    transition={tabUnderlineTransition(motionTokens)}
                    className="absolute inset-0 rounded-full bg-surface shadow-e1"
                    aria-hidden
                  />
                ) : null}
                <span className="relative inline-flex items-center gap-2">
                  {item.pending === true ? <Spinner size={14} /> : item.icon}
                  <span>{item.label}</span>
                  {item.badge !== undefined ? (
                    <span className="type-micro rounded-pill bg-surface-sunken px-1.5 py-0.5 text-content-muted">
                      {item.badge}
                    </span>
                  ) : null}
                </span>
                {!pill && selected ? (
                  <motion.span
                    layoutId="tab-underline"
                    transition={tabUnderlineTransition(motionTokens)}
                    className="absolute inset-x-1 -bottom-px h-0.5 rounded-pill bg-accent"
                    aria-hidden
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </LayoutGroup>
      {children === undefined ? null : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            id={`${base}-panel-${active}`}
            role="tabpanel"
            aria-labelledby={`${base}-tab-${active}`}
            tabIndex={0}
            variants={tabPanelVariants(motionTokens)}
            initial="hidden"
            animate="shown"
            exit="exit"
            className="focus-ring-inset"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

