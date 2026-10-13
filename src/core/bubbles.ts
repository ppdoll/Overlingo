import type { Align, Rect } from './types';

// Groups OCR lines into chat messages. Messenger apps draw each message in a bubble of one flat
// color; finding those areas tells us which lines belong together, so a message that wraps over
// several lines is translated as one sentence instead of line by line.

export interface OcrLine {
  text: string;
  box: Rect;
}

export interface TextUnit {
  text: string;
  /** The bubble, or just the line when it isn't in a bubble. */
  box: Rect;
  align: Align;
  /** Whether `box` is a detected bubble rather than a lone line. */
  bubble: boolean;
}

/** Bubble detection runs on a grid about this wide, whatever the capture size. */
const GRID_WIDTH = 300;
/**
 * Kept small on purpose: video encoding blurs bubble edges into gradients, and a looser
 * tolerance lets a pale bubble "leak" into a similar background one small step at a time.
 */
const COLOR_TOLERANCE = 6;
/** Bubbles are mostly flat color; text only takes up part of them. */
const MIN_FILL = 0.45;
const NO_SPACE_CHAR = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿！-｠]/;

/**
 * Finds chat bubbles: sizable areas of one flat color that aren't the window background.
 * Works on the original colors, because bubbles are often told apart from the background by
 * color alone. Returns rects in the image's pixel coordinates.
 */
export function findBubbleRegions(rgba: Uint8ClampedArray, width: number, height: number): Rect[] {
  const step = Math.max(1, Math.round(width / GRID_WIDTH));
  const cols = Math.floor(width / step);
  const rows = Math.floor(height / step);
  if (cols < 4 || rows < 4) return [];
  const cells = cols * rows;

  const parent = new Int32Array(cells);
  for (let i = 0; i < cells; i++) parent[i] = i;
  const find = (i: number) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  const pixel = (col: number, row: number) => (row * step * width + col * step) * 4;
  const similar = (a: number, b: number) =>
    Math.abs(rgba[a] - rgba[b]) <= COLOR_TOLERANCE &&
    Math.abs(rgba[a + 1] - rgba[b + 1]) <= COLOR_TOLERANCE &&
    Math.abs(rgba[a + 2] - rgba[b + 2]) <= COLOR_TOLERANCE;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = row * cols + col;
      const p = pixel(col, row);
      if (col + 1 < cols && similar(p, pixel(col + 1, row))) union(cell, cell + 1);
      if (row + 1 < rows && similar(p, pixel(col, row + 1))) union(cell, cell + cols);
    }
  }

  const area = new Int32Array(cells);
  const minCol = new Int32Array(cells).fill(cols);
  const minRow = new Int32Array(cells).fill(rows);
  const maxCol = new Int32Array(cells).fill(-1);
  const maxRow = new Int32Array(cells).fill(-1);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const root = find(row * cols + col);
      area[root]++;
      if (col < minCol[root]) minCol[root] = col;
      if (col > maxCol[root]) maxCol[root] = col;
      if (row < minRow[root]) minRow[root] = row;
      if (row > maxRow[root]) maxRow[root] = row;
    }
  }

  const minArea = Math.max(40, cells * 0.003);
  const bubbles: Rect[] = [];
  for (let root = 0; root < cells; root++) {
    if (area[root] < minArea) continue;
    const w = maxCol[root] - minCol[root] + 1;
    const h = maxRow[root] - minRow[root] + 1;
    const isBackground = w >= cols * 0.92 && h >= rows * 0.92;
    if (isBackground || w < cols * 0.1 || h < 3 || area[root] / (w * h) < MIN_FILL) continue;
    bubbles.push({ x: minCol[root] * step, y: minRow[root] * step, w: w * step, h: h * step });
  }
  return bubbles;
}

/**
 * One unit per bubble, with its lines joined in reading order. Lines outside any bubble
 * (plain chat windows, game chat) stay one unit each.
 */
export function groupIntoUnits(lines: OcrLine[], bubbles: Rect[], imageWidth: number): TextUnit[] {
  const units: { box: Rect; lines: OcrLine[]; bubble: boolean }[] = [];
  const byBubble = new Map<number, { box: Rect; lines: OcrLine[]; bubble: boolean }>();
  for (const line of [...lines].sort((a, b) => a.box.y - b.box.y)) {
    const bubble = smallestContaining(bubbles, line.box);
    if (bubble === -1) {
      units.push({ box: line.box, lines: [line], bubble: false });
      continue;
    }
    let unit = byBubble.get(bubble);
    if (!unit) {
      unit = { box: bubbles[bubble], lines: [], bubble: true };
      byBubble.set(bubble, unit);
      units.push(unit);
    }
    unit.lines.push(line);
  }
  return units.map(({ box, lines: unitLines, bubble }) => ({
    text: joinLines(unitLines),
    box,
    align: alignOf(box, imageWidth),
    bubble,
  }));
}

/** Wrapped lines become one sentence; a bigger gap is kept as a paragraph break. */
export function joinLines(lines: OcrLine[]): string {
  let text = '';
  lines.forEach((line, i) => {
    if (i === 0) {
      text = line.text;
      return;
    }
    const prev = lines[i - 1];
    const gap = line.box.y - (prev.box.y + prev.box.h);
    const lineHeight = (prev.box.h + line.box.h) / 2;
    let separator = ' ';
    if (gap > lineHeight * 0.8) separator = '\n';
    else if (NO_SPACE_CHAR.test(text.slice(-1)) && NO_SPACE_CHAR.test(line.text[0] ?? '')) separator = '';
    text += separator + line.text;
  });
  return text;
}

export function alignOf(box: Rect, width: number): Align {
  if (box.w >= width * 0.8) return 'full';
  return box.x + box.w / 2 < width / 2 ? 'left' : 'right';
}

function smallestContaining(rects: Rect[], box: Rect): number {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let best = -1;
  rects.forEach((r, i) => {
    if (cx < r.x || cx > r.x + r.w || cy < r.y || cy > r.y + r.h) return;
    if (best === -1 || r.w * r.h < rects[best].w * rects[best].h) best = i;
  });
  return best;
}
