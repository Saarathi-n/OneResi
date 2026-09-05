'use client';

import { motion, type HTMLMotionProps } from 'framer-motion';
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { Spinner } from '../internal/Spinner.js';
import { controlVariants } from '../motion/transitions.js';
import { useMotion } from '../motion/useMotion.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** `sm` is for the dense desk only. Everything a thumb touches is `md` or larger. */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'kiosk';

type MotionButtonProps = Omit<
  HTMLMotionProps<'button'>,
  'variants' | 'initial' | 'whileHover' | 'whileTap' | 'children'
>;

export interface ButtonProps extends MotionButtonProps {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  /**
   * Waiting on the server. The control keeps focus and stays announced, and the click is
   * swallowed rather than the button being disabled, so a submission cannot be sent twice and
   * the keyboard does not lose its place mid-request.
   */
  readonly pending?: boolean | undefined;
  /** What a screen reader hears while pending. */
  readonly pendingLabel?: string | undefined;
  readonly leadingIcon?: ReactNode | undefined;
  readonly trailingIcon?: ReactNode | undefined;
  readonly fullWidth?: boolean | undefined;
  readonly children?: ReactNode | undefined;
}

const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-accent text-accent-on border-accent hover:bg-accent-hover',
  secondary: 'bg-surface-raised text-content border-border-strong hover:bg-surface-sunken',
  ghost: 'bg-transparent text-content border-transparent hover:bg-surface-sunken',
  danger: 'bg-critical text-critical-on border-critical hover:bg-critical-hover',
};

const SIZE: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-8 px-3 gap-1.5 type-label rounded-md',
  md: 'h-11 px-4 gap-2 type-body rounded-lg',
  lg: 'h-12 px-5 gap-2 type-body rounded-lg',
  kiosk: 'h-16 px-8 gap-3 type-title rounded-xl',
};
export function Button({
  variant = 'primary',
  size = 'md',
  pending = false,
  pendingLabel = 'Working',
  leadingIcon,
  trailingIcon,
  fullWidth = false,
  disabled = false,
  type = 'button',
  className,
  children,
  onClick,
  ...rest
}: ButtonProps): ReactNode {
  const motionTokens = useMotion();

  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    if (pending) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <motion.button
      type={type}
      disabled={disabled}
      aria-busy={pending}
      aria-disabled={pending || disabled}
      onClick={handleClick}
      variants={controlVariants(motionTokens)}
      initial="rest"
      whileHover={disabled || pending ? undefined : 'hover'}
      whileTap={disabled || pending ? undefined : 'press'}
      className={cn(
        'focus-ring relative inline-flex select-none items-center justify-center border font-medium',
        'transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANT[variant],
        SIZE[size],
        fullWidth ? 'w-full' : undefined,
        pending ? 'cursor-progress' : undefined,
        className,
      )}
      {...rest}
    >
      {pending ? <Spinner /> : leadingIcon}
      <span className={pending ? 'opacity-80' : undefined}>{children}</span>
      {pending ? <span className="sr-only">{pendingLabel}</span> : trailingIcon}
    </motion.button>
  );
}
