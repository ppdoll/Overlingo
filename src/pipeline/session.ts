import type { CapturedFrame } from '../capture/protocol';
import { groupIntoUnits, type OcrLine, type TextUnit } from '../core/bubbles';
import { LruCache } from '../core/lru';
import { cleanOcrText } from '../core/ocrText';
import { similarity } from '../core/similarity';
import { ChatLineTracker, SubtitleTracker } from '../core/textDiff';
import type { Align, Mode, Rect } from '../core/types';
import { MAX_HISTORY, type LayoutUnit, type LiveLine, type LiveState, type LiveStats } from '../state/live';
import type { Store } from '../state/store';
import { ModelDownloadRequiredError, type TranslationEngine } from '../translate/types';

const CONTEXT_LINES = 6;
const CONTEXT_MEMORY = 50;
/** OCR reads the same bubble slightly differently from frame to frame. */
const SAME_MESSAGE = 0.85;
const RECALL_MEMORY = 300;
const RECALL_FUZZY_WINDOW = 60;
/** Old snapshots stay valid a little longer, so windows still showing them don't flash empty. */
const SNAPSHOT_GRACE_MS = 5000;
/** Bubbles smaller than this (in OCR pixels) are cut off at the edge or hold no text. */
const MIN_BUBBLE = { w: 40, h: 30 };
/** Re-reading bubbles one by one is slow; past this many, wait for the next frame. */
const MAX_BUBBLE_REREADS = 4;

/** Line ids stay unique across sessions, because the history outlives them. */
let lastLineId = 0;

export interface TextReader {
  /** Reads the whole image, or only `area` of it. Line boxes are in whole-image pixels. */
  recognize(image: Blob, area?: Rect): Promise<{ text: string; lines?: OcrLine[]; ms: number }>;
}

export interface SessionConfig {
  mode: Mode;
  /** BCP 47 code, or 'auto'. */
  source: string;
  target: string;
  engine: TranslationEngine;
}

/**
 * Turns captured frames into translations: OCR, then only what's new (chat messages) or what
 * changed (subtitles), then the translation engine with a cache in front. Results go to the
 * live store.
 */
export class TranslationSession {
  private readonly chat = new ChatLineTracker();
  private readonly subtitle = new SubtitleTracker();
  private readonly cache = new LruCache<string, string>(1000);
  private readonly context: string[] = [];
  /** Recent chat translations, for messages OCR now reads a little differently. */
  private readonly recent: { source: string; translated: string }[] = [];
  private readonly failed = new Set<string>();
  private reading = false;
  private queued: CapturedFrame | null = null;
  private stopped = false;

  constructor(
    private readonly reader: TextReader,
    private readonly store: Store<LiveState>,
    private config: SessionConfig,
  ) {
    store.set((s) => ({ ...s, status: 'running', notice: null, downloadNeeded: null }));
  }

  /** A new mode or language pair starts change tracking over, so the screen is read fresh. */
  update(config: Partial<SessionConfig>): void {
    const next = { ...this.config, ...config };
    const retrack = next.mode !== this.config.mode || next.source !== this.config.source || next.target !== this.config.target;
    this.config = next;
    if (retrack) this.restartTracking();
  }

  /** Forgets what was already read, so whatever is on screen now gets translated again. */
  restartTracking(): void {
    this.chat.reset();
    this.subtitle.reset();
    this.failed.clear();
    this.store.set((s) => ({ ...s, subtitle: null, layout: null }));
  }

  pause(): void {
    this.store.set((s) => ({ ...s, status: 'paused' }));
  }

  resume(): void {
    this.store.set((s) => ({ ...s, status: 'running' }));
  }

  stop(): void {
    this.stopped = true;
    this.queued = null;
    this.store.set((s) => ({ ...s, status: 'idle' }));
  }

  /** Takes a frame the capture worker found worth reading. Frames arriving mid-read replace each other. */
  handleFrame(frame: CapturedFrame): void {
    if (this.stopped || this.store.get().status !== 'running') return;
    if (this.reading) {
      this.queued = frame;
      return;
    }
    void this.read(frame);
  }

