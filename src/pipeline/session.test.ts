import { describe, expect, it } from 'vitest';
import type { CapturedFrame } from '../capture/protocol';
import type { Rect } from '../core/types';
import { initialLiveState, type LiveState } from '../state/live';
import { createStore } from '../state/store';
import { ModelDownloadRequiredError, type TranslateRequest, type TranslationEngine } from '../translate/types';
import { TranslationSession, type SessionConfig, type TextReader } from './session';

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const frameWith = (bubbles: Rect[] = []): CapturedFrame => ({
  image: new Blob(['frame']),
  snapshot: null,
  width: 400,
  height: 300,
  bubbles,
});

/** Returns the queued OCR texts in order, one line per text line, stacked down the left side. */
class FakeReader implements TextReader {
  constructor(private readonly texts: string[]) {}
  async recognize() {
    const text = this.texts.shift() ?? '';
    const lines = text
      .split('\n')
      .filter(Boolean)
      .map((line, i) => ({ text: line, box: { x: 10, y: 10 + i * 30, w: 200, h: 20 } }));
    return { text, lines, ms: 5 };
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

function setup(mode: SessionConfig['mode'], texts: string[], bubbles: Rect[] = []) {
  const store = createStore<LiveState>(initialLiveState);
  const engine = new FakeEngine();
  const session = new TranslationSession(new FakeReader(texts), store, { mode, source: 'auto', target: 'ko', engine });
  const frame = async () => {
    session.handleFrame(frameWith(bubbles));
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

  it('translates a message that wraps inside one bubble as a single sentence', async () => {
    const bubble = { x: 0, y: 5, w: 250, h: 70 };
    const { store, engine, frame } = setup('chat', ['I really thought we were\ngoing to lose that one.'], [bubble]);
    await frame();
    expect(engine.calls).toEqual([['I really thought we were going to lose that one.']]);
    expect(store.get().layout?.units).toEqual([
      {
        source: 'I really thought we were going to lose that one.',
        sender: null,
        box: bubble,
        align: 'left',
        translated: 'T(I really thought we were going to lose that one.)',
        failed: false,
      },
    ]);
  });

  it('skips a bubble cut off by the top of the region', async () => {
    const cutOff = { x: 0, y: 0, w: 250, h: 35 };
    const whole = { x: 0, y: 35, w: 250, h: 30 };
    const { engine, frame } = setup('chat', ['lose that one.\nwait for me, brb'], [cutOff, whole]);
    await frame();
    expect(engine.calls).toEqual([['wait for me, brb']]);
  });

  it('ignores text outside the bubbles of a messenger', async () => {
    const bubbles = [
      { x: 0, y: 25, w: 250, h: 30 },
      { x: 0, y: 55, w: 250, h: 30 },
    ];
    const { engine, frame } = setup('chat', ['Game chat - Sam\ngg, that was close lol\nwait for me, brb'], bubbles);
    await frame();
    expect(engine.calls).toEqual([['gg, that was close lol', 'wait for me, brb']]);
  });

  it('translates group chat messages without the sender names', async () => {
    const bubbles = [
      { x: 0, y: 5, w: 250, h: 55 },
      { x: 0, y: 65, w: 250, h: 55 },
    ];
    const { store, engine, frame } = setup('chat', ['Kenji\nnext round?\nKenji\none more heal please'], bubbles);
    await frame();
    expect(engine.calls).toEqual([['next round?', 'one more heal please']]);
    expect(store.get().layout?.units.map((u) => [u.sender, u.source, u.translated])).toEqual([
      ['Kenji', 'next round?', 'T(next round?)'],
      ['Kenji', 'one more heal please', 'T(one more heal please)'],
    ]);
    expect(store.get().lines.map((l) => l.sender)).toEqual(['Kenji', 'Kenji']);
  });

  it('re-reads a bubble that whole-image OCR skipped', async () => {
    const store = createStore<LiveState>(initialLiveState);
    const engine = new FakeEngine();
    const reader: TextReader = {
      async recognize(_image, area) {
        const line = area
          ? { text: 'omw, hold on', box: { x: 260, y: 110, w: 120, h: 20 } }
          : { text: 'gg, that was close lol', box: { x: 10, y: 10, w: 200, h: 20 } };
        return { text: line.text, lines: [line], ms: 5 };
      },
    };
    const session = new TranslationSession(reader, store, { mode: 'chat', source: 'auto', target: 'ko', engine });
    session.handleFrame(frameWith([{ x: 250, y: 100, w: 140, h: 50 }]));
    await settle();
    expect(store.get().layout?.units.map((u) => [u.source, u.align])).toEqual([
      ['gg, that was close lol', 'left'],
      ['omw, hold on', 'right'],
    ]);
  });

  it('keeps showing translations for messages still on screen', async () => {
    const { store, engine, frame } = setup('chat', [
      'gg, that was close lol',
      'gg, that was close lol\nwait for me, brb',
    ]);
    await frame();
    await frame();
    expect(engine.calls).toEqual([['gg, that was close lol'], ['wait for me, brb']]);
    expect(store.get().layout?.units.map((u) => u.translated)).toEqual(['T(gg, that was close lol)', 'T(wait for me, brb)']);
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
