import { IconCrop, IconPlayerPlay, IconScreenShare } from '@tabler/icons-react';
import { useState } from 'react';
import type { OverlingoController } from '../app/controller';
import { isDesktop } from '../platform/desktop';
import { useStore } from '../state/store';
import { openPip } from './pip';
import { RegionPicker } from './RegionPicker';

export function RegionSelect({ controller }: { controller: OverlingoController }) {
  const ui = useStore(controller.ui);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    if (!ui.region) {
      setError('번역할 영역을 먼저 드래그해서 지정하세요');
      return;
    }
    setError(null);
    // On the web both need this click's user activation: the model download first, then PiP.
    controller.startTranslating();
    if (!isDesktop) void openPip(controller);
  };

  const sourceLabel = ui.demo ? '샘플 화면' : isDesktop ? (ui.targetWindow?.title ?? '지정한 영역') : '화면 공유 중';
  const screen = ui.screenRegion;
  const follows = isDesktop && ui.targetWindow ? '창을 옮기거나 크기를 바꿔도 따라가요 · ' : '';
  return (
    <main className="card stack">
      <div className="row">
        <span className="chip success" title={sourceLabel}>
          <IconScreenShare size={14} />
          <span className="chip-text">{sourceLabel}</span>
        </span>
        <span className="muted small">
          {isDesktop
            ? screen && `${screen.width} × ${screen.height} 픽셀 · ${follows}맞으면 번역을 시작하세요`
            : '번역할 부분을 드래그해서 지정하세요'}
        </span>
        <button className="push" onClick={() => controller.stopSharing()}>
          {isDesktop ? '그만두기' : '공유 중지'}
        </button>
      </div>

      {isDesktop ? (
        <RegionStill url={ui.regionPreviewUrl} maxHeightVh={50} />
      ) : (
        <RegionPicker
          stream={ui.stream}
          region={ui.region}
          onChange={(region) => {
            setError(null);
            controller.setRegion(region);
          }}
        />
      )}

      <div className="preview-row">
        <div>
          <p className="label">글자 인식 미리보기</p>
          <div className="preview-box" aria-live="polite">
            <PreviewText controller={controller} />
          </div>
        </div>
        <div className="actions">
          {isDesktop ? (
            !ui.demo && (
              <button onClick={() => void controller.selectScreenRegion()}>
                <IconCrop size={18} />
                다시 지정
              </button>
            )
          ) : (
            <button onClick={() => controller.setRegion(null)}>
              <IconCrop size={18} />
              다시 선택
            </button>
          )}
          <button className="primary" onClick={start}>
            <IconPlayerPlay size={18} />
            번역 시작
          </button>
        </div>
      </div>
      {error && <p className="field-error">{error}</p>}
    </main>
  );
}

/** Desktop: a still picture of the region picked on screen. */
export function RegionStill({ url, maxHeightVh }: { url: string | null; maxHeightVh: number }) {
  if (!url) return <p className="muted">영역을 불러오는 중…</p>;
  return <img className="region-still" src={url} alt="지정한 화면 영역" style={{ maxHeight: `${maxHeightVh}vh` }} />;
}

function PreviewText({ controller }: { controller: OverlingoController }) {
  const { ocr, region, previewText } = useStore(controller.ui);
  if (ocr.state === 'error') return <span className="tone-bad">{ocr.message}</span>;
  if (ocr.state === 'loading') {
    return (
      <span className="muted">
        {ocr.message} {Math.round(ocr.progress * 100)}%
      </span>
    );
  }
  if (!region) return <span className="muted">영역을 지정하면 여기에 인식한 글자가 보여요</span>;
  if (previewText === null) return <span className="muted">읽는 중…</span>;
  if (previewText === '') return <span className="muted">글자를 찾지 못했어요. 영역을 글자에 맞게 다시 지정해 보세요</span>;
  return <>{previewText}</>;
}
