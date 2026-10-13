import { IconExternalLink, IconShieldLock, IconTrash, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { OverlingoController } from '../app/controller';
import { LANGUAGES } from '../core/languages';
import type { EngineId, Mode } from '../core/types';
import { isDesktop, openExternal } from '../platform/desktop';
import { KEY_PROVIDERS, type KeyProvider } from '../state/settings';
import { useStore } from '../state/store';
import { CLAUDE_LABEL } from '../translate/claude';
import { GEMINI_KEY_URL } from '../translate/gemini';
import { LanguagePicker } from './LanguagePicker';

const PROVIDERS: Record<
  KeyProvider,
  { name: string; placeholder: string; prefix: string; keyUrl: string; hint: string; note?: string }
> = {
  gemini: {
    name: 'Gemini',
    placeholder: 'AIza…',
    prefix: 'AIza',
    keyUrl: GEMINI_KEY_URL,
    hint: '무료 · Google AI Studio에서 카드 없이 발급',
    note: '무료 등급에서는 보낸 글을 Google이 제품 개선에 써요. 민감한 대화에는 쓰지 마세요.',
  },
  claude: {
    name: 'Claude',
    placeholder: 'sk-ant-api03-…',
    prefix: 'sk-ant-',
    keyUrl: 'https://platform.claude.com/settings/keys',
    hint: '유료 · 사용한 만큼 아주 적게 과금',
  },
};

const ENGINE_OPTIONS: { id: EngineId; label: string }[] = [
  { id: 'chrome', label: isDesktop ? 'Chrome 내장 번역 · 웹 버전 전용' : 'Chrome 내장 번역 · 무료' },
  { id: 'gemini', label: 'Gemini · 무료 키' },
  { id: 'claude', label: `${CLAUDE_LABEL} · 내 키` },
  { id: 'none', label: '번역 안 함 · 글자만' },
];

export function SettingsPanel({ controller }: { controller: OverlingoController }) {
  const settings = useStore(controller.settings);
  const { keys } = useStore(controller.ui);
  const close = () => controller.openSettings(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') controller.openSettings(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  const setEngine = (mode: Mode, id: EngineId) =>
    controller.updateSettings({ engines: { ...settings.engines, [mode]: id } });

  const toggleOcrLanguage = (code: string, on: boolean) => {
    const next = on ? [...settings.autoOcrLanguages, code] : settings.autoOcrLanguages.filter((c) => c !== code);
    controller.updateSettings({ autoOcrLanguages: next });
  };

  const missingKeys = KEY_PROVIDERS.filter((p) => !keys[p] && Object.values(settings.engines).includes(p));

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 id="settings-title">설정</h2>
          <button className="icon ghost push" aria-label="닫기" onClick={close}>
            <IconX size={18} />
          </button>
        </div>

        <section>
          <h3>모드와 언어</h3>
          <div className="radio-row">
            {(['chat', 'subtitle'] as const).map((mode) => (
              <label key={mode}>
                <input
                  type="radio"
                  name="mode"
                  checked={settings.mode === mode}
                  onChange={() => controller.updateSettings({ mode })}
                />
                {mode === 'chat' ? '채팅 (새 줄만 번역)' : '자막 (바뀔 때마다 교체)'}
              </label>
            ))}
          </div>
          <LanguagePicker controller={controller} />
        </section>

        <section>
          <h3>모드별 번역 엔진</h3>
          <div className="engine-grid">
            {(['chat', 'subtitle'] as const).map((mode) => (
              <label key={mode}>
                {mode === 'chat' ? '채팅 모드' : '자막 모드'}
                <select value={settings.engines[mode]} onChange={(e) => setEngine(mode, e.target.value as EngineId)}>
                  {ENGINE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {missingKeys.length > 0 && (
            <p className="field-error">
              {missingKeys.map((p) => PROVIDERS[p].name).join(', ')}을(를) 쓰려면 아래에서 API 키를 등록하세요. 그 전까진
              쓸 수 있는 다른 엔진으로 번역해요.
            </p>
          )}
          {isDesktop && (
            <p className="muted small">데스크톱 앱에서는 Chrome 내장 번역을 쓸 수 없어요. 무료로 쓰려면 Gemini 키를 등록하세요.</p>
          )}
        </section>

        <section>
          <h3>내 API 키</h3>
          {KEY_PROVIDERS.map((provider) => (
            <ApiKeyRow key={provider} controller={controller} provider={provider} />
          ))}
          <div className="radio-row">
            <label>
              <input
                type="radio"
                name="key-storage"
                checked={settings.keyStorage === 'session'}
                onChange={() => controller.setKeyStorage('session')}
              />
              이번 세션만 기억 (탭을 닫으면 삭제)
            </label>
            <label>
              <input
                type="radio"
                name="key-storage"
                checked={settings.keyStorage === 'local'}
                onChange={() => controller.setKeyStorage('local')}
              />
              이 기기에 저장
            </label>
          </div>
          <p className="note">
            <IconShieldLock size={16} />
            키는 {isDesktop ? '이 PC' : '이 브라우저'}에만 보관되고, 번역을 요청할 때 해당 회사(Google, Anthropic)로만
            전송돼요. Overlingo 서버로는 보내지 않아요.
          </p>
        </section>

        <section>
          <h3>글자 인식</h3>
          <p className="muted small">원문 언어가 자동 감지일 때 읽을 언어예요. 많이 고를수록 느려지고, 언어마다 처음 한 번 데이터를 받아요.</p>
          <div className="checkbox-grid">
            {LANGUAGES.map((language) => (
              <label key={language.tesseract}>
                <input
                  type="checkbox"
                  checked={settings.autoOcrLanguages.includes(language.tesseract)}
                  onChange={(e) => toggleOcrLanguage(language.tesseract, e.target.checked)}
                />
                {language.label}
              </label>
            ))}
          </div>
          {settings.autoOcrLanguages.length === 0 && <p className="field-error">하나도 고르지 않으면 영어만 읽어요.</p>}
        </section>

        <section>
          <h3>{isDesktop ? '번역 표시' : 'PiP 창 표시'}</h3>
          <label className="row small">
            글자 크기
            <input
              type="range"
              min={12}
              max={40}
              step={1}
              value={settings.pipFontSize}
              onChange={(e) => controller.updateSettings({ pipFontSize: Number(e.target.value) })}
            />
            <span>{settings.pipFontSize}px</span>
          </label>
          <label className="row small">
            <input
              type="checkbox"
              checked={settings.showOriginal}
              onChange={(e) => controller.updateSettings({ showOriginal: e.target.checked })}
            />
            원문 함께 보기
          </label>
          <div className="radio-row small" hidden={isDesktop}>
            채팅 보기
            <label>
              <input
                type="radio"
                name="chat-view"
                checked={settings.chatView === 'aside'}
                onChange={() => controller.updateSettings({ chatView: 'aside' })}
              />
              나란히 (말풍선 옆에 번역)
            </label>
            <label>
              <input
                type="radio"
                name="chat-view"
                checked={settings.chatView === 'list'}
                onChange={() => controller.updateSettings({ chatView: 'list' })}
              />
              목록 (번역만)
            </label>
          </div>
        </section>

        <section>
          <h3>데이터</h3>
          <div className="actions">
            <button onClick={() => controller.clearHistory()}>번역 기록 지우기</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function ApiKeyRow({ controller, provider }: { controller: OverlingoController; provider: KeyProvider }) {
  const hasKey = useStore(controller.ui).keys[provider];
  const { name, placeholder, prefix, keyUrl, hint, note } = PROVIDERS[provider];
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ ok: true, text: success });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const register = () => {
    const key = draft.trim();
    if (!key) {
      setMessage({ ok: false, text: 'API 키를 입력하세요' });
      return;
    }
    if (!key.startsWith(prefix)) {
      setMessage({ ok: false, text: `${name} API 키는 ${prefix}로 시작해요` });
      return;
    }
    void run(async () => {
      await controller.registerKey(provider, key);
      setDraft('');
    }, '키를 확인하고 등록했어요');
  };

  return (
    <div className="key-row stack" style={{ gap: 8 }}>
      <div className="row">
        <strong>{name}</strong>
        <span className={`chip${hasKey ? ' success' : ''}`}>{hasKey ? '연결됨' : '미설정'}</span>
        {hasKey ? (
          <>
            <span className="mono muted">{controller.maskedKey(provider)}</span>
            <span className="push actions">
              <button className="small" disabled={busy} onClick={() => void run(() => controller.testKey(provider), '키가 정상이에요')}>
                키 테스트
              </button>
              <button
                className="small"
                aria-label={`${name} 키 삭제`}
                onClick={() => {
                  controller.removeKey(provider);
                  setMessage(null);
                }}
              >
                <IconTrash size={16} />
              </button>
            </span>
          </>
        ) : (
          <>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={placeholder}
              aria-label={`${name} API 키`}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setMessage(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') register();
              }}
            />
            <button className="small" disabled={busy} onClick={register}>
              {busy ? '확인 중…' : '등록'}
            </button>
          </>
        )}
      </div>
      {message && <p className={message.ok ? 'tone-ok small' : 'field-error'}>{message.text}</p>}
      {!hasKey && (
        <p className="row small">
          <span className="muted">{hint}</span>
          <a
            className="row"
            href={keyUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              openExternal(keyUrl);
            }}
          >
            키 발급받기
            <IconExternalLink size={14} />
          </a>
        </p>
      )}
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}
