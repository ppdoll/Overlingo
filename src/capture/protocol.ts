import type { GateOptions } from '../core/changeDetect';
import type { Mode, NormRect, Rect } from '../core/types';

export interface GateConfig extends GateOptions {
  /** Minimum time between two looks at the region. */
  intervalMs: number;
  /** Also find chat bubbles and keep a picture of the region, for showing translations next to them. */
  layout: boolean;
}

/**
 * Subtitles sit on moving video and never settle, so they're read on a short fixed cadence.
 * Chat windows are static between messages, so they're read once a change has settled.
 */
export const GATE_PRESETS: Record<Mode, GateConfig> = {
  subtitle: { intervalMs: 100, threshold: 0.02, stableMs: 200, maxWaitMs: 700, layout: false },
  chat: { intervalMs: 150, threshold: 0.008, stableMs: 300, maxWaitMs: 1500, layout: true },
};

/** A look at the region worth running OCR on. Coordinates are in the pixels of `image`. */
export interface CapturedFrame {
  /** Cleaned up for OCR. */
  image: Blob;
  /** The region as it looks on screen (layout mode only). */
  snapshot: Blob | null;
  width: number;
  height: number;
  /** Chat bubbles found in the region (layout mode only). */
  bubbles: Rect[];
}

export type ToWorker =
  | { type: 'start'; readable: ReadableStream<VideoFrame>; gate: GateConfig; region: NormRect | null }
  | { type: 'region'; region: NormRect | null }
  | { type: 'gate'; gate: GateConfig }
  | { type: 'grab' }
  | { type: 'stop' };

export type FromWorker =
  | { type: 'frame'; frame: CapturedFrame; forced: boolean }
  | { type: 'stats'; fps: number; width: number; height: number }
  | { type: 'ended' }
  | { type: 'error'; message: string };
