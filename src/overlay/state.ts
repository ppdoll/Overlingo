import type { Align, Mode, Rect } from '../core/types';
import type { ScreenRect } from '../platform/desktop';
import type { LiveState } from '../state/live';
import type { Settings } from '../state/settings';

/** What the main window sends the overlay window: everything it needs to draw. */
export interface OverlayState {
  /** Where the captured region is on screen, in physical pixels. */
  region: ScreenRect;
  mode: Mode;
  fontSize: number;
  /** Hidden while translation is paused. */
  visible: boolean;
  /** The chat is moving, so bubble positions are out of date until the next read. */
  stale: boolean;
  chat: {
    /** Size of the OCR image that bubble boxes are measured in. */
    frameWidth: number;
    frameHeight: number;
    /** Every bubble on screen, to keep translations from covering them. */
    bubbles: Rect[];
    items: { box: Rect; align: Align; text: string }[];
  } | null;
  subtitle: string | null;
}

/**
 * `stale`: the chat moved since it was last read. `hidden`: the followed window is minimized or
 * covered, so its translations shouldn't float over whatever is there now.
 */
export function buildOverlayState(
  live: LiveState,
  settings: Settings,
  region: ScreenRect,
  { stale, hidden }: { stale: boolean; hidden: boolean },
): OverlayState {
  const { layout } = live;
  return {
    region,
    mode: settings.mode,
    fontSize: settings.pipFontSize,
    visible: live.status === 'running' && !hidden,
    stale,
    chat:
      settings.mode === 'chat' && layout
        ? {
            frameWidth: layout.width,
            frameHeight: layout.height,
            bubbles: layout.units.map((unit) => unit.box),
            items: layout.units.flatMap((unit) =>
              unit.translated ? [{ box: unit.box, align: unit.align, text: unit.translated }] : [],
            ),
          }
        : null,
    subtitle: settings.mode === 'subtitle' ? (live.subtitle?.translated ?? null) : null,
  };
}
