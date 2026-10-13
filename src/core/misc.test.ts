import { describe, expect, it } from 'vitest';
import { rectFromPoints, toPixelRect } from './geometry';
import { ocrLanguagesFor, sameLanguage } from './languages';
import { LruCache } from './lru';
import { similarity } from './similarity';

describe('geometry', () => {
  it('converts normalized rects to pixels inside the frame', () => {
    expect(toPixelRect({ x: 0.5, y: 0.5, w: 0.6, h: 0.2 }, 100, 50)).toEqual({ x: 50, y: 25, w: 50, h: 10 });
  });

  it('builds a rect from a drag in any direction', () => {
    const r = rectFromPoints(0.8, 0.9, 0.2, 0.1);
    expect(r.x).toBeCloseTo(0.2);
    expect(r.y).toBeCloseTo(0.1);
    expect(r.w).toBeCloseTo(0.6);
    expect(r.h).toBeCloseTo(0.8);
  });
});

describe('languages', () => {
  it('compares base languages but keeps Traditional Chinese separate', () => {
    expect(sameLanguage('en-US', 'en')).toBe(true);
    expect(sameLanguage('zh-Hant', 'zh')).toBe(false);
    expect(sameLanguage('zh-Hant-TW', 'zh-Hant')).toBe(true);
  });

  it('loads the OCR language for the source, or the auto list', () => {
    expect(ocrLanguagesFor('ja', ['eng'])).toEqual(['jpn']);
    expect(ocrLanguagesFor('auto', ['eng', 'jpn'])).toEqual(['eng', 'jpn']);
    expect(ocrLanguagesFor('auto', [])).toEqual(['eng']);
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(2);
  });
});

describe('similarity', () => {
  it('scores identical strings 1 and unrelated ones low', () => {
    expect(similarity('', '')).toBe(1);
    expect(similarity('kitten', 'kitten')).toBe(1);
    expect(similarity('kitten', 'sitting')).toBeCloseTo(1 - 3 / 7);
  });
});
