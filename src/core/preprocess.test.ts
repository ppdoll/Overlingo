import { describe, expect, it } from 'vitest';
import { prepareForOcr } from './preprocess';

/** 10x10 image with `textPixels` pixels of `text` color on a `background` color. */
function image(background: number, text: number, textPixels = 10) {
  const data = new Uint8ClampedArray(100 * 4);
  for (let p = 0; p < 100; p++) {
    const v = p < textPixels ? text : background;
    data.set([v, v, v, 128], p * 4);
  }
  return { data, width: 10, height: 10 };
}

describe('prepareForOcr', () => {
  it('turns light text on a dark background into dark text on white', () => {
    const img = image(20, 230);
    prepareForOcr(img);
    expect(img.data[0]).toBe(0);
    expect(img.data[50 * 4]).toBe(255);
  });

  it('keeps dark text on a light background and stretches the contrast', () => {
    const img = image(240, 30);
    prepareForOcr(img);
    expect(img.data[0]).toBe(0);
    expect(img.data[50 * 4]).toBe(255);
  });

  it('writes opaque grayscale pixels', () => {
    const img = image(240, 30);
    prepareForOcr(img);
    expect([...img.data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
  });
});
