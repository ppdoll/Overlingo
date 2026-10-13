import { IconCrop, IconPictureInPicture, IconPlayerPause, IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import type { OverlingoController } from '../app/controller';
import { AUTO } from '../core/languages';
import type { LiveLine } from '../state/live';
import { useStore } from '../state/store';
import { ChatAside } from './ChatViews';
import { Banner, formatTime, languageLabel } from './common';
import { isDesktop } from '../platform/desktop';
import { openPip, pipSupported } from './pip';
import { RegionPicker } from './RegionPicker';
import { RegionStill } from './RegionSelect';

export function LiveView({ controller }: { controller: OverlingoController }) {
  const ui = useStore(controller.ui);
  const live = useStore(controller.live);
  const settings = useStore(controller.settings);
  const engine = controller.engineFor(settings.mode);
  const { stats } = live;
  const running = live.status === 'running';
  const wanted = settings.engines[settings.mode];

  return (
    <main className="stack">
      <div className="card status-bar row">
        <span className={`dot${running ? ' on' : ''}`} />
        <strong>{running ? '번역 중' : live.status === 'paused' ? '일시정지' : '준비 중'}</strong>
        <span className="chip">{settings.mode === 'chat' ? '채팅 모드' : '자막 모드'}</span>
        <span className="chip">
          {languageLabel(settings.source)} → {languageLabel(settings.target)}
        </span>
        <span className="chip">번역 · {engine.label}</span>
        {isDesktop && ui.overlayOn && <span className="chip success">오버레이 표시 중</span>}
        <div className="push actions">
          {running ? (
            <button className="icon" aria-label="일시정지" title="일시정지" onClick={() => controller.pause()}>
              <IconPlayerPause size={18} />
            </button>
          ) : (
            <button className="icon" aria-label="다시 시작" title="다시 시작" onClick={() => controller.resume()}>
              <IconPlayerPlay size={18} />
            </button>
          )}
          <button className="icon" aria-label="영역 다시 지정" title="영역 다시 지정" onClick={() => controller.reselectRegion()}>
            <IconCrop size={18} />
          </button>
          {!isDesktop && pipSupported() && !ui.pipOpen && (
            <button className="primary" onClick={() => void openPip(controller)}>
              <IconPictureInPicture size={18} />
              PiP 창 열기
            </button>
          )}
          <button onClick={() => controller.stopSharing()}>
            <IconPlayerStop size={18} />
            {isDesktop ? '그만두기' : '공유 중지'}
          </button>
        </div>
      </div>

      {ui.modelProgress !== null && (
        <Banner tone="info">번역 모델 받는 중… {Math.round(ui.modelProgress * 100)}%</Banner>
      )}
      {live.downloadNeeded && ui.modelProgress === null && (
        <Banner
          tone="warning"
          action={
            <button className="small" onClick={() => controller.downloadModel()}>
              모델 받기
            </button>
          }
        >
          {live.downloadNeeded.source === AUTO
            ? '언어 자동 감지 모델이 아직 없어요.'
            : `${languageLabel(live.downloadNeeded.source)} → ${languageLabel(live.downloadNeeded.target)} 번역 모델이 아직 없어요.`}{' '}
          한 번 받으면 이후엔 오프라인으로도 번역돼요.
        </Banner>
      )}
      {live.notice && (
        <Banner tone="danger" onClose={() => controller.dismissNotice()}>
          {live.notice}
        </Banner>
      )}
      {engine.id !== wanted && (
        <Banner tone="warning">
          {wanted === 'claude' || wanted === 'gemini'
            ? `${wanted === 'claude' ? 'Claude' : 'Gemini'} 키가 등록되지 않아 `
            : isDesktop
              ? '데스크톱 앱은 Chrome 내장 번역을 쓸 수 없어 '
              : '이 브라우저는 내장 번역을 지원하지 않아 '}
          {engine.id === 'none' ? '인식한 글자만 보여줘요.' : `${engine.label}로 대신 번역하고 있어요.`} 설정에서 바꿀 수
          있어요.
        </Banner>
      )}

      <div className="metrics">
        <Metric label="번역한 줄" value={String(stats.lines)} />
        <Metric label="평균 지연" value={stats.batches > 0 ? `${(stats.avgLatencyMs / 1000).toFixed(1)}초` : '–'} />
        <Metric label="캐시 적중" value={stats.lookups > 0 ? `${Math.round((stats.cacheHits / stats.lookups) * 100)}%` : '–'} />
        <Metric label="이번 세션 비용" value={stats.costUsd > 0 ? `$${stats.costUsd.toFixed(4)}` : '무료'} />
      </div>

      <div className="live-grid">
        <section className="card">
          <p className="label">
            {settings.mode === 'chat' ? '말풍선 번역' : '캡처 미리보기'}
            <span className="push small">
              {stats.fps}fps · 인식 {stats.ocrMs}ms
            </span>
          </p>
          {settings.mode === 'chat' ? (
            <ChatAside layout={live.layout} />
          ) : isDesktop ? (
            <RegionStill url={ui.regionPreviewUrl} maxHeightVh={40} />
          ) : (
            <RegionPicker stream={ui.stream} region={ui.region} maxHeightVh={40} />
          )}
        </section>
        <section className="card">
          {settings.mode === 'subtitle' && <CurrentSubtitle line={live.subtitle} />}
          <p className="label">
            번역 기록
            {live.lines.length > 0 && (
              <button className="small ghost push" onClick={() => controller.clearHistory()}>
                지우기
              </button>
            )}
          </p>
          <History lines={live.lines} />
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CurrentSubtitle({ line }: { line: LiveLine | null }) {
  return (
    <div className="current-subtitle" aria-live="polite">
      {line ? (
        <>
          <p className="translated">{line.translated ?? (line.failed ? '번역하지 못했어요' : '번역 중…')}</p>
          <p className="muted small">{line.source}</p>
        </>
      ) : (
        <p className="muted">자막을 기다리는 중…</p>
      )}
    </div>
  );
}

function History({ lines }: { lines: LiveLine[] }) {
  if (lines.length === 0) return <div className="history empty">아직 번역한 문장이 없어요</div>;
  return (
    <ul className="history">
      {[...lines].reverse().map((line) => (
        <li key={line.id}>
          <span className="time">{formatTime(line.at)}</span>
          <div>
            {line.translated !== null ? (
              <p className="translated">{line.translated}</p>
            ) : line.failed ? (
              <p className="failed">번역하지 못했어요</p>
            ) : (
              <p className="pending">번역 중…</p>
            )}
            <p className="source">{line.source}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
