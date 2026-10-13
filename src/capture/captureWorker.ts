// Looks at captured frames off the main thread: either a screen share stream (web) or raw images
// sent one by one (desktop). A stream-driven loop keeps running when the tab is in the
// background, where timers would be throttled to once a second or less.
import { anchorTo, placeIn, type WindowAnchor } from '../core/anchor';
import { findBubbleRegions, findInkRows } from '../core/bubbles';
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
/** The region pinned to the frame's edges when it was picked, for when the frame is resized. */
let anchored: { region: NormRect; anchor: WindowAnchor } | null = null;
let gateConfig: GateConfig | null = null;
let gate: StabilityGate | null = null;
let grabRequested = false;
let lastLook = 0;
let wasChanging = false;
let signatureCanvas: OffscreenCanvas | null = null;
let imageCanvas: OffscreenCanvas | null = null;
let frames = 0;
let statsSince = performance.now();

scope.onmessage = ({ data: message }) => {
  switch (message.type) {
    case 'start':
      setGate(message.gate);
      region = message.region;
      void pump(message.readable);
      break;
    case 'start-images':
      setGate(message.gate);
      region = message.region;
      break;
    case 'image':
      void lookAtImage(message.buffer, message.offset, message.width, message.height);
      break;
    case 'region':
      region = message.region;
      gate?.reset();
      break;
    case 'gate':
      setGate(message.gate);
      // Chat and subtitle regions follow a resized frame differently; keep the picked geometry.
      if (anchored) {
        const { region: picked, window: frame } = anchored.anchor;
        anchored = { ...anchored, anchor: anchorTo(picked, frame, message.gate.layout ? 'edges' : 'scale') };
      }
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
  try {
    for (;;) {
      const { value: frame, done } = await current.read();
      if (done) break;
      try {
        await look(frame, frame.displayWidth, frame.displayHeight, false);
      } finally {
        frame.close();
      }
    }
    scope.postMessage({ type: 'ended' });
  } catch (error) {
    reportError(error);
  }
}

/** Desktop frames are already cut to the region and paced natively, so each one is looked at. */
async function lookAtImage(buffer: ArrayBuffer, offset: number, width: number, height: number) {
  try {
    if (!imageCanvas || imageCanvas.width !== width || imageCanvas.height !== height) {
      imageCanvas = new OffscreenCanvas(width, height);
    }
    const pixels = new Uint8ClampedArray(buffer, offset, width * height * 4);
    imageCanvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
    await look(imageCanvas, width, height, true);
  } catch (error) {
    reportError(error);
  } finally {
    scope.postMessage({ type: 'processed' });
  }
}

async function look(source: CanvasImageSource, width: number, height: number, paced: boolean) {
  const now = performance.now();
  countFrame(width, height, now);
  if (!region || !gate || !gateConfig) return;
  if (!paced && !grabRequested && now - lastLook < gateConfig.intervalMs) return;
  lastLook = now;

  const crop = cropFor(region, gateConfig, width, height);
  if (crop.w < 4 || crop.h < 4) return;
  const forced = grabRequested;
  grabRequested = false;
  const changed = gate.push(signature(source, crop), now);
  if (gate.changing && !wasChanging) scope.postMessage({ type: 'motion' });
  if (!gate.changing && wasChanging && !changed) scope.postMessage({ type: 'still' });
  wasChanging = gate.changing;
  if (changed || forced) {
    scope.postMessage({ type: 'frame', frame: await capture(source, crop, gateConfig.layout), forced });
  }
}

/**
 * Where the region is in a frame of this size. A shared window that gets resized changes the
 * frame size; the region then follows the part of the window it was picked on, the same way
 * the desktop app follows a picked window.
 */
function cropFor(picked: NormRect, config: GateConfig, width: number, height: number): Rect {
  const frame = { x: 0, y: 0, w: width, h: height };
  if (anchored?.region !== picked) {
    anchored = { region: picked, anchor: anchorTo(toPixelRect(picked, width, height), frame, config.layout ? 'edges' : 'scale') };
  }
  return placeIn(anchored.anchor, frame);
}

function countFrame(width: number, height: number, now: number) {
  frames++;
  if (now - statsSince < 1000) return;
  scope.postMessage({ type: 'stats', fps: Math.round((frames * 1000) / (now - statsSince)), width, height });
  frames = 0;
  statsSince = now;
}

/** A small grayscale thumbnail of the region: cheap to compare every frame. */
function signature(source: CanvasImageSource, crop: Rect): Uint8Array {
  const width = SIGNATURE_WIDTH;
  const height = Math.max(8, Math.min(96, Math.round((SIGNATURE_WIDTH * crop.h) / crop.w)));
  if (!signatureCanvas || signatureCanvas.width !== width || signatureCanvas.height !== height) {
    signatureCanvas = new OffscreenCanvas(width, height);
  }
  const ctx = signatureCanvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
  return toGray(ctx.getImageData(0, 0, width, height).data);
}

/**
 * The region scaled so small screen text is legible to Tesseract, then cleaned up for OCR.
 * In layout mode the untouched picture and the chat bubbles in it come along too.
 */
async function capture(source: CanvasImageSource, crop: Rect, layout: boolean): Promise<CapturedFrame> {
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
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);

  // These read the original colors, so they come before the OCR clean-up below.
  const bubbles = layout
    ? findBubbleRegions(image.data, width, height).map((box) => ({ ...box, rows: findInkRows(image.data, width, height, box) }))
    : [];
  const snapshot = layout ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }) : null;

  prepareForOcr(image);
  ctx.putImageData(image, 0, 0);
  return { image: await canvas.convertToBlob({ type: 'image/png' }), snapshot, width, height, bubbles };
}

function reportError(error: unknown) {
  scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}
