'use client';

import { motion, type HTMLMotionProps } from 'framer-motion';
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { Spinner } from '../internal/Spinner.js';
import { controlVariants } from '../motion/transitions.js';
import { useMotion } from '../motion/useMotion.js';
import type { ButtonSize, ButtonVariant } from './Button.js';

type MotionButtonProps = Omit<
  HTMLMotionProps<'button'>,
  'variants' | 'initial' | 'whileHover' | 'whileTap' | 'children'
>;

export interface IconButtonProps extends MotionButtonProps {
  /** Required. An icon with no name is a button nobody can describe over the phone. */
  readonly label: string;
  readonly icon: ReactNode;
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly pending?: boolean | undefined;
}

const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-accent text-accent-on border-accent hover:bg-accent-hover',
  secondary: 'bg-surface-raised text-content border-border hover:bg-surface-sunken',
  ghost: 'bg-transparent text-content-muted border-transparent hover:bg-surface-sunken',
  danger: 'bg-critical-soft text-critical border-critical-border hover:bg-critical hover:text-critical-on',
};

/** Square, and never below 40px where a finger is involved. */
const SIZE: Readonly<Record<ButtonSize, string>> = {
  sm: 'size-8 rounded-md',
  md: 'size-10 rounded-lg',
  lg: 'size-12 rounded-lg',
  kiosk: 'size-16 rounded-xl',
};
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  pending = false,
  disabled = false,
  type = 'button',
  className,
  onClick,
  ...rest
}: IconButtonProps): ReactNode {
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
      aria-label={label}
      title={label}
      aria-busy={pending}
      aria-disabled={pending || disabled}
      onClick={handleClick}
      variants={controlVariants(motionTokens)}
      initial="rest"
      {...(disabled || pending ? {} : { whileHover: 'hover', whileTap: 'press' })}
      className={cn(
        'focus-ring inline-flex shrink-0 items-center justify-center border',
        'transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {pending ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon}
    </motion.button>
  );
}
