import { describe, expect, it } from 'vitest';
import { anchorTo, placeIn } from './anchor';

const window = { x: 100, y: 50, w: 800, h: 600 };

describe('placeIn', () => {
  it('moves the region with its window', () => {
    const anchor = anchorTo({ x: 300, y: 100, w: 500, h: 450 }, window, 'edges');
    expect(placeIn(anchor, { ...window, x: 400, y: 250 })).toEqual({ x: 600, y: 300, w: 500, h: 450 });
  });

  it('keeps the margins of a chat area that fills most of the window', () => {
    // A messenger: a 200 px sidebar on the left, a header above and an input box below.
    const anchor = anchorTo({ x: 300, y: 100, w: 580, h: 450 }, window, 'edges');
    expect(placeIn(anchor, { ...window, w: 1000, h: 800 })).toEqual({ x: 300, y: 100, w: 780, h: 650 });
  });

  it('keeps a small chat box its size in its corner', () => {
    // Game chat in the bottom-left corner.
    const anchor = anchorTo({ x: 120, y: 450, w: 300, h: 180 }, window, 'edges');
    expect(placeIn(anchor, { ...window, w: 1200, h: 900 })).toEqual({ x: 120, y: 750, w: 300, h: 180 });
  });

  it('scales a subtitle region with the video', () => {
    const anchor = anchorTo({ x: 200, y: 500, w: 600, h: 80 }, window, 'scale');
    expect(placeIn(anchor, { ...window, w: 1600, h: 1200 })).toEqual({ x: 300, y: 950, w: 1200, h: 160 });
  });

  it('stays inside a window that shrank below the region', () => {
    const anchor = anchorTo({ x: 120, y: 450, w: 300, h: 180 }, window, 'edges');
    const placed = placeIn(anchor, { ...window, w: 250, h: 120 });
    expect(placed.x).toBeGreaterThanOrEqual(100);
    expect(placed.y).toBeGreaterThanOrEqual(50);
    expect(placed.x + placed.w).toBeLessThanOrEqual(350);
    expect(placed.y + placed.h).toBeLessThanOrEqual(170);
  });

  it('leaves an unchanged window alone', () => {
    const region = { x: 130, y: 400, w: 310, h: 200 };
    for (const style of ['edges', 'scale'] as const) {
      expect(placeIn(anchorTo(region, window, style), window)).toEqual(region);
    }
  });
});
