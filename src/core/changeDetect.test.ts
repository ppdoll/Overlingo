import { describe, expect, it } from 'vitest';
import { signatureDiff, StabilityGate, toGray } from './changeDetect';

const filled = (value: number, length = 64) => new Uint8Array(length).fill(value);

describe('toGray', () => {
  it('weights channels by perceived brightness', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    expect([...toGray(rgba)]).toEqual([255, 0, 76]);
  });
});

describe('signatureDiff', () => {
  it('is 0 for identical signatures and 1 for opposite or mismatched ones', () => {
    expect(signatureDiff(filled(10), filled(10))).toBe(0);
    expect(signatureDiff(filled(0), filled(255))).toBe(1);
    expect(signatureDiff(filled(0, 8), filled(0, 16))).toBe(1);
  });
});

describe('StabilityGate', () => {
  const options = { threshold: 0.02, stableMs: 200, maxWaitMs: 1000 };
  const A = filled(10);
  const B = filled(200);

  it('fires once a change has settled, and not again for the same picture', () => {
    const gate = new StabilityGate(options);
    expect(gate.push(A, 0)).toBe(false);
    expect(gate.push(A, 100)).toBe(false);
    expect(gate.push(A, 250)).toBe(true);
    expect(gate.push(A, 300)).toBe(false);
    expect(gate.push(B, 400)).toBe(false);
    expect(gate.push(B, 650)).toBe(true);
  });

  it('does not fire when the region flickers back to what was already read', () => {
    const gate = new StabilityGate(options);
    gate.push(B, 0);
    expect(gate.push(B, 250)).toBe(true);
    expect(gate.push(A, 300)).toBe(false);
    expect(gate.push(B, 350)).toBe(false);
    expect(gate.push(B, 600)).toBe(false);
  });

  it('keeps firing at maxWaitMs while the region never settles', () => {
    const gate = new StabilityGate(options);
    const fired: number[] = [];
    for (let t = 2000; t <= 4100; t += 50) {
      if (gate.push(((t - 2000) / 50) % 2 === 0 ? A : B, t)) fired.push(t);
    }
    expect(fired).toEqual([3000, 4050]);
  });

  it('starts over after reset', () => {
    const gate = new StabilityGate(options);
    gate.push(A, 0);
    expect(gate.push(A, 250)).toBe(true);
    gate.reset();
    gate.push(A, 300);
    expect(gate.push(A, 550)).toBe(true);
  });
});
