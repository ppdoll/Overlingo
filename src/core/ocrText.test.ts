import { describe, expect, it } from 'vitest';
import { cleanOcrText, isLikelyText } from './ocrText';

describe('cleanOcrText', () => {
  it('removes the spaces Tesseract puts between Japanese characters', () => {
    expect(cleanOcrText('次 の ラ ウ ン ド 行 く ？')).toEqual(['次のラウンド行く?']);
  });

  it('keeps the spaces between Korean words', () => {
    expect(cleanOcrText('다음  라운드 갈래?')).toEqual(['다음 라운드 갈래?']);
  });

  it('reads a lone vertical bar as a capital I', () => {
    expect(cleanOcrText("| never thought |'d see you here")).toEqual(["I never thought I'd see you here"]);
  });

  it('drops empty lines and border noise', () => {
    expect(cleanOcrText('|\n\n— —\ngg, that was close lol\n...')).toEqual(['gg, that was close lol']);
  });
});

describe('isLikelyText', () => {
  it('accepts a single CJK character but not a single Latin letter', () => {
    expect(isLikelyText('是')).toBe(true);
    expect(isLikelyText('a')).toBe(false);
  });

  it('rejects lines that are mostly symbols', () => {
    expect(isLikelyText('#|=-a')).toBe(false);
    expect(isLikelyText('ナイス!')).toBe(true);
  });
});
