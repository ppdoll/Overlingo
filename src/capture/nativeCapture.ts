import { anchorTo, placeIn, type AnchorStyle, type WindowAnchor } from '../core/anchor';
import type { NormRect, Rect } from '../core/types';
import { captureRegion, windowState, type PickedWindow, type ScreenRect } from '../platform/desktop';
import type { FrameSource } from './frameSource';
import type { CapturedFrame, FromWorker, GateConfig, ToWorker } from './protocol';

/** On the desktop the region is cut out natively, so the whole image is the region. */
const WHOLE_IMAGE: NormRect = { x: 0, y: 0, w: 1, h: 1 };
const RETRY_MS = 1000;
/** How often to look again while the followed window is minimized or covered. */
const HIDDEN_POLL_MS = 500;
/** Covered past this share, the region mostly shows another app, so reading pauses. */
const MAX_COVERED = 0.4;

/** What to read: a fixed spot on screen, or part of a window, wherever that window goes. */
export type CaptureTarget =
  | { kind: 'region'; region: ScreenRect }
  | { kind: 'window'; window: PickedWindow; anchor: WindowAnchor };

/** Whether the followed window can be read right now. */
export type TargetVisibility = 'visible' | 'minimized' | 'covered';

/**
 * Desktop: captures a screen region natively and feeds it to the capture worker. A region of a
 * picked window follows the window when it moves or is resized, and isn't read while the
 * window is minimized or covered by another app. The wait between captures happens on the
 * native side, so capture keeps pace while this window is minimized, when the webview's own
 * timers are throttled.
 */
export class NativeCapture implements FrameSource {
  onFrame: (frame: CapturedFrame, forced: boolean) => void = () => {};
  onStats: (fps: number) => void = () => {};
  onMotion: () => void = () => {};
  onStill: () => void = () => {};
  onEnded: () => void = () => {};
  onError: (message: string) => void = () => {};
  /** The region moved on screen, because its window moved or was resized. */
  onRegion: (region: ScreenRect, resized: boolean) => void = () => {};
  onVisibility: (visibility: TargetVisibility) => void = () => {};
  /** The followed window was closed. Capture has stopped. */
  onTargetGone: () => void = () => {};

  private readonly worker: Worker;
  private running = true;
  private processed: (() => void) | null = null;
  private current: ScreenRect;
  private visibility: TargetVisibility = 'visible';

  constructor(
    private target: CaptureTarget,
    private gate: GateConfig,
  ) {
    this.current = startOf(target);
    this.worker = new Worker(new URL('./captureWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<FromWorker>) => this.handle(data);
    this.worker.onerror = (event) => this.onError(event.message);
    this.post({ type: 'start-images', gate, region: WHOLE_IMAGE });
    void this.loop();
  }

  /** Where the region is on screen now. */
  get region(): ScreenRect {
    return this.current;
  }

  setTarget(target: CaptureTarget): void {
    this.target = target;
    this.current = startOf(target);
    this.visibility = 'visible';
    this.post({ type: 'region', region: WHOLE_IMAGE });
  }

  /** Chat and subtitle regions follow a resized window differently (see core/anchor.ts). */
  setAnchorStyle(style: AnchorStyle): void {
    const target = this.target;
    if (target.kind !== 'window') return;
    this.target = { ...target, anchor: anchorTo(target.anchor.region, target.anchor.window, style) };
  }

  /** The region itself is picked on screen; null pauses reading and anything else resumes it. */
  setRegion(region: NormRect | null): void {
    this.post({ type: 'region', region: region ? WHOLE_IMAGE : null });
  }

  setGate(gate: GateConfig): void {
    this.gate = gate;
    this.post({ type: 'gate', gate });
  }

  grab(): void {
    this.post({ type: 'grab' });
  }

  stop(): void {
    this.running = false;
    this.worker.terminate();
    this.processed?.();
  }

  private async loop() {
    let wait = 0;
    while (this.running) {
      const target = this.target;
      try {
        const following = target.kind === 'window';
        const region = following ? await this.follow(target, wait) : target.region;
        if (!this.running) return;
        if (this.target !== target) {
          wait = 0;
          continue;
        }
        if (!region) {
          wait = HIDDEN_POLL_MS;
          continue;
        }
        const image = await captureRegion(region, following ? 0 : wait, following ? target.window.id : undefined);
        if (!this.running) return;
        if (this.target !== target) continue;
        if (image.covered > MAX_COVERED) {
          this.setVisibility('covered');
          wait = HIDDEN_POLL_MS;
          continue;
        }
        this.setVisibility('visible');
        await new Promise<void>((resolve) => {
          this.processed = resolve;
          const { buffer, offset, width, height } = image;
          this.post({ type: 'image', buffer, offset, width, height }, [buffer]);
        });
        wait = this.gate.intervalMs;
      } catch (error) {
        if (!this.running) return;
        this.onError(error instanceof Error ? error.message : String(error));
        wait = RETRY_MS;
      }
    }
  }

  /**
   * Waits `wait` ms natively, then works out where the followed window's region is now.
   * Null while the window can't be read.
   */
  private async follow(target: Extract<CaptureTarget, { kind: 'window' }>, wait: number): Promise<ScreenRect | null> {
    const state = await windowState(target.window.id, wait);
    if (!this.running || this.target !== target) return null;
    if (state.state === 'gone') {
      this.stop();
      this.onTargetGone();
      return null;
    }
    if (state.state === 'hidden') {
      this.setVisibility('minimized');
      return null;
    }
    const placed = toScreenRect(placeIn(target.anchor, toRect(state.rect)));
    if (!sameRect(placed, this.current)) {
      const resized = placed.width !== this.current.width || placed.height !== this.current.height;
      this.current = placed;
      this.onRegion(placed, resized);
    }
    return placed;
  }

  private setVisibility(visibility: TargetVisibility) {
    if (visibility === this.visibility) return;
    // Back in view: read it right away, even if it looks the same as before.
    if (visibility === 'visible') this.post({ type: 'grab' });
    this.visibility = visibility;
    this.onVisibility(visibility);
  }

  private handle(message: FromWorker) {
    switch (message.type) {
      case 'frame':
        this.onFrame(message.frame, message.forced);
        break;
      case 'stats':
        this.onStats(message.fps);
        break;
      case 'motion':
        this.onMotion();
        break;
      case 'still':
        this.onStill();
        break;
      case 'processed': {
        const done = this.processed;
        this.processed = null;
        done?.();
        break;
      }
      case 'error':
        this.onError(message.message);
        break;
      case 'ended':
        break;
    }
  }

  private post(message: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }
}

/** Builds what to follow from what the user picked. */
export function targetFor(region: ScreenRect, window: PickedWindow | null, style: AnchorStyle): CaptureTarget {
  if (!window) return { kind: 'region', region };
  return { kind: 'window', window, anchor: anchorTo(toRect(region), toRect(window.rect), style) };
}

function startOf(target: CaptureTarget): ScreenRect {
  return target.kind === 'region' ? target.region : toScreenRect(target.anchor.region);
}

function toRect(rect: ScreenRect): Rect {
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
}

function toScreenRect(rect: Rect): ScreenRect {
  return { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
}

function sameRect(a: ScreenRect, b: ScreenRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
