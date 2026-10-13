import type { Align, Rect } from './types';

// Groups OCR lines into chat messages. Messenger apps draw each message in a bubble of one flat
// color; finding those areas tells us which lines belong together, so a message that wraps over
// several lines is translated as one sentence instead of line by line.

export interface OcrLine {
  text: string;
  box: Rect;
}

/** A row of text inside a bubble, found from its pixels, and the color it's written in. */
export interface InkRow {
  y: number;
  h: number;
  color: [number, number, number];
}

/** A chat bubble, with the rows of text in it when they were measured. */
export interface Bubble extends Rect {
  rows?: InkRow[];
}

export interface TextUnit {
  /** The message: its lines joined, without the sender's name. */
  text: string;
  /** Who sent it, when the bubble opens with the sender's name (group chats). */
  sender: string | null;
  /** Everything read in the unit, sender included. Tells what's new on screen. */
  raw: string;
  /** The bubble, or just the line when it isn't in a bubble. */
  box: Rect;
  align: Align;
  /** Whether `box` is a detected bubble rather than a lone line. */
  bubble: boolean;
  /** The OCR lines it was read from, top to bottom. */
  lines: OcrLine[];
  /** Rows of text found in its bubble's pixels (bubbles only). */
  rows: InkRow[];
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
/** Pixels that differ this much from the bubble (largest channel difference) are text. */
const INK_CONTRAST = 48;
/** A bubble's outermost pixels are its anti-aliased rounded border, not text. */
const INK_INSET = 3;
/** A text row's color comes from its glyphs' cores: pixels at least this close to the strongest ink. */
const INK_CORE = 0.6;
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
 * The rows of text in a bubble and the color each is written in, from the original pixels.
 * Group chats write the sender's name in a color of its own, which tells it apart from the
 * message.
 */
export function findInkRows(rgba: Uint8ClampedArray, width: number, height: number, box: Rect): InkRow[] {
  const x0 = Math.max(0, Math.round(box.x) + INK_INSET);
  const x1 = Math.min(width, Math.round(box.x + box.w) - INK_INSET);
  const y0 = Math.max(0, Math.round(box.y) + INK_INSET);
  const y1 = Math.min(height, Math.round(box.y + box.h) - INK_INSET);
  if (x1 - x0 < 4 || y1 - y0 < 4) return [];
  const [br, bg, bb] = dominantColor(rgba, width, x0, y0, x1, y1);
  const inkAt = (i: number) => Math.max(Math.abs(rgba[i] - br), Math.abs(rgba[i + 1] - bg), Math.abs(rgba[i + 2] - bb));

  // Rows with any ink, grouped into bands of text.
  const strongest = new Float32Array(y1 - y0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0, i = (y * width + x0) * 4; x < x1; x++, i += 4) {
      const ink = inkAt(i);
      if (ink >= INK_CONTRAST && ink > strongest[y - y0]) strongest[y - y0] = ink;
    }
  }
  const bands: { y: number; h: number; max: number }[] = [];
  for (let y = y0; y < y1; y++) {
    const ink = strongest[y - y0];
    if (ink === 0) continue;
    const last = bands[bands.length - 1];
    if (last && y - (last.y + last.h) <= 1) {
      last.h = y - last.y + 1;
      last.max = Math.max(last.max, ink);
    } else {
      bands.push({ y, h: 1, max: ink });
    }
  }

  return bands
    .filter((band) => band.h >= 3)
    .map((band) => {
      const sum = [0, 0, 0];
      let count = 0;
      for (let y = band.y; y < band.y + band.h; y++) {
        for (let x = x0, i = (y * width + x0) * 4; x < x1; x++, i += 4) {
          if (inkAt(i) < band.max * INK_CORE) continue;
          sum[0] += rgba[i];
          sum[1] += rgba[i + 1];
          sum[2] += rgba[i + 2];
          count++;
        }
      }
      const color = sum.map((c) => Math.round(c / count)) as [number, number, number];
      return { y: band.y, h: band.h, color };
    });
}

/** The most common color in an area: a bubble's own color, since text covers less of it. */
function dominantColor(rgba: Uint8ClampedArray, width: number, x0: number, y0: number, x1: number, y1: number) {
  const counts = new Uint32Array(4096);
  const sums = new Float64Array(4096 * 3);
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0, i = (y * width + x0) * 4; x < x1; x += 2, i += 8) {
      const bucket = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
      counts[bucket]++;
      sums[bucket * 3] += rgba[i];
      sums[bucket * 3 + 1] += rgba[i + 1];
      sums[bucket * 3 + 2] += rgba[i + 2];
    }
  }
  let best = 0;
  for (let bucket = 1; bucket < counts.length; bucket++) if (counts[bucket] > counts[best]) best = bucket;
  const n = Math.max(1, counts[best]);
  return [sums[best * 3] / n, sums[best * 3 + 1] / n, sums[best * 3 + 2] / n];
}

/**
 * One unit per bubble, with its lines joined in reading order. Lines outside any bubble
 * (plain chat windows, game chat) stay one unit each.
 */
export function groupIntoUnits(lines: OcrLine[], bubbles: Bubble[], imageWidth: number): TextUnit[] {
  const units: { bubble: Bubble | null; box: Rect; lines: OcrLine[] }[] = [];
  const byBubble = new Map<number, { bubble: Bubble | null; box: Rect; lines: OcrLine[] }>();
  for (const line of [...lines].sort((a, b) => a.box.y - b.box.y)) {
    const index = smallestContaining(bubbles, line.box);
    if (index === -1) {
      units.push({ bubble: null, box: line.box, lines: [line] });
      continue;
    }
    let unit = byBubble.get(index);
    if (!unit) {
      const bubble = bubbles[index];
      unit = { bubble, box: { x: bubble.x, y: bubble.y, w: bubble.w, h: bubble.h }, lines: [] };
      byBubble.set(index, unit);
      units.push(unit);
    }
    unit.lines.push(line);
  }
  return units.map(({ bubble, box, lines: unitLines }) => {
    const text = joinLines(unitLines);
    return {
      text,
      sender: null,
      raw: text,
      box,
      align: alignOf(box, imageWidth),
      bubble: bubble !== null,
      lines: unitLines,
      rows: bubble?.rows ?? [],
    };
  });
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
