import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { wrapText } from '../core/wrap';
import { layoutOverlay, type Measure, type Origin } from './layout';
import './overlay.css';
import type { OverlayState } from './state';

// The overlay window: transparent, click-through, covering one monitor. It only draws; the
// main window does capture, OCR and translation and sends the results here.

const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
const PADDING_X = 10;
const PADDING_Y = 6;
const LINE_HEIGHT = 1.4;

const context = document.createElement('canvas').getContext('2d')!;

/** Height of a label. Matches .label in overlay.css. */
const measure: Measure = (text, width, fontSize) => {
  context.font = `${fontSize}px ${FONT_FAMILY}`;
  const lines = wrapText(text, width - PADDING_X * 2, (line) => context.measureText(line).width);
  return lines.length * fontSize * LINE_HEIGHT + PADDING_Y * 2;
};

function Overlay() {
  const [state, setState] = useState<OverlayState | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const overlay = getCurrentWindow();
    const refresh = async () => {
      const position = await overlay.outerPosition();
      setOrigin({ x: position.x, y: position.y, scale: await overlay.scaleFactor() });
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    void refresh();
    const subscriptions = [
      listen<OverlayState>('overlay-state', (event) => setState(event.payload)),
      overlay.onMoved(() => void refresh()),
      overlay.onResized(() => void refresh()),
      overlay.onScaleChanged(() => void refresh()),
    ];
    // Ask for the current state; translations may already be on their way.
    void emitTo('main', 'overlay-ready');
    return () => {
      for (const subscription of subscriptions) void subscription.then((unlisten) => unlisten());
    };
  }, []);

  if (!state || !origin || !state.visible) return null;
  return (
    <>
      {layoutOverlay(state, origin, viewport, measure).map((label, i) => (
        <div
          key={i}
          className={`label ${label.kind}${state.stale ? ' stale' : ''}`}
          style={{ left: label.rect.x, top: label.rect.y, width: label.rect.w, fontSize: label.fontSize }}
        >
          {label.text}
        </div>
      ))}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
);
