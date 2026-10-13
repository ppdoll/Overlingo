// Reads video frames off the main thread. A stream-driven loop keeps running when the tab is in
// the background, where timers would be throttled to once a second or less.
import { StabilityGate, toGray } from '../core/changeDetect';
import { toPixelRect } from '../core/geometry';
import { prepareForOcr } from '../core/preprocess';
import type { NormRect, Rect } from '../core/types';
import type { FromWorker, GateConfig, ToWorker } from './protocol';

const scope = self as unknown as {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

const SIGNATURE_WIDTH = 96;
const MAX_OCR_WIDTH = 3000;

let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
let region: NormRect | null = null;
let gateConfig: GateConfig | null = null;
let gate: StabilityGate | null = null;
let grabRequested = false;
let lastLook = 0;
let signatureCanvas: OffscreenCanvas | null = null;

scope.onmessage = ({ data: message }) => {
  switch (message.type) {
    case 'start':
      setGate(message.gate);
      region = message.region;
      void pump(message.readable);
      break;
    case 'region':
      region = message.region;
      gate?.reset();
      break;
    case 'gate':
      setGate(message.gate);
      break;
    case 'grab':
      grabRequested = true;
      break;
    case 'stop':
      void reader?.cancel();
      reader = null;
      break;
  }
};

function setGate(config: GateConfig) {
  gateConfig = config;
  gate = new StabilityGate(config);
}

async function pump(readable: ReadableStream<VideoFrame>) {
  const current = readable.getReader();
  reader = current;
  let frames = 0;
  let statsSince = performance.now();
  try {
    for (;;) {
      const { value: frame, done } = await current.read();
      if (done) break;
      try {
        frames++;
        const now = performance.now();
        if (now - statsSince >= 1000) {
          const fps = Math.round((frames * 1000) / (now - statsSince));
          scope.postMessage({ type: 'stats', fps, width: frame.displayWidth, height: frame.displayHeight });
          frames = 0;
          statsSince = now;
        }
        if (!region || !gate || !gateConfig) continue;
        if (!grabRequested && now - lastLook < gateConfig.intervalMs) continue;
        lastLook = now;

        const crop = toPixelRect(region, frame.displayWidth, frame.displayHeight);
        if (crop.w < 4 || crop.h < 4) continue;
        const forced = grabRequested;
        grabRequested = false;
        const changed = gate.push(signature(frame, crop), now);
        if (changed || forced) {
          scope.postMessage({ type: 'frame', image: await renderForOcr(frame, crop), forced });
        }
      } finally {
        frame.close();
      }
    }
    scope.postMessage({ type: 'ended' });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

/** A small grayscale thumbnail of the region: cheap to compare every frame. */
function signature(frame: VideoFrame, crop: Rect): Uint8Array {
  const width = SIGNATURE_WIDTH;
  const height = Math.max(8, Math.min(96, Math.round((SIGNATURE_WIDTH * crop.h) / crop.w)));
  if (!signatureCanvas || signatureCanvas.width !== width || signatureCanvas.height !== height) {
    signatureCanvas = new OffscreenCanvas(width, height);
  }
  const ctx = signatureCanvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(frame, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
  return toGray(ctx.getImageData(0, 0, width, height).data);
}

/** The region scaled up so small screen text is legible to Tesseract, then cleaned up. */
async function renderForOcr(frame: VideoFrame, crop: Rect): Promise<Blob> {
  const scale = crop.h < 80 ? 2.5 : crop.h < 200 ? 2 : crop.h < 400 ? 1.5 : 1;
  const width = Math.min(MAX_OCR_WIDTH, Math.round(crop.w * scale));
  const height = Math.round((crop.h * width) / crop.w);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(frame, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  prepareForOcr(image);
  ctx.putImageData(image, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
