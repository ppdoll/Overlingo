import { describe, expect, it } from 'vitest';
import { findInkRows, groupIntoUnits, type Bubble, type OcrLine } from './bubbles';
import { looksLikeName, splitSenders } from './senders';
import type { Rect } from './types';

const PURPLE = [138, 75, 176];
const DARK = [31, 30, 28];

/** A white bubble on a green chat, with strokes standing in for text rows in the given colors. */
function bubbleImage(rows: { y: number; color: number[] }[]) {
  const width = 300;
  const height = 160;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const fill = (r: Rect, [red, green, blue]: number[]) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) rgba.set([red, green, blue, 255], (y * width + x) * 4);
  };
  fill({ x: 0, y: 0, w: width, h: height }, [201, 220, 180]);
  const bubble = { x: 10, y: 10, w: 220, h: 130 };
  fill(bubble, [255, 255, 255]);
  for (const row of rows) for (let x = 24; x < 180; x += 3) fill({ x, y: row.y, w: 2, h: 12 }, row.color);
  return { rgba, width, height, bubble };
}

const line = (text: string, y: number, x = 22): OcrLine => ({ text, box: { x, y, w: 150, h: 12 } });

/** Units for one incoming bubble holding `lines`, with its measured ink rows. */
function unitsFor(lines: OcrLine[], rowColors: number[][]) {
  const image = bubbleImage(lines.map((l, i) => ({ y: l.box.y, color: rowColors[i] })));
  const bubble: Bubble = { ...image.bubble, rows: findInkRows(image.rgba, image.width, image.height, image.bubble) };
  return groupIntoUnits(lines, [bubble], 600);
}

describe('findInkRows', () => {
  it('finds each row of text and the color it is written in', () => {
    const { rgba, width, height, bubble } = bubbleImage([
      { y: 20, color: PURPLE },
      { y: 44, color: DARK },
      { y: 68, color: DARK },
    ]);
    const rows = findInkRows(rgba, width, height, bubble);
    expect(rows.map((row) => [row.y, row.h])).toEqual([
      [20, 12],
      [44, 12],
      [68, 12],
    ]);
    expect(rows[0].color).toEqual(PURPLE);
    expect(rows[1].color).toEqual(DARK);
  });
});

describe('splitSenders', () => {
  it('splits off a name written in its own color', () => {
    const units = unitsFor([line('Sam', 20), line('右から来てる！気をつけて', 36)], [PURPLE, DARK]);
    const [unit] = splitSenders(units, new Set());
    expect(unit).toMatchObject({ sender: 'Sam', text: '右から来てる！気をつけて', raw: 'Sam 右から来てる！気をつけて' });
  });

  it('keeps a short first line in the message color', () => {
    const units = unitsFor([line('lol', 20), line('that was close', 36)], [DARK, DARK]);
    const [unit] = splitSenders(units, new Set());
    expect(unit).toMatchObject({ sender: null, text: 'lol that was close' });
  });

  it('trusts a name it has seen before, and one that opens several bubbles', () => {
    const units = unitsFor([line('Kenji', 20), line('omw', 36)], [DARK, DARK]);
    expect(splitSenders(units, new Set(['Kenji']))[0].sender).toBe('Kenji');

    const bubbles: Rect[] = [
      { x: 10, y: 0, w: 200, h: 60 },
      { x: 10, y: 70, w: 200, h: 60 },
    ];
    const lines = [line('Kenji', 5), line('gg', 30), line('Kenji', 75), line('next round?', 100)];
    const known = new Set<string>();
    expect(splitSenders(groupIntoUnits(lines, bubbles, 600), known).map((u) => [u.sender, u.text])).toEqual([
      ['Kenji', 'gg'],
      ['Kenji', 'next round?'],
    ]);
    expect(known.has('Kenji')).toBe(true);
  });

  it('leaves your own messages and sentences alone', () => {
    const own = groupIntoUnits([line('Sam', 20, 400), line('see you', 44, 400)], [{ x: 380, y: 10, w: 200, h: 60 }], 600);
    expect(splitSenders(own, new Set(['Sam']))[0].sender).toBeNull();

    const sentence = unitsFor([line('Nice save!', 20), line("Let's go", 44)], [PURPLE, DARK]);
    expect(splitSenders(sentence, new Set())[0].sender).toBeNull();
  });
});

describe('looksLikeName', () => {
  it('accepts names and rejects sentences and times', () => {
    expect(['Kenji', '김민수', 'Mia Wong', '田中', 'xX_Sniper_Xx'].every(looksLikeName)).toBe(true);
    expect(['Nice save!', '오후 3:15', '12:30', 'are you coming to the party', 'ok.'].some(looksLikeName)).toBe(false);
  });
});
