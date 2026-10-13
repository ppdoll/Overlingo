import type { NormRect, Rect } from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Converts a normalized rect to whole pixels inside a `width` x `height` frame. */
export function toPixelRect(rect: NormRect, width: number, height: number): Rect {
  const x = clamp(Math.round(rect.x * width), 0, width);
  const y = clamp(Math.round(rect.y * height), 0, height);
  return {
    x,
    y,
    w: clamp(Math.round(rect.w * width), 0, width - x),
    h: clamp(Math.round(rect.h * height), 0, height - y),
  };
}

/** Builds a normalized rect from two drag points given in 0..1 coordinates. */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): NormRect {
  const x = clamp(Math.min(ax, bx), 0, 1);
  const y = clamp(Math.min(ay, by), 0, 1);
  return {
    x,
    y,
    w: clamp(Math.max(ax, bx), 0, 1) - x,
    h: clamp(Math.max(ay, by), 0, 1) - y,
  };
}
