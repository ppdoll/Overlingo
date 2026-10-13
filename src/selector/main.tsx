import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { StrictMode, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { ScreenRect } from '../platform/desktop';
import './selector.css';

// One of these windows covers each monitor, showing a frozen screenshot of it. Dragging picks
// the region to translate; Esc cancels on every monitor at once.

interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Smaller drags are taken as stray clicks. */
const MIN_SIZE = 12;

async function finish(rect: { x: number; y: number; w: number; h: number } | null) {
  let region: ScreenRect | null = null;
  if (rect) {
    const position = await getCurrentWindow().outerPosition();
    const scale = window.devicePixelRatio;
    region = {
      x: position.x + Math.round(rect.x * scale),
      y: position.y + Math.round(rect.y * scale),
      width: Math.round(rect.w * scale),
      height: Math.round(rect.h * scale),
    };
  }
  await invoke('finish_region_select', { region });
}

function normalize(drag: Drag) {
  return {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    w: Math.abs(drag.x1 - drag.x0),
    h: Math.abs(drag.y1 - drag.y0),
  };
}

function Selector() {
  const [shot, setShot] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let url: string | null = null;
    void invoke<ArrayBuffer>('selector_shot').then((bytes) => {
      url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      setShot(url);
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void finish(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    setDrag({ x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY });
  };
  const onPointerMove = (event: PointerEvent) => {
    if (dragging.current) setDrag((d) => d && { ...d, x1: event.clientX, y1: event.clientY });
  };
  const onPointerUp = () => {
    dragging.current = false;
    if (!drag) return;
    const rect = normalize(drag);
    if (rect.w >= MIN_SIZE && rect.h >= MIN_SIZE) void finish(rect);
    else setDrag(null);
  };

  const box = drag && normalize(drag);
  const scale = window.devicePixelRatio;
  return (
    <div
      className="selector"
      style={{ backgroundImage: shot ? `url(${shot})` : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {box ? (
        <div className="selection" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
          <span className="size">
            {Math.round(box.w * scale)} × {Math.round(box.h * scale)}
          </span>
        </div>
      ) : (
        <div className="shade" />
      )}
      <div className="hint">번역할 채팅이나 자막을 드래그해서 지정하세요 · Esc를 누르면 취소</div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Selector />
  </StrictMode>,
);
