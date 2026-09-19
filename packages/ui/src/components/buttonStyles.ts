import { cn } from '../internal/cn.js';
import type { ButtonSize, ButtonVariant } from './Button.js';

/**
 * The button's look, without the button's machinery.
 *
 * `buttonClass` exists for the one place a link must look like a button: a real anchor carrying
 * these classes, never a button nested inside one — interactive content inside interactive content
 * is invalid HTML and a hydration warning (D-84). Everything the Button component adds on top
 * (motion, pending, icons) is interaction, which a link does not want; the look is the shared part.
 *
 * This module deliberately carries no `use client`: the classes are a pure string computation, and
 * the pages that need them — the marketing landing, the auth screens — are server components that
 * may not call into a client module.
 */

const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-accent text-accent-on border-accent hover:bg-accent-hover',
  secondary: 'bg-surface-raised text-content border-border-strong hover:bg-surface-sunken',
  ghost: 'bg-transparent text-content border-transparent hover:bg-surface-sunken',
  danger: 'bg-critical text-critical-on border-critical hover:bg-critical-hover',
};

/** Actions are pills at every size — the curve is the identity, not a per-size decision. Pills
 * carry a step more horizontal padding than a cornered button would, so labels keep their air
 * where the ends round away. */
const SIZE: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-8 px-3.5 gap-1.5 type-label rounded-pill',
  md: 'h-11 px-5 gap-2 type-body rounded-pill',
  lg: 'h-12 px-6 gap-2 type-body rounded-pill',
  kiosk: 'h-16 px-10 gap-3 type-title rounded-pill',
};

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(
    'focus-ring relative inline-flex select-none items-center justify-center border font-medium',
    'transition-colors duration-150',
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

/** The tables above, for the Button component to render with — one source of truth. */
export const BUTTON_VARIANT_CLASS = VARIANT;
export const BUTTON_SIZE_CLASS = SIZE;
