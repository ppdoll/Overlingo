export type Mode = 'chat' | 'subtitle';

/** Rectangle in pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rectangle as fractions (0..1) of the captured frame, so it survives resolution changes. */
export type NormRect = Rect;

export type EngineId = 'chrome' | 'gemini' | 'claude' | 'none';

/** Where a chat message sits: incoming bubbles on the left, your own on the right. */
export type Align = 'left' | 'right' | 'full';
