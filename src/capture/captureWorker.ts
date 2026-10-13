// Reads video frames off the main thread. A stream-driven loop keeps running when the tab is in
// the background, where timers would be throttled to once a second or less.
import { findBubbleRegions } from '../core/bubbles';
import { StabilityGate, toGray } from '../core/changeDetect';
import { toPixelRect } from '../core/geometry';
import { prepareForOcr } from '../core/preprocess';
import type { NormRect, Rect } from '../core/types';
import type { CapturedFrame, FromWorker, GateConfig, ToWorker } from './protocol';

const scope = self as unknown as {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

const SIGNATURE_WIDTH = 96;
/** Screen text is small; scaling the region to about this width makes it legible to Tesseract. */
const OCR_TARGET_WIDTH = 1400;
const MAX_OCR_SCALE = 2.5;
/** Bigger images make OCR slow without helping. */
const MAX_OCR_PIXELS = 3_200_000;

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
          scope.postMessage({ type: 'frame', frame: await capture(frame, crop, gateConfig.layout), forced });
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

/**
 * The region scaled so small screen text is legible to Tesseract, then cleaned up for OCR.
 * In layout mode the untouched picture and the chat bubbles in it come along too.
 */
async function capture(frame: VideoFrame, crop: Rect, layout: boolean): Promise<CapturedFrame> {
  const scale = Math.min(
    MAX_OCR_SCALE,
    Math.max(1, OCR_TARGET_WIDTH / crop.w),
    Math.sqrt(MAX_OCR_PIXELS / (crop.w * crop.h)),
  );
  const width = Math.max(1, Math.round(crop.w * scale));
  const height = Math.max(1, Math.round(crop.h * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(frame, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);

  // Both read the original colors, so they come before the OCR clean-up below.
  const bubbles = layout ? findBubbleRegions(image.data, width, height) : [];
  const snapshot = layout ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }) : null;

  prepareForOcr(image);
  ctx.putImageData(image, 0, 0);
  return { image: await canvas.convertToBlob({ type: 'image/png' }), snapshot, width, height, bubbles };
}