  private async read(frame: CapturedFrame) {
    this.reading = true;
    const startedAt = performance.now();
    try {
      const result = await this.reader.recognize(frame.image);
      if (this.stopped) return;
      this.patchStats({ ocrMs: Math.round(result.ms) });
      if (this.config.mode === 'chat') {
        const units = await this.chatUnits(result, frame);
        if (this.stopped) return;
        this.readChat(units, frame, startedAt);
      } else {
        const change = this.subtitle.update(cleanOcrText(result.text));
        if (change.kind === 'new') void this.translateSubtitle(change.text, startedAt);
        if (change.kind === 'clear') this.store.set((s) => ({ ...s, subtitle: null }));
      }
    } catch (error) {
      this.report(error);
    } finally {
      this.reading = false;
      const next = this.queued;
      this.queued = null;
      if (next) this.handleFrame(next);
    }
  }

  /**
   * Chat messages in the frame: one per bubble, or one per line where there are no bubbles.
   * Tesseract sometimes skips text that sits apart from the rest, like your own right-aligned
   * bubbles, so bubbles that came back empty are read again on their own.
   */
  private async chatUnits(result: { text: string; lines?: OcrLine[] }, frame: CapturedFrame): Promise<TextUnit[]> {
    if (!result.lines) {
      return cleanOcrText(result.text).map((text) => ({ text, box: { x: 0, y: 0, w: 0, h: 0 }, align: 'full' }));
    }
    const lines = cleanLines(result.lines);
    const missed = frame.bubbles.filter(
      (bubble) => bubble.w >= MIN_BUBBLE.w && bubble.h >= MIN_BUBBLE.h && !lines.some((line) => contains(bubble, line.box)),
    );
    for (const bubble of missed.slice(0, MAX_BUBBLE_REREADS)) {
      const reread = await this.reader.recognize(frame.image, bubble);
      lines.push(...cleanLines(reread.lines ?? []));
    }
    return groupIntoUnits(lines, frame.bubbles, frame.width);
  }

  private readChat(units: TextUnit[], frame: CapturedFrame, startedAt: number) {
    const fresh = this.chat.update(units.map((unit) => unit.text));
    this.publishLayout(frame, units);
    if (fresh.length > 0) void this.translateChat(pickUnits(units, fresh), startedAt);
  }

  private publishLayout(frame: CapturedFrame, units: TextUnit[]) {
    const imageUrl = frame.snapshot ? URL.createObjectURL(frame.snapshot) : null;
    const previous = this.store.get().layout?.imageUrl;
    const layoutUnits = units.map(
      (unit): LayoutUnit => ({
        source: unit.text,
        box: unit.box,
        align: unit.align,
        translated: this.recall(unit.text),
        failed: this.failed.has(unit.text),
      }),
    );
    this.store.set((s) => ({ ...s, layout: { imageUrl, width: frame.width, height: frame.height, units: layoutUnits } }));
    if (previous) setTimeout(() => URL.revokeObjectURL(previous), SNAPSHOT_GRACE_MS);
  }

  private async translateChat(units: TextUnit[], startedAt: number) {
    const sources = units.map((unit) => unit.text);
    const items = units.map((unit) => newLine(unit.text, unit.align));
    this.store.set((s) => ({ ...s, lines: [...s.lines, ...items].slice(-MAX_HISTORY) }));
    const translated = await this.translate(sources, startedAt);
    sources.forEach((source, i) => {
      if (translated) this.remember(source, translated[i]);
      else this.failed.add(source);
    });
    const results = new Map(items.map((item, i) => [item.id, translated?.[i]]));
    this.store.set((s) => ({
      ...s,
      lines: s.lines.map((line) => (results.has(line.id) ? finish(line, results.get(line.id)) : line)),
      layout: s.layout && {
        ...s.layout,
        units: s.layout.units.map((unit) =>
          unit.translated ? unit : { ...unit, translated: this.recall(unit.source), failed: this.failed.has(unit.source) },
        ),
      },
    }));
  }

  private async translateSubtitle(text: string, startedAt: number) {
    const item = newLine(text);
    this.store.set((s) => ({ ...s, subtitle: item, lines: [...s.lines, item].slice(-MAX_HISTORY) }));
    const [translated] = (await this.translate([text], startedAt)) ?? [];
    this.store.set((s) => ({
      ...s,
      // A newer subtitle may already be showing; never put an old translation over it.
      subtitle: s.subtitle?.id === item.id ? finish(s.subtitle, translated) : s.subtitle,
      lines: s.lines.map((line) => (line.id === item.id ? finish(line, translated) : line)),
    }));
  }

