import { IconEye, IconLayoutColumns, IconList, IconMinus, IconPlayerPause, IconPlayerPlay, IconPlus } from '@tabler/icons-react';
import { Component, type ReactNode } from 'react';
import type { OverlingoController } from '../app/controller';
import type { LiveLine } from '../state/live';
import { useStore } from '../state/store';
import { ChatAside, ChatBubbles } from './ChatViews';

const MIN_FONT = 12;
const MAX_FONT = 40;
const CHAT_LINES = 8;

/** Contents of the always-on-top PiP window. */
export function PipView({ controller }: { controller: OverlingoController }) {
  return (
    <PipErrorBoundary>
      <PipContent controller={controller} />
    </PipErrorBoundary>
  );
}

function PipContent({ controller }: { controller: OverlingoController }) {
  const live = useStore(controller.live);
  const { mode, pipFontSize, showOriginal, chatView } = useStore(controller.settings);
  const running = live.status === 'running';

  return (
    <div className="pip">
      <div className="pip-body" style={{ fontSize: pipFontSize }}>
        {mode === 'subtitle' ? (
          <Subtitle line={live.subtitle} showOriginal={showOriginal} />
        ) : chatView === 'aside' ? (
          <ChatAside layout={live.layout} />
        ) : (
          <ChatBubbles lines={live.lines.slice(-CHAT_LINES)} showOriginal={showOriginal} />
        )}
      </div>
      <div className="pip-controls">
        <button aria-label="글자 작게" onClick={() => controller.updateSettings({ pipFontSize: Math.max(MIN_FONT, pipFontSize - 2) })}>
          <IconMinus size={16} />
        </button>
        <button aria-label="글자 크게" onClick={() => controller.updateSettings({ pipFontSize: Math.min(MAX_FONT, pipFontSize + 2) })}>
          <IconPlus size={16} />
        </button>
        {mode === 'chat' ? (
          <>
            <button
              className={chatView === 'aside' ? 'primary' : ''}
              aria-pressed={chatView === 'aside'}
              onClick={() => controller.updateSettings({ chatView: 'aside' })}
            >
              <IconLayoutColumns size={16} />
              나란히
            </button>
            <button
              className={chatView === 'list' ? 'primary' : ''}
              aria-pressed={chatView === 'list'}
              onClick={() => controller.updateSettings({ chatView: 'list' })}
            >
              <IconList size={16} />
              목록
            </button>
          </>
        ) : (
          <button
            className={showOriginal ? 'primary' : ''}
            aria-pressed={showOriginal}
            onClick={() => controller.updateSettings({ showOriginal: !showOriginal })}
          >
            <IconEye size={16} />
            원문
          </button>
        )}
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

/** A rendering error would otherwise leave the PiP window blank with no way to recover. */
class PipErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="pip-error">
        <p>번역 창을 그리다 문제가 생겼어요.</p>
        <p className="muted small">{this.state.error.message}</p>
        <button onClick={() => this.setState({ error: null })}>다시 그리기</button>
      </div>
    );
  }
}
