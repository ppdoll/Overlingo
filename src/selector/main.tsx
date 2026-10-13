import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { StrictMode, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { PickedWindow, ScreenRect } from '../platform/desktop';
import './selector.css';

// One of these windows covers each monitor, showing a frozen screenshot of it. Clicking a
// window picks the whole window; dragging picks part of the window the drag starts on (or of
// the screen, outside any window). A picked window is followed when it moves or is resized.
// Esc cancels on every monitor at once.

/** A rectangle in this selector window's CSS pixels. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A window the user can pick, and where it is in this selector. */
interface Pickable {
  window: PickedWindow;
  box: Box;
}

interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The window the drag started on. */
  on: Pickable | null;
}

/** Where this selector window is on the virtual desktop (physical pixels), and its scale. */
interface Frame {
  x: number;
  y: number;
  scale: number;
}

/** Smaller drags are taken as clicks. */
const MIN_SIZE = 12;

async function finish(region: ScreenRect | null, window: PickedWindow | null) {
  await invoke('finish_region_select', { region, window: window?.id ?? null });
}

function toScreen(box: Box, frame: Frame): ScreenRect {
  return {
    x: frame.x + Math.round(box.x * frame.scale),
    y: frame.y + Math.round(box.y * frame.scale),
    width: Math.round(box.w * frame.scale),
    height: Math.round(box.h * frame.scale),
  };
}

function toLocal(rect: ScreenRect, frame: Frame): Box {
  return {
    x: (rect.x - frame.x) / frame.scale,
    y: (rect.y - frame.y) / frame.scale,
    w: rect.width / frame.scale,
    h: rect.height / frame.scale,
  };
}

function normalize(drag: Drag): Box {
  return {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    w: Math.abs(drag.x1 - drag.x0),
    h: Math.abs(drag.y1 - drag.y0),
  };
}

function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

function Selector() {
  const [shot, setShot] = useState<string | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [windows, setWindows] = useState<Pickable[]>([]);
  const [hover, setHover] = useState<Pickable | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let url: string | null = null;
    void invoke<ArrayBuffer>('selector_shot').then((bytes) => {
      url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      setShot(url);
    });
    void (async () => {
      const position = await getCurrentWindow().outerPosition();
      const here = { x: position.x, y: position.y, scale: window.devicePixelRatio };
      const list = await invoke<PickedWindow[]>('selector_windows');
      setFrame(here);
      setWindows(list.map((picked) => ({ window: picked, box: toLocal(picked.rect, here) })));
    })();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void finish(null, null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  /** The topmost window at a point. */
  const windowAt = (x: number, y: number) =>
    windows.find(({ box }) => x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) ?? null;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    const { clientX: x, clientY: y } = event;
    setDrag({ x0: x, y0: y, x1: x, y1: y, on: windowAt(x, y) });
  };
  const onPointerMove = (event: PointerEvent) => {
    if (dragging.current) setDrag((d) => d && { ...d, x1: event.clientX, y1: event.clientY });
    else setHover(windowAt(event.clientX, event.clientY));
  };
  const onPointerUp = () => {
    dragging.current = false;
    if (!drag || !frame) return;
    const box = normalize(drag);
    if (box.w >= MIN_SIZE && box.h >= MIN_SIZE) {
      // Part of a window: kept inside it, so it can follow the window.
      const inside = drag.on && intersect(box, drag.on.box);
      if (drag.on && inside && inside.w >= MIN_SIZE && inside.h >= MIN_SIZE) void finish(toScreen(inside, frame), drag.on.window);
      else void finish(toScreen(box, frame), null);
    } else if (drag.on) {
      void finish(drag.on.window.rect, drag.on.window);
    } else {
      setDrag(null);
    }
  };

  const selection = drag && normalize(drag);
  const scale = frame?.scale ?? window.devicePixelRatio;
  return (
    <div
      className="selector"
      style={{ backgroundImage: shot ? `url(${shot})` : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {selection && (selection.w >= MIN_SIZE || selection.h >= MIN_SIZE) ? (
        <>
          {drag?.on && <div className="window-outline" style={boxStyle(drag.on.box)} />}
          <div className="selection" style={boxStyle(selection)}>
            <span className="size">
              {Math.round(selection.w * scale)} × {Math.round(selection.h * scale)}
            </span>
          </div>
        </>
      ) : hover ? (
        <div className="window-highlight" style={boxStyle(hover.box)}>
          <span className="window-label" style={{ left: Math.max(0, -hover.box.x) + 8, top: Math.max(0, -hover.box.y) + 8 }}>
            {hover.window.title}
            {hover.window.app && <span className="window-app">{hover.window.app}</span>}
          </span>
        </div>
      ) : (
        <div className="shade" />
      )}
      <div className="hint">
        창을 클릭하면 그 창을 따라가며 번역해요 · 일부만 번역하려면 드래그 · Esc를 누르면 취소
      </div>
    </div>
  );
}

function boxStyle(box: Box) {
  return { left: box.x, top: box.y, width: box.w, height: box.h };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Selector />
  </StrictMode>,
);
