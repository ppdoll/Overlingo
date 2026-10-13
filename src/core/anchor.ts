import { clamp } from './geometry';
import type { Rect } from './types';

// Keeps a picked region on the same part of a window when the window moves or is resized.
// Chat areas keep fixed margins to the window's edges (a header above, an input box below, a
// sidebar on one side) or keep their size in one corner (game chat), so their edges are pinned
// to the window's. Video players scale the picture, subtitles included, so subtitle regions
// scale with the window.

export type AnchorStyle = 'edges' | 'scale';

/** How one axis of the region follows the window. */
type Axis = 'start' | 'end' | 'stretch' | 'scale';

export interface WindowAnchor {
  /** The region and the window when the region was picked. */
  region: Rect;
  window: Rect;
  x: Axis;
  y: Axis;
}

/** A region spanning at least this share of the window grows and shrinks with it. */
const STRETCH_SHARE = 0.5;
/** A stretched region never gets smaller than this, however small the window. */
const MIN_STRETCHED = 24;

export function anchorTo(region: Rect, window: Rect, style: AnchorStyle): WindowAnchor {
  return {
    region,
    window,
    x: axisFor(region.x - window.x, region.w, window.w, style),
    y: axisFor(region.y - window.y, region.h, window.h, style),
  };
}

/** Where the region is now that the window is at `window`. Always inside the window. */
export function placeIn(anchor: WindowAnchor, window: Rect): Rect {
  const [x, w] = place(anchor.x, anchor.region.x - anchor.window.x, anchor.region.w, anchor.window.w, window.w);
  const [y, h] = place(anchor.y, anchor.region.y - anchor.window.y, anchor.region.h, anchor.window.h, window.h);
  return { x: window.x + x, y: window.y + y, w, h };
}

function axisFor(offset: number, size: number, total: number, style: AnchorStyle): Axis {
  if (style === 'scale') return 'scale';
  if (size >= total * STRETCH_SHARE) return 'stretch';
  const after = total - offset - size;
  return after < offset ? 'end' : 'start';
}

/** Start and length on one axis, for a window that was `was` long and is now `now`. */
function place(axis: Axis, offset: number, size: number, was: number, now: number): [number, number] {
  const after = was - offset - size;
  let start = offset;
  let length = size;
  if (axis === 'scale' && was > 0) {
    start = (offset * now) / was;
    length = (size * now) / was;
  } else if (axis === 'stretch') {
    length = Math.max(MIN_STRETCHED, now - offset - after);
  } else if (axis === 'end') {
    start = now - after - size;
  }
  start = clamp(Math.round(start), 0, Math.max(0, now - 1));
  length = clamp(Math.round(length), 1, Math.max(1, now - start));
  return [start, length];
}
