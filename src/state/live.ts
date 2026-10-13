import type { Align, Rect } from '../core/types';

export interface LiveLine {
  id: number;
  at: number;
  source: string;
  /** null while the translation is in flight. */
  translated: string | null;
  failed?: boolean;
  /** Chat only: which side of the chat the message was on. */
  align?: Align;
}

/** A chat message on screen right now, with where it sits in the snapshot. */
export interface LayoutUnit {
  source: string;
  box: Rect;
  align: Align;
  translated: string | null;
  failed: boolean;
}

/** The chat region as last read, for showing each bubble next to its translation. */
export interface ChatLayout {
  imageUrl: string | null;
  width: number;
  height: number;
  units: LayoutUnit[];
}

export interface LiveStats {
  lines: number;
  batches: number;
  avgLatencyMs: number;
  cacheHits: number;
  lookups: number;
  costUsd: number;
  fps: number;
  ocrMs: number;
}

export interface LiveState {
  status: 'idle' | 'running' | 'paused';
  /** Everything translated this session, newest last. */
  lines: LiveLine[];
  /** The subtitle on screen right now. */
  subtitle: LiveLine | null;
  /** The chat messages on screen right now. */
  layout: ChatLayout | null;
  stats: LiveStats;
  notice: string | null;
  downloadNeeded: { source: string; target: string } | null;
}

export const MAX_HISTORY = 200;

export const initialLiveState: LiveState = {
  status: 'idle',
  lines: [],
  subtitle: null,
  layout: null,
  stats: { lines: 0, batches: 0, avgLatencyMs: 0, cacheHits: 0, lookups: 0, costUsd: 0, fps: 0, ocrMs: 0 },
  notice: null,
  downloadNeeded: null,
};
