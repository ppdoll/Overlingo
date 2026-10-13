import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clamp, rectFromPoints } from '../core/geometry';
import type { NormRect } from '../core/types';

const MIN_SIZE = 0.01;

/**
 * Live view of the captured stream. When interactive, dragging selects the region to translate.
 * The box always has the video's aspect ratio, so pointer positions map directly to the frame.
 */
export function RegionPicker({
  stream,
  region,
  onChange,
  maxHeightVh = 60,
}: {
  stream: MediaStream | null;
  region: NormRect | null;
  onChange?: (region: NormRect) => void;
  maxHeightVh?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [draft, setDraft] = useState<NormRect | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    const updateAspect = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) setAspect(video.videoWidth / video.videoHeight);
    };
    video.addEventListener('loadedmetadata', updateAspect);
    video.addEventListener('resize', updateAspect);
    if (stream) void video.play().catch(() => {});
    return () => {
      video.removeEventListener('loadedmetadata', updateAspect);
      video.removeEventListener('resize', updateAspect);
    };
  }, [stream]);

  const pointAt = (event: PointerEvent) => {
    const box = boxRef.current!.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left) / box.width, 0, 1),
      y: clamp((event.clientY - box.top) / box.height, 0, 1),
    };
  };

  const interactive = onChange !== undefined;
  const handlers = interactive
    ? {
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragFrom.current = pointAt(event);
        },
        onPointerMove: (event: PointerEvent) => {
          const from = dragFrom.current;
          if (!from) return;
          const to = pointAt(event);
          setDraft(rectFromPoints(from.x, from.y, to.x, to.y));
        },
        onPointerUp: () => {
          if (draft && draft.w > MIN_SIZE && draft.h > MIN_SIZE) onChange(draft);
          dragFrom.current = null;
          setDraft(null);
        },
        onPointerCancel: () => {
          dragFrom.current = null;
          setDraft(null);
        },
      }
    : {};

  const shown = draft ?? region;
  return (
    <div
      ref={boxRef}
      className={`region-picker${interactive ? ' interactive' : ''}`}
      style={{ aspectRatio: String(aspect), width: `min(100%, ${(maxHeightVh * aspect).toFixed(1)}vh)` }}
      {...handlers}
    >
      <video ref={videoRef} muted playsInline />
      {shown && (
        <div
          className="region-box"
          style={{
            left: `${shown.x * 100}%`,
            top: `${shown.y * 100}%`,
            width: `${shown.w * 100}%`,
            height: `${shown.h * 100}%`,
          }}
        >
          {interactive && !draft && <span className="region-label">번역 영역</span>}
        </div>
      )}
    </div>
  );
}
