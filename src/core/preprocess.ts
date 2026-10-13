export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Prepares a captured region for Tesseract, in place: grayscale, stretched contrast, and dark
 * text on a light background. Tesseract reads light-on-dark text poorly, and most subtitles and
 * dark-themed chat windows are exactly that.
 */
export function prepareForOcr(image: RgbaImage): void {
  const { data } = image;
  const pixels = image.width * image.height;
  const luminance = new Uint8Array(pixels);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; p < pixels; i += 4, p++) {
    const v = ((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000) | 0;
    luminance[p] = v;
    histogram[v]++;
  }

  const low = percentile(histogram, pixels, 0.02);
  const high = percentile(histogram, pixels, 0.98);
  const range = Math.max(1, high - low);
  // The background covers most of the region, so the median tells us its brightness.
  const invert = percentile(histogram, pixels, 0.5) < (low + high) / 2;

  for (let i = 0, p = 0; p < pixels; i += 4, p++) {
    let v = Math.max(0, Math.min(255, ((luminance[p] - low) * 255) / range));
    if (invert) v = 255 - v;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
}

function percentile(histogram: Uint32Array, total: number, fraction: number): number {
  const target = total * fraction;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += histogram[v];
    if (seen >= target) return v;
  }
  return 255;
}
