'use client';

import { useEffect, useState } from 'react';
import { onChange } from '../lib/replay-queue';
import type { queueSnapshot } from '../lib/replay-queue';

/** The queue, reactively, for the row-level "waiting to send" state and the shell's badge. */
export function useReplayQueue(): ReturnType<typeof queueSnapshot> {
  const [queue, setQueue] = useState<ReturnType<typeof queueSnapshot>>([]);
  useEffect(() => onChange(setQueue), []);
  return queue;
}
