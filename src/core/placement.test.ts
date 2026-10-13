import { describe, expect, it } from 'vitest';
import { busynessFromEdges, choosePlacement, SIDE_PREFERENCE, type Side } from './placement';
import type { Rect } from './types';

const workArea: Rect = { x: 0, y: 0, w: 640, h: 314 };
// A video window on the left (moderately busy) and a chat window on the right (very busy).
const zones = [
  { x: 16, y: 16, w: 392, h: 236, busy: 0.55 },
  { x: 428, y: 16, w: 196, h: 280, busy: 0.85 },
];

function zoneBusyness(r: Rect): number {
  let sum = 0;
  for (const z of zones) {
    const ox = Math.max(0, Math.min(r.x + r.w, z.x + z.w) - Math.max(r.x, z.x));
    const oy = Math.max(0, Math.min(r.y + r.h, z.y + z.h) - Math.max(r.y, z.y));
    sum += ox * oy * z.busy;
  }
  return sum / (r.w * r.h);
}

const subtitleBox = (side: Side) =>
  side === 'above' || side === 'below' ? { w: 284, h: 54 } : { w: 200, h: 68 };

describe('choosePlacement', () => {
  it('puts a subtitle translation in the empty space below the line', () => {
    const { choice, candidates } = choosePlacement({
      region: { x: 70, y: 204, w: 284, h: 34 },
      workArea,
      boxSize: subtitleBox,
      busyness: zoneBusyness,
      preference: SIDE_PREFERENCE.subtitle,
    });
    expect(choice?.side).toBe('below');
    expect(candidates.find((c) => c.side === 'left')?.fits).toBe(false);
  });

  it('moves above when there is no room below', () => {
    const { choice } = choosePlacement({
      region: { x: 70, y: 270, w: 284, h: 34 },
      workArea,
      boxSize: subtitleBox,
      busyness: zoneBusyness,
      preference: SIDE_PREFERENCE.subtitle,
    });
    expect(choice?.side).toBe('above');
  });

  it('stays on the current side unless another one is clearly better', () => {
    const input = {
      region: { x: 200, y: 120, w: 200, h: 30 },
      workArea,
      boxSize: subtitleBox,
      busyness: () => 0,
      preference: SIDE_PREFERENCE.subtitle,
    };
    expect(choosePlacement(input).choice?.side).toBe('below');
    expect(choosePlacement({ ...input, current: 'above' }).choice?.side).toBe('above');
  });

  it('returns no choice when nothing fits', () => {
    const { choice } = choosePlacement({
      region: { x: 0, y: 0, w: 640, h: 314 },
      workArea,
      boxSize: subtitleBox,
      busyness: () => 0,
      preference: SIDE_PREFERENCE.subtitle,
    });
    expect(choice).toBeNull();
  });
});

describe('busynessFromEdges', () => {
  const width = 20;
  const height = 10;

  it('is 0 for a flat background', () => {
    const gray = new Uint8Array(width * height).fill(128);
    expect(busynessFromEdges(gray, width, height, { x: 0, y: 0, w: width, h: height })).toBe(0);
  });

  it('saturates at 1 for dense detail and clips rects to the image', () => {
    const gray = Uint8Array.from({ length: width * height }, (_, i) => (i % 2 === 0 ? 0 : 255));
    expect(busynessFromEdges(gray, width, height, { x: -5, y: -5, w: 100, h: 100 })).toBe(1);
  });
});
