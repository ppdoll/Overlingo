import { clamp } from '../core/geometry';
import { choosePlacement, SIDE_PREFERENCE, type Side } from '../core/placement';
import type { Align, Rect } from '../core/types';
import type { OverlayState } from './state';

// Decides where each translation goes on the overlay: next to its chat bubble, in free space,
// without covering other bubbles or other translations.

export interface PlacedLabel {
  kind: 'chat' | 'subtitle';
  rect: Rect;
  text: string;
  fontSize: number;
}

/** The overlay window's top-left corner on screen (physical pixels) and its scale factor. */
export interface Origin {
  x: number;
  y: number;
  scale: number;
}

/** Height a label needs for `text` at `width` (CSS pixels), padding included. */
export type Measure = (text: string, width: number, fontSize: number) => number;

const GAP = 6;
const MIN_WIDTH = 140;
const MAX_WIDTH = 360;
/** Free space outside the captured region might hold another app we know nothing about. */
const OUTSIDE_REGION_BUSYNESS = 0.3;
const SUBTITLE_SCALE = 1.25;

/** Incoming bubbles get their translation on the right, your own on the left. */
const CHAT_PREFERENCE: Record<Align, Record<Side, number>> = {
  left: { right: 1, below: 0.5, left: 0.35, above: 0.3 },
  right: { left: 1, below: 0.5, right: 0.35, above: 0.3 },
  full: { below: 1, above: 0.6, left: 0.2, right: 0.2 },
};

export function layoutOverlay(
  state: OverlayState,
  origin: Origin,
  viewport: { width: number; height: number },
  measure: Measure,
): PlacedLabel[] {
  const workArea: Rect = { x: 0, y: 0, w: viewport.width, h: viewport.height };
  const region: Rect = {
    x: (state.region.x - origin.x) / origin.scale,
    y: (state.region.y - origin.y) / origin.scale,
    w: state.region.width / origin.scale,
    h: state.region.height / origin.scale,
  };

  if (state.mode === 'subtitle') {
    if (!state.subtitle) return [];
    const fontSize = state.fontSize * SUBTITLE_SCALE;
    const width = Math.min(Math.max(region.w, MIN_WIDTH * 2), viewport.width - GAP * 2);
    const size = { w: width, h: measure(state.subtitle, width, fontSize) };
    const { choice } = choosePlacement({
      region,
      workArea,
      boxSize: () => size,
      busyness: () => 0,
      preference: SIDE_PREFERENCE.subtitle,
      gap: GAP,
    });
    // No room above or below: cover the original line instead.
    const rect = choice?.rect ?? { x: region.x, y: region.y, w: size.w, h: size.h };
    return [{ kind: 'subtitle', rect, text: state.subtitle, fontSize }];
  }

  const chat = state.chat;
  if (!chat) return [];
  // Bubble boxes are in OCR image pixels; the OCR image is the region scaled up.
  const ocrScale = chat.frameWidth / state.region.width;
  const toCss = (box: Rect): Rect => ({
    x: region.x + box.x / ocrScale / origin.scale,
    y: region.y + box.y / ocrScale / origin.scale,
    w: box.w / ocrScale / origin.scale,
    h: box.h / ocrScale / origin.scale,
  });
  const bubbles = chat.bubbles.map(toCss);
  const placed: Rect[] = [];
  const labels: PlacedLabel[] = [];

  for (const item of chat.items) {
    const bubble = toCss(item.box);
    const sizeFor = (side: Side) => {
      if (side === 'above' || side === 'below') {
        const width = clamp(bubble.w, MIN_WIDTH, MAX_WIDTH);
        return { w: width, h: measure(item.text, width, state.fontSize) };
      }
      // Stay inside the chat window when it has room; otherwise use the space beyond it.
      const left = side === 'left';
      const roomInRegion = left ? bubble.x - region.x - GAP : region.x + region.w - bubble.x - bubble.w - GAP;
      const roomOnScreen = left ? bubble.x - GAP : viewport.width - bubble.x - bubble.w - GAP;
      const room = roomInRegion >= MIN_WIDTH + GAP ? roomInRegion : roomOnScreen;
      const width = clamp(room - GAP, MIN_WIDTH, MAX_WIDTH);
      return { w: width, h: measure(item.text, width, state.fontSize) };
    };
    const { choice } = choosePlacement({
      region: bubble,
      workArea,
      boxSize: sizeFor,
      busyness: (rect) =>
        Math.max(coverage(rect, bubbles), coverage(rect, placed), isInside(rect, region) ? 0 : OUTSIDE_REGION_BUSYNESS),
      preference: CHAT_PREFERENCE[item.align],
      gap: GAP,
    });
    if (!choice) continue;
    placed.push(choice.rect);
    labels.push({ kind: 'chat', rect: choice.rect, text: item.text, fontSize: state.fontSize });
  }
  return labels;
}

/** Share of `rect` covered by the most-overlapping rect in `others`. */
function coverage(rect: Rect, others: Rect[]): number {
  let most = 0;
  for (const other of others) {
    const w = Math.min(rect.x + rect.w, other.x + other.w) - Math.max(rect.x, other.x);
    const h = Math.min(rect.y + rect.h, other.y + other.h) - Math.max(rect.y, other.y);
    if (w > 0 && h > 0) most = Math.max(most, (w * h) / (rect.w * rect.h));
  }
  return most;
}

function isInside(rect: Rect, area: Rect): boolean {
  return rect.x >= area.x && rect.y >= area.y && rect.x + rect.w <= area.x + area.w && rect.y + rect.h <= area.y + area.h;
}
