import { joinLines, type InkRow, type OcrLine, type TextUnit } from './bubbles';

// Group chats put the sender's name on the first line of each incoming bubble. Translated
// along with the message, the name gets read as part of the sentence ("Sam 右から来てる" became
// "샘이 오른쪽에서 왔다"), so it's split off and left untranslated.
//
// A short first line could also be the start of the message ("lol" / "that was close"), so a
// line only counts as a name with evidence: it's written in another color than the message
// (most messengers color names), it opens several bubbles, or it was a name before.

const MAX_NAME_LENGTH = 24;
const MAX_NAME_WORDS = 3;
/** RGB distance between a name's color and the message's, past which they differ. */
const NAME_COLOR_DISTANCE = 60;
/** How many names to remember across frames. */
const MAX_KNOWN = 200;

/** Splits the sender's name off the bubbles that open with one. `known` carries names between frames. */
export function splitSenders(units: TextUnit[], known: Set<string>): TextUnit[] {
  const openers = new Map<string, number>();
  for (const unit of units) {
    const name = nameCandidate(unit);
    if (name) openers.set(name, (openers.get(name) ?? 0) + 1);
  }
  return units.map((unit) => {
    const name = nameCandidate(unit);
    if (!name) return unit;
    const sure = known.has(name) || (openers.get(name) ?? 0) >= 2 || nameInOwnColor(unit);
    if (!sure) return unit;
    remember(known, name);
    return { ...unit, sender: name, text: joinLines(unit.lines.slice(1)) };
  });
}

/** Whether a line could be someone's name: short, and not a sentence or a time. */
export function looksLikeName(text: string): boolean {
  const chars = [...text];
  if (chars.length === 0 || chars.length > MAX_NAME_LENGTH) return false;
  if (text.split(/\s+/).length > MAX_NAME_WORDS) return false;
  if (/[!?！？]/.test(text) || /[.。…,，、;；~～]$/.test(text)) return false;
  const letters = chars.filter((c) => /\p{L}/u.test(c)).length;
  const digits = chars.filter((c) => /\p{N}/u.test(c)).length;
  return letters > 0 && letters >= digits;
}

/** The first line of an incoming bubble with more lines after it, when it could be a name. */
function nameCandidate(unit: TextUnit): string | null {
  // Your own messages (on the right) never carry your name.
  if (!unit.bubble || unit.align === 'right' || unit.lines.length < 2) return null;
  const name = unit.lines[0].text.trim().replace(/\s*[:：]$/, '');
  return looksLikeName(name) ? name : null;
}

/** Whether the first line is written in another color than every line of the message. */
function nameInOwnColor(unit: TextUnit): boolean {
  const [first, ...rest] = unit.lines;
  const nameRow = rowOf(unit.rows, first);
  if (!nameRow) return false;
  const messageRows = rest.map((line) => rowOf(unit.rows, line)).filter((row) => row !== null && row !== nameRow);
  return (
    messageRows.length > 0 && messageRows.every((row) => colorDistance(row!.color, nameRow.color) >= NAME_COLOR_DISTANCE)
  );
}

/** The ink row that overlaps an OCR line the most, if any overlaps it by half. */
function rowOf(rows: InkRow[], line: OcrLine): InkRow | null {
  let best: InkRow | null = null;
  let bestOverlap = 0;
  for (const row of rows) {
    const overlap = Math.min(row.y + row.h, line.box.y + line.box.h) - Math.max(row.y, line.box.y);
    if (overlap > bestOverlap) {
      best = row;
      bestOverlap = overlap;
    }
  }
  return best && bestOverlap >= Math.min(best.h, line.box.h) / 2 ? best : null;
}

function colorDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function remember(known: Set<string>, name: string) {
  known.delete(name);
  known.add(name);
  if (known.size > MAX_KNOWN) known.delete(known.values().next().value!);
}