  /** Translates through the cache. Returns null, after reporting why, if the engine fails. */
  private async translate(lines: string[], startedAt: number): Promise<string[] | null> {
    const { engine, source, target, mode } = this.config;
    const results = lines.map((line) => this.cache.get(this.cacheKey(line)));
    const missing = lines.filter((_, i) => results[i] === undefined);
    let costUsd = 0;
    try {
      if (missing.length > 0) {
        const response = await engine.translate({
          lines: missing,
          source,
          target,
          mode,
          context: this.context.slice(-CONTEXT_LINES),
        });
        costUsd = response.costUsd ?? 0;
        let next = 0;
        results.forEach((cached, i) => {
          if (cached !== undefined) return;
          results[i] = response.lines[next++];
          this.cache.set(this.cacheKey(lines[i]), results[i]!);
        });
      }
    } catch (error) {
      this.report(error);
      return null;
    }

    this.context.push(...lines);
    if (this.context.length > CONTEXT_MEMORY) this.context.splice(0, this.context.length - CONTEXT_MEMORY);
    const latency = performance.now() - startedAt;
    this.store.set((s) => {
      const batches = s.stats.batches + 1;
      return {
        ...s,
        notice: null,
        downloadNeeded: null,
        stats: {
          ...s.stats,
          lines: s.stats.lines + lines.length,
          batches,
          avgLatencyMs: s.stats.avgLatencyMs + (latency - s.stats.avgLatencyMs) / batches,
          lookups: s.stats.lookups + lines.length,
          cacheHits: s.stats.cacheHits + lines.length - missing.length,
          costUsd: s.stats.costUsd + costUsd,
        },
      };
    });
    return results as string[];
  }

  private cacheKey(line: string): string {
    const { engine, source, target } = this.config;
    return `${engine.id}|${source}|${target}|${line}`;
  }

  private remember(source: string, translated: string) {
    this.failed.delete(source);
    this.recent.push({ source, translated });
    if (this.recent.length > RECALL_MEMORY) this.recent.splice(0, this.recent.length - RECALL_MEMORY);
  }

  /** The translation of a message on screen, even when OCR reads it slightly differently now. */
  private recall(source: string): string | null {
    const exact = this.cache.get(this.cacheKey(source));
    if (exact !== undefined) return exact;
    let best: { score: number; translated: string } | null = null;
    for (const entry of this.recent.slice(-RECALL_FUZZY_WINDOW)) {
      const lengthRatio = Math.min(entry.source.length, source.length) / Math.max(entry.source.length, source.length, 1);
      if (lengthRatio < SAME_MESSAGE) continue;
      const score = similarity(entry.source, source);
      if (score >= SAME_MESSAGE && (!best || score > best.score)) best = { score, translated: entry.translated };
    }
    return best?.translated ?? null;
  }

  private patchStats(patch: Partial<LiveStats>) {
    this.store.set((s) => ({ ...s, stats: { ...s.stats, ...patch } }));
  }

  private report(error: unknown) {
    if (error instanceof ModelDownloadRequiredError) {
      const { source, target } = error;
      this.store.set((s) => ({ ...s, downloadNeeded: { source, target } }));
      return;
    }
    const notice = error instanceof Error ? error.message : String(error);
    this.store.set((s) => ({ ...s, notice }));
  }
}

function cleanLines(lines: OcrLine[]): OcrLine[] {
  return lines.flatMap((line) => cleanOcrText(line.text).slice(0, 1).map((text) => ({ text, box: line.box })));
}

/** Whether the center of `box` lies inside `area`. */
function contains(area: Rect, box: Rect): boolean {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return cx >= area.x && cx <= area.x + area.w && cy >= area.y && cy <= area.y + area.h;
}

/** The units whose text the tracker reported as new, in screen order. */
function pickUnits(units: TextUnit[], fresh: string[]): TextUnit[] {
  const remaining = [...fresh];
  return units.filter((unit) => {
    const i = remaining.indexOf(unit.text);
    if (i === -1) return false;
    remaining.splice(i, 1);
    return true;
  });
}

function newLine(source: string, align?: Align): LiveLine {
  return { id: ++lastLineId, at: Date.now(), source, translated: null, align };
}

function finish(line: LiveLine, translated: string | undefined): LiveLine {
  return translated === undefined ? { ...line, failed: true } : { ...line, translated };
}
