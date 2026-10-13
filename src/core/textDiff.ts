import { similarity } from './similarity';

const SAME_LINE = 0.8;
const SAME_SUBTITLE = 0.85;

/**
 * Finds chat lines that weren't on screen in the previous OCR pass.
 *
 * Chat windows scroll, so the tail of the previous pass is aligned with the head of the current
 * one (allowing one cut-off line at the top) and everything after the overlap is new. When the
 * two passes don't line up at all, lines are compared against everything translated recently.
 */
export class ChatLineTracker {
  private prev: string[] = [];
  private readonly seen: string[] = [];

  constructor(
    private readonly threshold = SAME_LINE,
    private readonly memory = 300,
  ) {}

  update(lines: string[]): string[] {
    const fresh = this.findNew(lines);
    this.prev = lines;
    this.seen.push(...fresh);
    if (this.seen.length > this.memory) this.seen.splice(0, this.seen.length - this.memory);
    return fresh;
  }

  reset(): void {
    this.prev = [];
    this.seen.length = 0;
  }

  private findNew(cur: string[]): string[] {
    if (this.prev.length > 0) {
      let best: { start: number; length: number } | null = null;
      for (const start of [0, 1]) {
        const length = this.longestOverlap(cur, start);
        if (length > 0 && (!best || length > best.length)) best = { start, length };
      }
      if (best) return cur.slice(best.start + best.length);
    }
    return cur.filter((line) => !this.seen.some((s) => similarity(s, line) >= this.threshold));
  }

  /** Longest k where the last k previous lines match cur[start..start+k). */
  private longestOverlap(cur: string[], start: number): number {
    for (let k = Math.min(this.prev.length, cur.length - start); k >= 1; k--) {
      const offset = this.prev.length - k;
      let matches = true;
      for (let i = 0; i < k && matches; i++) {
        matches = similarity(this.prev[offset + i], cur[start + i]) >= this.threshold;
      }
      if (matches) return k;
    }
    return 0;
  }
}

export type SubtitleUpdate = { kind: 'same' } | { kind: 'new'; text: string } | { kind: 'clear' };

/** Reports when the subtitle text actually changes, ignoring small OCR differences. */
export class SubtitleTracker {
  private last = '';

  constructor(private readonly threshold = SAME_SUBTITLE) {}

  update(lines: string[]): SubtitleUpdate {
    const text = lines.join('\n');
    if (!text) {
      if (!this.last) return { kind: 'same' };
      this.last = '';
      return { kind: 'clear' };
    }
    if (this.last && similarity(text, this.last) >= this.threshold) return { kind: 'same' };
    this.last = text;
    return { kind: 'new', text };
  }

  reset(): void {
    this.last = '';
  }
}
