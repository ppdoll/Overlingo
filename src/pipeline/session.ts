import { LruCache } from '../core/lru';
import { cleanOcrText } from '../core/ocrText';
import { ChatLineTracker, SubtitleTracker } from '../core/textDiff';
import type { Mode } from '../core/types';
import { MAX_HISTORY, type LiveLine, type LiveState, type LiveStats } from '../state/live';
import type { Store } from '../state/store';
import { ModelDownloadRequiredError, type TranslationEngine } from '../translate/types';

const CONTEXT_LINES = 6;
const CONTEXT_MEMORY = 50;

/** Line ids stay unique across sessions, because the history outlives them. */
let lastLineId = 0;

export interface TextReader {
  recognize(image: Blob): Promise<{ text: string; ms: number }>;
}

export interface SessionConfig {
  mode: Mode;
  /** BCP 47 code, or 'auto'. */
  source: string;
  target: string;
  engine: TranslationEngine;
}

/**
 * Turns captured frames into translations: OCR, then only what's new (chat) or what changed
 * (subtitles), then the translation engine with a cache in front. Results go to the live store.
 */
export class TranslationSession {
  private readonly chat = new ChatLineTracker();
  private readonly subtitle = new SubtitleTracker();
  private readonly cache = new LruCache<string, string>(1000);
  private readonly context: string[] = [];
  private reading = false;
  private queued: Blob | null = null;
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
    this.store.set((s) => ({ ...s, subtitle: null }));
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
  handleFrame(image: Blob): void {
    if (this.stopped || this.store.get().status !== 'running') return;
    if (this.reading) {
      this.queued = image;
      return;
    }
    void this.read(image);
  }

  private async read(image: Blob) {
    this.reading = true;
    const startedAt = performance.now();
    try {
      const { text, ms } = await this.reader.recognize(image);
      if (this.stopped) return;
      this.patchStats({ ocrMs: Math.round(ms) });
      const lines = cleanOcrText(text);
      if (this.config.mode === 'chat') {
        const fresh = this.chat.update(lines);
        if (fresh.length > 0) void this.translateChat(fresh, startedAt);
      } else {
        const change = this.subtitle.update(lines);
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

  private async translateChat(sources: string[], startedAt: number) {
    const items = sources.map(newLine);
    this.store.set((s) => ({ ...s, lines: [...s.lines, ...items].slice(-MAX_HISTORY) }));
    const translated = await this.translate(sources, startedAt);
    const results = new Map(items.map((item, i) => [item.id, translated?.[i]]));
    this.store.set((s) => ({
      ...s,
      lines: s.lines.map((line) => (results.has(line.id) ? finish(line, results.get(line.id)) : line)),
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
    const keyOf = (line: string) => `${engine.id}|${source}|${target}|${line}`;
    const results = lines.map((line) => this.cache.get(keyOf(line)));
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
          this.cache.set(keyOf(lines[i]), results[i]!);
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

function newLine(source: string): LiveLine {
  return { id: ++lastLineId, at: Date.now(), source, translated: null };
}

function finish(line: LiveLine, translated: string | undefined): LiveLine {
  return translated === undefined ? { ...line, failed: true } : { ...line, translated };
}
