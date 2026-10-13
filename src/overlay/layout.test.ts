import { describe, expect, it } from 'vitest';
import { layoutOverlay, type Measure } from './layout';
import type { OverlayState } from './state';

/** Roughly 0.6em per character, 1.4 line height, 12px of padding. */
const measure: Measure = (text, width, fontSize) =>
  Math.ceil((text.length * fontSize * 0.6) / width) * fontSize * 1.4 + 12;

const origin = { x: 0, y: 0, scale: 1 };
const viewport = { width: 1920, height: 1080 };

/** A 400x600 chat region at (500, 200), read at 2x for OCR. */
function chatState(items: NonNullable<OverlayState['chat']>['items']): OverlayState {
  return {
    region: { x: 500, y: 200, width: 400, height: 600 },
    mode: 'chat',
    fontSize: 16,
    visible: true,
    stale: false,
    chat: { frameWidth: 800, frameHeight: 1200, bubbles: items.map((item) => item.box), items },
    subtitle: null,
  };
}

describe('layoutOverlay', () => {
  it('puts translations of incoming bubbles on their right and your own on their left', () => {
    const labels = layoutOverlay(
      chatState([
        { box: { x: 20, y: 100, w: 400, h: 120 }, align: 'left', text: '다음 라운드 갈래?' },
        { box: { x: 500, y: 300, w: 280, h: 80 }, align: 'right', text: '금방 갈게, 잠깐만' },
      ]),
      origin,
      viewport,
      measure,
    );
    expect(labels).toHaveLength(2);
    // Incoming bubble spans x 510..710 on screen; its translation starts right after it.
    expect(labels[0].rect.x).toBeGreaterThanOrEqual(710);
    // Outgoing bubble starts at x 750; its translation ends before it.
    expect(labels[1].rect.x + labels[1].rect.w).toBeLessThanOrEqual(750);
  });

  it('keeps translations from overlapping each other', () => {
    const labels = layoutOverlay(
      chatState([
        { box: { x: 20, y: 100, w: 400, h: 40 }, align: 'left', text: 'a fairly long translation that wraps over a few lines' },
        { box: { x: 20, y: 150, w: 400, h: 40 }, align: 'left', text: 'another one right below it' },
      ]),
      origin,
      viewport,
      measure,
    );
    const [a, b] = labels.map((label) => label.rect);
    const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0 && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0;
    expect(overlap).toBe(false);
  });

  it('converts physical screen pixels for scaled displays and other monitors', () => {
    const state = chatState([{ box: { x: 20, y: 100, w: 400, h: 120 }, align: 'left', text: '안녕' }]);
    const [label] = layoutOverlay(state, { x: 0, y: 0, scale: 2 }, viewport, measure);
    // Bubble right edge: (500 + 210) / 2 = 355 CSS pixels.
    expect(label.rect.x).toBeGreaterThanOrEqual(355);
    expect(label.rect.x).toBeLessThan(400);
  });

  it('shows subtitles below the line, or above it when there is no room', () => {
    const subtitle = (y: number): OverlayState => ({
      ...chatState([]),
      mode: 'subtitle',
      chat: null,
      region: { x: 300, y, width: 800, height: 60 },
      subtitle: '여기서 널 다시 보게 될 줄은 몰랐어.',
    });
    const [below] = layoutOverlay(subtitle(700), origin, viewport, measure);
    expect(below.rect.y).toBeGreaterThanOrEqual(760);
    const [above] = layoutOverlay(subtitle(1010), origin, viewport, measure);
    expect(above.rect.y + above.rect.h).toBeLessThanOrEqual(1010);
  });
});
