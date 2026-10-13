import type { NormRect } from '../core/types';
import type { CapturedFrame, GateConfig } from './protocol';

/**
 * Where frames come from: a browser screen share (StreamCapture) or the desktop app's native
 * capture (NativeCapture). Both run the same worker, so the rest of the app can't tell them apart.
 */
export interface FrameSource {
  onFrame: (frame: CapturedFrame, forced: boolean) => void;
  onStats: (fps: number) => void;
  /** The region started changing, so anything drawn at the old positions is out of date. */
  onMotion: () => void;
  /** The region settled back to how it looked when last read, so what's drawn is right again. */
  onStill: () => void;
  onEnded: () => void;
  onError: (message: string) => void;
  setRegion(region: NormRect | null): void;
  setGate(gate: GateConfig): void;
  /** Reads the region on the next frame even if nothing changed. */
  grab(): void;
  stop(): void;
}
