/** Converts RGBA pixels to one luminance byte per pixel (Rec. 601 weights). */
export function toGray(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  }
  return out;
}

/** Mean absolute difference of two signatures, from 0 (same) to 1. Different sizes count as 1. */
export function signatureDiff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return 1;
  if (a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 255);
}

export interface GateOptions {
  /** Signature difference that counts as a change. */
  threshold: number;
  /** How long the region must stay unchanged before it is read. */
  stableMs: number;
  /** Read anyway after this long, for regions that never settle (subtitles over moving video). */
  maxWaitMs: number;
}

/**
 * Decides when a captured region is worth running OCR on: once it has changed and then
 * settled, or periodically while it keeps changing. Never fires twice for the same picture.
 */
export class StabilityGate {
  private last: Uint8Array | null = null;
  private emitted: Uint8Array | null = null;
  private pendingSince: number | null = null;
  private lastChangeAt = 0;

  constructor(private readonly options: GateOptions) {}

  /** A change has started and hasn't been read yet. */
  get changing(): boolean {
    return this.pendingSince !== null;
  }

  push(signature: Uint8Array, now: number): boolean {
    const { threshold, stableMs, maxWaitMs } = this.options;
    if (!this.last || signatureDiff(signature, this.last) > threshold) {
      this.lastChangeAt = now;
      this.pendingSince ??= now;
    }
    this.last = signature;
    if (this.pendingSince === null) return false;

    const settled = now - this.lastChangeAt >= stableMs;
    const overdue = now - this.pendingSince >= maxWaitMs;
    if (!settled && !overdue) return false;

    this.pendingSince = null;
    if (this.emitted && signatureDiff(signature, this.emitted) <= threshold) return false;
    this.emitted = signature;
    return true;
  }

  reset(): void {
    this.last = null;
    this.emitted = null;
    this.pendingSince = null;
  }
}
