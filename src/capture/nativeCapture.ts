import type { NormRect } from '../core/types';
import { captureRegion, type ScreenRect } from '../platform/desktop';
import type { FrameSource } from './frameSource';
import type { CapturedFrame, FromWorker, GateConfig, ToWorker } from './protocol';

/** On the desktop the region is cut out natively, so the whole image is the region. */
const WHOLE_IMAGE: NormRect = { x: 0, y: 0, w: 1, h: 1 };
const RETRY_MS = 1000;

/**
 * Desktop: captures a screen region natively and feeds it to the capture worker. The wait
 * between captures happens on the native side, so capture keeps pace while the window is
 * minimized, when the webview's own timers are throttled.
 */
export class NativeCapture implements FrameSource {
  onFrame: (frame: CapturedFrame, forced: boolean) => void = () => {};
  onStats: (fps: number) => void = () => {};
  onMotion: () => void = () => {};
  onEnded: () => void = () => {};
  onError: (message: string) => void = () => {};

  private readonly worker: Worker;
  private running = true;
  private processed: (() => void) | null = null;

  constructor(
    private screenRegion: ScreenRect,
    private gate: GateConfig,
  ) {
    this.worker = new Worker(new URL('./captureWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<FromWorker>) => this.handle(data);
    this.worker.onerror = (event) => this.onError(event.message);
    this.post({ type: 'start-images', gate, region: WHOLE_IMAGE });
    void this.loop();
  }

  get region(): ScreenRect {
    return this.screenRegion;
  }

  setScreenRegion(region: ScreenRect): void {
    this.screenRegion = region;
    this.post({ type: 'region', region: WHOLE_IMAGE });
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
      try {
        const image = await captureRegion(this.screenRegion, wait);
        if (!this.running) return;
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
