import { clamp } from './geometry';
import type { Mode, Rect } from './types';

// Picks where to show a translation next to the captured region. The web app can't position
// windows, so this is used by the desktop overlay; it lives here so both share one tested copy.

export type Side = 'above' | 'below' | 'left' | 'right';
export const SIDES: readonly Side[] = ['above', 'below', 'left', 'right'];

/** Subtitles read best right below the line; chat translations sit beside the window. */
export const SIDE_PREFERENCE: Record<Mode, Record<Side, number>> = {
  subtitle: { below: 1, above: 0.85, left: 0.35, right: 0.35 },
  chat: { right: 1, left: 0.9, below: 0.45, above: 0.45 },
};

const FREE_SPACE_WEIGHT = 0.6;
const PREFERENCE_WEIGHT = 0.3;
/** Bonus for the current side, so the box only moves when another side is clearly better. */
const STAY_BONUS = 0.1;

export interface PlacementInput {
  region: Rect;
  /** The monitor's usable area (without the taskbar). */
  workArea: Rect;
  boxSize: (side: Side) => { w: number; h: number };
  /** 0 for an empty background, 1 for an area full of text or UI. */
  busyness: (rect: Rect) => number;
  preference: Record<Side, number>;
  current?: Side | null;
  gap?: number;
  margin?: number;
}

export interface Candidate {
  side: Side;
  rect: Rect;
  fits: boolean;
  busy: number;
  /** 0..1 without the stay bonus. */
  score: number;
}

export interface Placement {
  choice: Candidate | null;
  candidates: Candidate[];
}

export function choosePlacement(input: PlacementInput): Placement {
  const gap = input.gap ?? 8;
  const margin = input.margin ?? 4;
  const candidates = SIDES.map((side): Candidate => {
    const rect = candidateRect(side, input.region, input.boxSize(side), input.workArea, gap, margin);
    const fits = isInside(rect, input.workArea, margin);
    const busy = fits ? clamp(input.busyness(rect), 0, 1) : 1;
    const score = fits ? FREE_SPACE_WEIGHT * (1 - busy) + PREFERENCE_WEIGHT * input.preference[side] : 0;
    return { side, rect, fits, busy, score };
  });

  let choice: Candidate | null = null;
  let best = -Infinity;
  for (const candidate of candidates) {
    if (!candidate.fits) continue;
    const effective = candidate.score + (candidate.side === input.current ? STAY_BONUS : 0);
    if (effective > best) {
      best = effective;
      choice = candidate;
    }
  }
  return { choice, candidates };
}

function candidateRect(
  side: Side,
  region: Rect,
  size: { w: number; h: number },
  area: Rect,
  gap: number,
  margin: number,
): Rect {
  if (side === 'above' || side === 'below') {
    const x = clamp(region.x + region.w / 2 - size.w / 2, area.x + margin, area.x + area.w - margin - size.w);
    const y = side === 'below' ? region.y + region.h + gap : region.y - gap - size.h;
    return { x, y, w: size.w, h: size.h };
  }
  const y = clamp(region.y + region.h / 2 - size.h / 2, area.y + margin, area.y + area.h - margin - size.h);
  const x = side === 'right' ? region.x + region.w + gap : region.x - gap - size.w;
  return { x, y, w: size.w, h: size.h };
}

function isInside(rect: Rect, area: Rect, margin: number): boolean {
  return (
    rect.x >= area.x + margin &&
    rect.y >= area.y + margin &&
    rect.x + rect.w <= area.x + area.w - margin &&
    rect.y + rect.h <= area.y + area.h - margin
  );
}

/** Edge density at which an area counts as completely busy. */
const EDGE_DENSITY_FULL = 0.2;

/**
 * Busyness of `rect` in a grayscale screenshot: the share of pixels with a strong gradient,
 * scaled so text-heavy areas reach 1. Flat backgrounds stay near 0.
 */
export function busynessFromEdges(gray: Uint8Array, width: number, height: number, rect: Rect, threshold = 24): number {
  const x0 = clamp(Math.floor(rect.x), 0, width);
  const y0 = clamp(Math.floor(rect.y), 0, height);
  const x1 = clamp(Math.ceil(rect.x + rect.w), x0, width);
  const y1 = clamp(Math.ceil(rect.y + rect.h), y0, height);
  let edges = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      const dx = x + 1 < width ? Math.abs(gray[i + 1] - gray[i]) : 0;
      const dy = y + 1 < height ? Math.abs(gray[i + width] - gray[i]) : 0;
      if (Math.max(dx, dy) > threshold) edges++;
      total++;
    }
  }
  return total === 0 ? 0 : Math.min(1, edges / total / EDGE_DENSITY_FULL);
}
