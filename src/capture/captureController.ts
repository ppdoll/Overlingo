import type { NormRect } from '../core/types';
import type { FromWorker, GateConfig, ToWorker } from './protocol';

export function frameProcessingSupported(): boolean {
  return typeof MediaStreamTrackProcessor !== 'undefined';
}

/** Hands a capture stream's frames to the capture worker and relays what it reports. */
export class CaptureController {
  onFrame: (image: Blob, forced: boolean) => void = () => {};
  onStats: (fps: number) => void = () => {};
  onEnded: () => void = () => {};
  onError: (message: string) => void = () => {};

  private readonly worker: Worker;
  private ended = false;

  constructor(
    readonly stream: MediaStream,
    gate: GateConfig,
  ) {
    const [track] = stream.getVideoTracks();
    // Only the newest frame matters; older ones are dropped instead of queued.
    const processor = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 });
    this.worker = new Worker(new URL('./captureWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<FromWorker>) => this.handle(data);
    this.worker.onerror = (event) => this.onError(event.message);
    this.post({ type: 'start', readable: processor.readable, gate, region: null }, [processor.readable]);
    // Fired when the user presses the browser's own "stop sharing" button.
    track.addEventListener('ended', () => this.end());
  }

  setRegion(region: NormRect | null): void {
    this.post({ type: 'region', region });
  }

  setGate(gate: GateConfig): void {
    this.post({ type: 'gate', gate });
  }

  /** Reads the region on the next frame even if nothing changed. */
  grab(): void {
    this.post({ type: 'grab' });
  }

  stop(): void {
    this.ended = true;
    this.post({ type: 'stop' });
    this.worker.terminate();
    for (const track of this.stream.getTracks()) track.stop();
  }

  private handle(message: FromWorker) {
    switch (message.type) {
      case 'frame':
        this.onFrame(message.image, message.forced);
        break;
      case 'stats':
        this.onStats(message.fps);
        break;
      case 'ended':
        this.end();
        break;
      case 'error':
        this.onError(message.message);
        break;
    }
  }

  private end() {
    if (this.ended) return;
    this.ended = true;
    this.onEnded();
  }

  private post(message: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }
}
