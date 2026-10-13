import { IconEye, IconMinus, IconPlayerPause, IconPlayerPlay, IconPlus } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';
import type { OverlingoController } from '../app/controller';
import type { LiveLine } from '../state/live';
import { useStore } from '../state/store';

const MIN_FONT = 12;
const MAX_FONT = 40;
const CHAT_LINES = 6;

/** Contents of the always-on-top PiP window. */
export function PipView({ controller }: { controller: OverlingoController }) {
  const live = useStore(controller.live);
  const { mode, pipFontSize, showOriginal } = useStore(controller.settings);
  const running = live.status === 'running';

  return (
    <div className="pip">
      <div className="pip-body" style={{ fontSize: pipFontSize }}>
        {mode === 'subtitle' ? (
          <Subtitle line={live.subtitle} showOriginal={showOriginal} />
        ) : (
          <Chat lines={live.lines.slice(-CHAT_LINES)} showOriginal={showOriginal} />
        )}
      </div>
      <div className="pip-controls">
        <button aria-label="글자 작게" onClick={() => controller.updateSettings({ pipFontSize: Math.max(MIN_FONT, pipFontSize - 2) })}>
          <IconMinus size={16} />
        </button>
        <button aria-label="글자 크게" onClick={() => controller.updateSettings({ pipFontSize: Math.min(MAX_FONT, pipFontSize + 2) })}>
          <IconPlus size={16} />
        </button>
        <button
          className={showOriginal ? 'primary' : ''}
          aria-pressed={showOriginal}
          onClick={() => controller.updateSettings({ showOriginal: !showOriginal })}
        >
          <IconEye size={16} />
          원문
        </button>
        {running ? (
          <button className="push" aria-label="일시정지" onClick={() => controller.pause()}>
            <IconPlayerPause size={16} />
          </button>
        ) : (
          <button className="push" aria-label="다시 시작" onClick={() => controller.resume()}>
            <IconPlayerPlay size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function Subtitle({ line, showOriginal }: { line: LiveLine | null; showOriginal: boolean }) {
  if (!line) return <p className="muted">자막을 기다리는 중…</p>;
  return (
    <div className="pip-subtitle">
      <p className="translated">{line.translated ?? (line.failed ? line.source : '…')}</p>
      {showOriginal && <p className="source">{line.source}</p>}
    </div>
  );
}

function Chat({ lines, showOriginal }: { lines: LiveLine[]; showOriginal: boolean }) {
  const endRef = useRef<HTMLLIElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [lines]);
  if (lines.length === 0) return <p className="muted">새 채팅을 기다리는 중…</p>;
  return (
    <div className="pip-chat">
      <ul>
        {lines.map((line, i) => (
          <li key={line.id} ref={i === lines.length - 1 ? endRef : undefined}>
            <p>{line.translated ?? (line.failed ? line.source : '…')}</p>
            {showOriginal && <p className="source">{line.source}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
