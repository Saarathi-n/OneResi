'use client';

import { motion } from 'framer-motion';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { codeRevealVariants } from '../motion/transitions.js';
import { useMotion } from '../motion/useMotion.js';
import { IconButton } from './IconButton.js';
import { Skeleton } from './Skeleton.js';

/**
 * A code a person has to read out or type in: the gate pass code, a receipt number.
 *
 * Monospaced and tabular so the digits line up, revealed one character at a time so the code
 * registers as something that was just issued, and spelled out digit by digit for a reader,
 * because "one two three" is what someone repeats down a phone.
 */
export interface CodeDisplayProps {
  readonly code: string;
  /** What the code is for. Announced before it. */
  readonly label?: string | undefined;
  readonly size?: 'md' | 'kiosk' | undefined;
  readonly copyable?: boolean | undefined;
  readonly pending?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

export function CodeDisplay({
  code,
  label,
  size = 'md',
  copyable = true,
  pending = false,
  disabled = false,
  className,
}: CodeDisplayProps): ReactNode {
  const motionTokens = useMotion();
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    if (disabled || pending) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard access can be refused. The code is on screen either way, so there is nothing
         to recover from and nothing worth interrupting the reader about. */
      setCopied(false);
    }
  }

  if (pending) {
    return (
      <div className={cn('flex flex-col gap-2', className)} aria-busy>
        {label !== undefined ? <span className="type-label text-content-subtle">{label}</span> : null}
        <Skeleton height={size === 'kiosk' ? 72 : 48} width="60%" />
      </div>
    );
  }
  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        disabled ? 'opacity-55' : undefined,
        className,
      )}
    >
      {label !== undefined ? (
        <span className="type-label text-content-subtle">{label}</span>
      ) : null}

      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex items-center gap-1 rounded-xl border border-border bg-surface-sunken',
            size === 'kiosk' ? 'px-5 py-3' : 'px-3 py-2',
          )}
        >
          {/* Read out as separate characters, which is how a code is repeated aloud. */}
          <span className="sr-only">
            {label === undefined ? code.split('').join(' ') : `${label}: ${code.split('').join(' ')}`}
          </span>

          {code.split('').map((character, index) => (
            <motion.span
              key={`${index}:${character}`}
              aria-hidden
              custom={index}
              variants={codeRevealVariants(motionTokens)}
              initial="hidden"
              animate="shown"
              className={cn(
                'inline-block text-content',
                size === 'kiosk' ? 'type-code-kiosk' : 'type-code',
              )}
            >
              {character}
            </motion.span>
          ))}
        </div>

        {copyable ? (
          <IconButton
            label={copied ? 'Copied' : 'Copy the code'}
            variant="secondary"
            size={size === 'kiosk' ? 'lg' : 'md'}
            disabled={disabled}
            icon={copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            onClick={() => {
              void copy();
            }}
          />
        ) : null}
      </div>

      <span className="sr-only" aria-live="polite">
        {copied ? 'Code copied' : ''}
      </span>
    </div>
  );
}

