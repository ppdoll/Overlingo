import { useEffect, useRef } from 'react';
import type { ChatLayout, LayoutUnit, LiveLine } from '../state/live';

/**
 * Each chat bubble on screen, cut from the latest snapshot, next to its translation.
 * Incoming bubbles get the translation on their right, your own on their left.
 */
export function ChatAside({ layout }: { layout: ChatLayout | null }) {
  if (!layout) return <p className="muted">채팅을 읽는 중…</p>;
  if (layout.units.length === 0) return <p className="muted">영역에서 채팅을 찾지 못했어요</p>;
  // One scale for every bubble, so their text sizes match the original chat.
  const widest = Math.max(...layout.units.map((unit) => unit.box.w));
  return (
    <ul className="aside">
      {layout.units.map((unit, i) => (
        <li key={`${i}:${unit.source}`} className={`aside-row ${unit.align}`}>
          {layout.imageUrl && unit.box.w > 0 ? (
            <BubbleCrop url={layout.imageUrl} unit={unit} width={layout.width} height={layout.height} widest={widest} />
          ) : (
            <p className="aside-source">{unit.source}</p>
          )}
          <p className="aside-translation">
            {unit.translated ?? <span className="muted">{unit.failed ? '번역하지 못했어요' : '번역 중…'}</span>}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Shows just `unit.box` of the snapshot, the widest bubble filling the column, using CSS only. */
function BubbleCrop({
  url,
  unit,
  width,
  height,
  widest,
}: {
  url: string;
  unit: LayoutUnit;
  width: number;
  height: number;
  widest: number;
}) {
  const { box } = unit;
  // Background percentages line up point p% of the image with p% of the element.
  const position = (offset: number, size: number, total: number) => (total > size ? (offset / (total - size)) * 100 : 0);
  return (
    <div
      className="bubble-crop"
      role="img"
      aria-label={unit.source}
      style={{
        width: `${(box.w / widest) * 100}%`,
        aspectRatio: `${box.w} / ${box.h}`,
        maxWidth: box.w,
        backgroundImage: `url(${url})`,
        backgroundSize: `${(width / box.w) * 100}% auto`,
        backgroundPosition: `${position(box.x, box.w, width)}% ${position(box.y, box.h, height)}%`,
      }}
    />
  );
}

/** Translations only, laid out like the chat: incoming on the left, your own on the right. */
export function ChatBubbles({ lines, showOriginal }: { lines: LiveLine[]; showOriginal: boolean }) {
  const endRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);
  if (lines.length === 0) return <p className="muted">새 채팅을 기다리는 중…</p>;
  return (
    <ul className="bubbles">
      {lines.map((line, i) => (
        <li key={line.id} ref={i === lines.length - 1 ? endRef : undefined} className={`bubble ${line.align ?? 'left'}`}>
          <p>{line.translated ?? (line.failed ? line.source : '…')}</p>
          {showOriginal && line.translated && <p className="source">{line.source}</p>}
        </li>
      ))}
    </ul>
  );
}
