import { describe, expect, it } from 'vitest';
import { initialLiveState, type LiveState } from '../state/live';
import { createStore } from '../state/store';
import { ModelDownloadRequiredError, type TranslateRequest, type TranslationEngine } from '../translate/types';
import { TranslationSession, type SessionConfig, type TextReader } from './session';

const FRAME = new Blob(['frame']);
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Returns the queued OCR texts in order. */
class FakeReader implements TextReader {
  constructor(private readonly texts: string[]) {}
  async recognize() {
    return { text: this.texts.shift() ?? '', ms: 5 };
  }
}

class FakeEngine implements TranslationEngine {
  readonly id = 'chrome';
  readonly label = 'fake';
  readonly calls: string[][] = [];
  failWith: Error | null = null;
  async translate({ lines }: TranslateRequest) {
    this.calls.push(lines);
    if (this.failWith) throw this.failWith;
    return { lines: lines.map((line) => `T(${line})`), costUsd: 0.001 };
  }
}

function setup(mode: SessionConfig['mode'], texts: string[]) {
  const store = createStore<LiveState>(initialLiveState);
  const engine = new FakeEngine();
  const session = new TranslationSession(new FakeReader(texts), store, { mode, source: 'auto', target: 'ko', engine });
  const frame = async () => {
    session.handleFrame(FRAME);
    await settle();
  };
  return { store, engine, session, frame };
}

describe('TranslationSession in chat mode', () => {
  it('translates what is visible, then only new lines', async () => {
    const { store, engine, frame } = setup('chat', [
      'gg, that was close lol\nwait for me, brb',
      'gg, that was close lol\nwait for me, brb\nomw, hold on',
    ]);
    await frame();
    await frame();
    expect(engine.calls).toEqual([['gg, that was close lol', 'wait for me, brb'], ['omw, hold on']]);
    expect(store.get().lines.map((l) => l.translated)).toEqual([
      'T(gg, that was close lol)',
      'T(wait for me, brb)',
      'T(omw, hold on)',
    ]);
    expect(store.get().stats).toMatchObject({ lines: 3, batches: 2, cacheHits: 0 });
    expect(store.get().stats.costUsd).toBeCloseTo(0.002);
  });
});

describe('TranslationSession in subtitle mode', () => {
  it('translates each new subtitle once and clears it when it disappears', async () => {
    const { store, engine, frame } = setup('subtitle', ['Where have you been?', 'Where have you been?', '']);
    await frame();
    expect(store.get().subtitle?.translated).toBe('T(Where have you been?)');
    await frame();
    expect(engine.calls).toHaveLength(1);
    await frame();
    expect(store.get().subtitle).toBeNull();
    expect(store.get().lines).toHaveLength(1);
  });

  it('serves repeated subtitles from the cache', async () => {
    const { store, engine, frame } = setup('subtitle', ['Wait for me.', 'Someone is coming.', 'Wait for me.']);
    await frame();
    await frame();
    await frame();
    expect(engine.calls).toEqual([['Wait for me.'], ['Someone is coming.']]);
    expect(store.get().subtitle?.translated).toBe('T(Wait for me.)');
    expect(store.get().stats).toMatchObject({ lookups: 3, cacheHits: 1 });
  });

  it('shows engine errors and marks the line as failed', async () => {
    const { store, engine, frame } = setup('subtitle', ['Where have you been?']);
    engine.failWith = new Error('Claude API 키가 올바르지 않아요');
    await frame();
    expect(store.get().notice).toBe('Claude API 키가 올바르지 않아요');
    expect(store.get().subtitle).toMatchObject({ translated: null, failed: true });
  });

  it('asks for a model download instead of showing an error', async () => {
    const { store, engine, frame } = setup('subtitle', ['Where have you been?']);
    engine.failWith = new ModelDownloadRequiredError('en', 'ko');
    await frame();
    expect(store.get().downloadNeeded).toEqual({ source: 'en', target: 'ko' });
    expect(store.get().notice).toBeNull();
  });

  it('ignores frames while paused and after stopping', async () => {
    const { store, engine, session, frame } = setup('subtitle', ['Where have you been?', 'Wait for me.']);
    session.pause();
    await frame();
    expect(engine.calls).toHaveLength(0);
    session.resume();
    await frame();
    session.stop();
    await frame();
    expect(engine.calls).toEqual([['Where have you been?']]);
    expect(store.get().status).toBe('idle');
  });
});
