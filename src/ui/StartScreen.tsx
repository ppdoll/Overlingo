import {
  IconAlertTriangle,
  IconCheck,
  IconCrop,
  IconDownload,
  IconLock,
  IconMessageCircle,
  IconMovie,
  IconPlayerPlay,
  IconScreenShare,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OverlingoController } from '../app/controller';
import { checkEnvironment } from '../app/environment';
import type { Mode } from '../core/types';
import { isDesktop } from '../platform/desktop';
import { useStore } from '../state/store';
import { modelState, type ModelState } from '../translate/chromeEngine';
import { LanguagePicker } from './LanguagePicker';

const MODES: { mode: Mode; title: string; detail: string; icon: ReactNode }[] = [
  { mode: 'chat', title: '채팅', detail: '새로 올라온 줄만 번역', icon: <IconMessageCircle size={20} /> },
  { mode: 'subtitle', title: '자막', detail: '자막이 바뀔 때마다 교체', icon: <IconMovie size={20} /> },
];

export function StartScreen({ controller }: { controller: OverlingoController }) {
  const settings = useStore(controller.settings);
  // engineFor depends on whether a Claude key is registered, which lives in the UI store.
  useStore(controller.ui);
  const environment = useMemo(checkEnvironment, []);
  const engine = controller.engineFor(settings.mode);
  const model = useModelState(engine.id === 'chrome', settings.source, settings.target);
  const canCapture = environment.screenShare && environment.frameProcessing;

  return (
    <main className="card stack">
      <div className="grid-2">
        <div>
          <p className="label">모드</p>
          <div className="mode-cards">
            {MODES.map(({ mode, title, detail, icon }) => (
              <button
                key={mode}
                className="mode-card"
                aria-pressed={settings.mode === mode}
                onClick={() => controller.updateSettings({ mode })}
              >
                <span style={{ color: settings.mode === mode ? 'var(--accent)' : 'var(--text-secondary)' }}>{icon}</span>
                <strong>{title}</strong>
                <span className="muted small">{detail}</span>
              </button>
            ))}
          </div>
          <p className="label">언어</p>
          <LanguagePicker controller={controller} />
        </div>

        <div>
          <p className="label">환경 확인</p>
          <ul className="checks">
            {isDesktop ? (
              <Check tone="ok">데스크톱 앱: 화면 어디든 바로 지정해서 읽어요</Check>
            ) : (
              <Check tone={canCapture ? 'ok' : 'bad'}>
                {canCapture ? '화면 공유 지원' : '화면 공유를 쓰려면 Chrome이나 Edge 최신 버전이 필요해요'}
              </Check>
            )}
            <EngineCheck label={engine.label} engineId={engine.id} wanted={settings.engines[settings.mode]} model={model} />
            {isDesktop ? (
              <Check tone="ok">오버레이: 번역을 말풍선과 자막 바로 옆에 띄워요</Check>
            ) : (
              <Check tone={environment.pip ? 'ok' : 'warn'}>
                {environment.pip ? 'PiP 창 지원' : 'PiP 창 미지원: 번역은 이 탭 안에서만 보여요'}
              </Check>
            )}
            <Check tone="warn" icon={<IconDownload size={16} />}>
              글자 인식 언어 데이터는 처음 한 번만 받아요
            </Check>
          </ul>
        </div>
      </div>

      {isDesktop ? (
        <>
          <div className="actions">
            <button className="primary" onClick={() => void controller.selectScreenRegion()}>
              <IconCrop size={18} />
              화면 영역 지정
            </button>
            <button onClick={() => controller.startDemo()}>
              <IconPlayerPlay size={18} />
              샘플 채팅 창으로 체험
            </button>
          </div>
          <p className="hint">
            <IconLock size={15} />
            영역 지정을 누르면 화면이 잠시 멈춰요. 번역할 채팅이나 자막을 드래그하면, 번역이 그 옆에 바로 떠요. 화면은 이 PC
            안에서만 처리돼요.
          </p>
        </>
      ) : (
        <>
          <div className="actions">
            <button className="primary" disabled={!canCapture} onClick={() => void controller.shareScreen()}>
              <IconScreenShare size={18} />
              화면 공유 시작
            </button>
            <button disabled={!environment.frameProcessing} onClick={() => controller.startDemo()}>
              <IconPlayerPlay size={18} />
              샘플 화면으로 체험
            </button>
          </div>
          <p className="hint">
            <IconLock size={15} />
            화면은 이 브라우저 안에서만 처리돼요. 공유할 때 전체 화면 대신 해당 창을 고르면, 창을 옮겨도 번역 영역이 그대로
            유지돼요.
          </p>
        </>
      )}
    </main>
  );
}

function EngineCheck({
  label,
  engineId,
  wanted,
  model,
}: {
  label: string;
  engineId: string;
  wanted: string;
  model: ModelState | null;
}) {
  if (engineId === 'claude' || engineId === 'gemini') return <Check tone="ok">{label} · 내 키로 번역</Check>;
  if (engineId === 'none') {
    if (wanted === 'none') return <Check tone="warn">번역 없이 인식한 글자만 보여줘요</Check>;
    return isDesktop ? (
      <Check tone="bad">데스크톱 앱은 Chrome 내장 번역을 쓸 수 없어요. 설정에서 Gemini 무료 키를 등록하세요</Check>
    ) : (
      <Check tone="bad">
        이 브라우저는 내장 번역을 지원하지 않아요 (Chrome 138 이상 필요). 설정에서 Gemini 무료 키나 Claude 키를 등록할 수 있어요
      </Check>
    );
  }
  if (model === null) return <Check tone="warn">내장 번역 확인 중</Check>;
  if (model === 'available') return <Check tone="ok">내장 번역 사용 가능</Check>;
  if (model === 'downloadable' || model === 'downloading') {
    return (
      <Check tone="warn" icon={<IconDownload size={16} />}>
        내장 번역: 첫 사용 시 언어 모델 다운로드
      </Check>
    );
  }
  if (model === 'unresponsive') {
    return <Check tone="bad">내장 번역이 응답하지 않아요. 데스크톱 Chrome을 최신 버전으로 업데이트하거나 다른 엔진을 고르세요</Check>;
  }
  if (model === 'unsupported') return <Check tone="bad">이 브라우저는 언어 자동 감지를 지원하지 않아요</Check>;
  return <Check tone="bad">내장 번역이 이 언어 조합을 지원하지 않아요</Check>;
}

function Check({ tone, icon, children }: { tone: 'ok' | 'warn' | 'bad'; icon?: ReactNode; children: ReactNode }) {
  const fallback = tone === 'ok' ? <IconCheck size={16} /> : tone === 'warn' ? <IconAlertTriangle size={16} /> : <IconX size={16} />;
  return (
    <li>
      <span className={`tone-${tone}`}>{icon ?? fallback}</span>
      <span>{children}</span>
    </li>
  );
}

function useModelState(enabled: boolean, source: string, target: string): ModelState | null {
  const [state, setState] = useState<ModelState | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setState(null);
    void modelState(source, target).then((result) => {
      if (current) setState(result);
    });
    return () => {
      current = false;
    };
  }, [enabled, source, target]);
  return state;
}
