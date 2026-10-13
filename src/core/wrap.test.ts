import { describe, expect, it } from 'vitest';
import { wrapText } from './wrap';

/** Every character is 10 wide. */
const widthOf = (text: string) => text.length * 10;

describe('wrapText', () => {
  it('wraps at word boundaries', () => {
    expect(wrapText('see you at the bridge', 100, widthOf)).toEqual(['see you at', 'the bridge']);
  });

  it('wraps Japanese by character', () => {
    expect(wrapText('次のラウンド行く', 50, widthOf)).toEqual(['次のラウン', 'ド行く']);
  });

  it('keeps line breaks and blank lines', () => {
    expect(wrapText('Nice save!\n\nGo', 200, widthOf)).toEqual(['Nice save!', '', 'Go']);
  });
});
