import { describe, expect, it } from 'vitest';
import { alignOf, findBubbleRegions, groupIntoUnits, joinLines, type OcrLine } from './bubbles';
import type { Rect } from './types';

/** A chat screenshot: patterned green background, a white bubble with "text", a light green one. */
function chatImage() {
  const width = 300;
  const height = 200;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const paint = (x: number, y: number, [r, g, b]: number[]) => rgba.set([r, g, b, 255], (y * width + x) * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const doodle = x % 7 === 0 && y % 5 === 0;
      paint(x, y, doodle ? [95, 140, 95] : [120, 170, 120]);
    }
  }
  const fill = (r: Rect, color: number[]) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) paint(x, y, color);
  };
  fill({ x: 20, y: 20, w: 120, h: 50 }, [255, 255, 255]);
  fill({ x: 160, y: 100, w: 130, h: 60 }, [230, 250, 220]);
  // Dark strokes standing in for text inside the white bubble.
  for (let x = 30; x < 120; x += 2) fill({ x, y: 35, w: 1, h: 8 }, [20, 20, 20]);
  return { rgba, width, height };
}

const line = (text: string, x: number, y: number, w = 80, h = 10): OcrLine => ({ text, box: { x, y, w, h } });

describe('findBubbleRegions', () => {
  it('finds flat-colored bubbles and ignores the patterned background', () => {
    const { rgba, width, height } = chatImage();
    const bubbles = findBubbleRegions(rgba, width, height).sort((a, b) => a.y - b.y);
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toEqual({ x: 20, y: 20, w: 120, h: 50 });
    expect(bubbles[1]).toEqual({ x: 160, y: 100, w: 130, h: 60 });
  });

  it('finds nothing in a plain window', () => {
    const rgba = new Uint8ClampedArray(200 * 100 * 4).fill(240);
    expect(findBubbleRegions(rgba, 200, 100)).toEqual([]);
  });
});

describe('groupIntoUnits', () => {
  const bubbles: Rect[] = [
    { x: 20, y: 20, w: 120, h: 50 },
    { x: 160, y: 100, w: 130, h: 60 },
  ];

  it('joins the lines of each bubble and keeps lines outside bubbles separate', () => {
    const units = groupIntoUnits(
      [
        line('次の', 170, 110, 40),
        line('Hello there,', 25, 25),
        line('how are you?', 25, 37),
        line('ラウンド', 170, 122, 60),
        line('Today', 10, 180),
      ],
      bubbles,
      300,
    );
    expect(units.map((u) => [u.text, u.align])).toEqual([
      ['Hello there, how are you?', 'left'],
      ['次のラウンド', 'right'],
      ['Today', 'left'],
    ]);
    expect(units[0].box).toEqual(bubbles[0]);
  });
});

describe('joinLines', () => {
  it('keeps a paragraph break when the gap is large', () => {
    expect(joinLines([line('Nice save!', 0, 0), line("Let's group up.", 0, 24)])).toBe("Nice save!\nLet's group up.");
  });
});

describe('alignOf', () => {
  it('tells incoming, outgoing, and full-width messages apart', () => {
    expect(alignOf({ x: 10, y: 0, w: 100, h: 20 }, 300)).toBe('left');
    expect(alignOf({ x: 180, y: 0, w: 100, h: 20 }, 300)).toBe('right');
    expect(alignOf({ x: 0, y: 0, w: 280, h: 20 }, 300)).toBe('full');
  });
});
