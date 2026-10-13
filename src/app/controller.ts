import { CaptureController, frameProcessingSupported } from '../capture/captureController';
import { DEMO_REGIONS, startDemoStream } from '../capture/demoSource';
import { GATE_PRESETS } from '../capture/protocol';
import { ocrLanguagesFor } from '../core/languages';
import { cleanOcrText } from '../core/ocrText';
import type { Mode, NormRect } from '../core/types';
import { TesseractOcr } from '../ocr/tesseractOcr';
import { TranslationSession } from '../pipeline/session';
import { initialLiveState, type LiveState } from '../state/live';
import {
  clearClaudeKey,
  loadClaudeKey,
  loadSettings,
  saveClaudeKey,
  saveSettings,
  type KeyStorage,
  type Settings,
} from '../state/settings';
import { createStore } from '../state/store';
import { ChromeEngine, chromeTranslatorSupported } from '../translate/chromeEngine';
import { LazyClaudeEngine, verifyClaudeKey } from '../translate/claude';
import { ModelDownloadRequiredError, PassthroughEngine, type TranslationEngine } from '../translate/types';

export type View = 'start' | 'select' | 'live';

export interface OcrStatus {
  state: 'idle' | 'loading' | 'ready' | 'error';
  progress: number;
  message: string | null;
}

export interface UiState {
  view: View;
  stream: MediaStream | null;
  demo: boolean;
  region: NormRect | null;
  /** What OCR reads in the region while it's being chosen. null until the first read. */
  previewText: string | null;
  ocr: OcrStatus;
  /** Translation model download progress (0..1), or null when nothing is downloading. */
  modelProgress: number | null;
  pipOpen: boolean;
  settingsOpen: boolean;
  hasClaudeKey: boolean;
  error: string | null;
}

const passthrough = new PassthroughEngine();

/** Owns capture, OCR, translation and the PiP window. The React views only render its stores. */
export class OverlingoController {
  readonly settings = createStore<Settings>(loadSettings());
  readonly live = createStore<LiveState>(initialLiveState);
  readonly ui = createStore<UiState>({
    view: 'start',
    stream: null,
    demo: false,
    region: null,
    previewText: null,
    ocr: { state: 'idle', progress: 0, message: null },
    modelProgress: null,
    pipOpen: false,
    settingsOpen: false,
    hasClaudeKey: false,
    error: null,
  });

  private capture: CaptureController | null = null;
  private stopDemo: (() => void) | null = null;
  private ocr: Promise<TesseractOcr> | null = null;
  private ocrKey = '';
  private previewing = false;
  private session: TranslationSession | null = null;
  private readonly chrome = new ChromeEngine();
  private claude: LazyClaudeEngine | null = null;
  private claudeKey: string | null = loadClaudeKey();
  private pipWindow: Window | null = null;

  constructor() {
    this.ui.set((s) => ({ ...s, hasClaudeKey: this.claudeKey !== null }));
    this.settings.subscribe(() => saveSettings(this.settings.get()));
  }

  // Settings

  updateSettings(patch: Partial<Settings>): void {
    const before = this.settings.get();
    this.settings.set((s) => ({ ...s, ...patch }));
    const after = this.settings.get();
    if (after.mode !== before.mode) {
      this.capture?.setGate(GATE_PRESETS[after.mode]);
      if (this.ui.get().demo && this.ui.get().view === 'select') this.setRegion(DEMO_REGIONS[after.mode]);
    }
    this.session?.update({ mode: after.mode, source: after.source, target: after.target, engine: this.engineFor(after.mode) });
    if (this.ocr && (after.source !== before.source || after.autoOcrLanguages.join() !== before.autoOcrLanguages.join())) {
      void this.loadOcr().catch(() => {});
    }
  }

  /** The engine the settings ask for, or the best available stand-in. */
  engineFor(mode: Mode): TranslationEngine {
    const wanted = this.settings.get().engines[mode];
    if (wanted === 'none') return passthrough;
    if (wanted === 'claude' && this.claudeKey) return (this.claude ??= new LazyClaudeEngine(this.claudeKey));
    return chromeTranslatorSupported() ? this.chrome : passthrough;
  }

  openSettings(open: boolean): void {
    this.ui.set((s) => ({ ...s, settingsOpen: open }));
  }

  // Claude key (BYOK)

  /** Verifies the key with Anthropic before storing it. Throws with a message for the user. */
  async registerClaudeKey(key: string): Promise<void> {
    await verifyClaudeKey(key);
    this.claudeKey = key;
    this.claude = null;
    saveClaudeKey(key, this.settings.get().keyStorage);
    this.ui.set((s) => ({ ...s, hasClaudeKey: true }));
    this.refreshEngine();
  }

  async testClaudeKey(): Promise<void> {
    if (!this.claudeKey) throw new Error('등록된 키가 없어요');
    await verifyClaudeKey(this.claudeKey);
  }

  removeClaudeKey(): void {
    clearClaudeKey();
    this.claudeKey = null;
    this.claude = null;
    this.ui.set((s) => ({ ...s, hasClaudeKey: false }));
    this.refreshEngine();
  }

  setKeyStorage(where: KeyStorage): void {
    this.updateSettings({ keyStorage: where });
    if (this.claudeKey) saveClaudeKey(this.claudeKey, where);
  }

  maskedClaudeKey(): string | null {
    const key = this.claudeKey;
    return key ? `${key.slice(0, 7)}••••${key.slice(-4)}` : null;
  }

  // Capture

  async shareScreen(): Promise<void> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.setError('이 브라우저는 화면 공유를 지원하지 않아요. Chrome이나 Edge 최신 버전에서 열어 주세요.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 10, max: 15 } },
        audio: false,
      });
      this.beginCapture(stream, false);
    } catch (error) {
      // NotAllowedError means the user closed the picker; nothing to report.
      if (error instanceof DOMException && error.name === 'NotAllowedError') return;
      this.setError(`화면 공유를 시작하지 못했어요: ${messageOf(error)}`);
    }
  }

  startDemo(): void {
    const demo = startDemoStream();
    this.stopDemo = demo.stop;
    if (this.beginCapture(demo.stream, true)) this.setRegion(DEMO_REGIONS[this.settings.get().mode]);
  }

  setRegion(region: NormRect | null): void {
    this.ui.set((s) => ({ ...s, region, previewText: null }));
    this.capture?.setRegion(region);
    if (region) this.capture?.grab();
  }

  /**
   * Click handler for "번역 시작". Chrome's model download needs this click's user activation,
   * so it starts synchronously here, before the caller opens the PiP window.
   */
  startTranslating(): void {
    if (!this.capture || !this.ui.get().region) return;
    const { mode, source, target } = this.settings.get();
    const engine = this.engineFor(mode);
    const ready =
      engine instanceof ChromeEngine ? engine.prepare(source, target, (f) => this.setModelProgress(f)) : Promise.resolve();
    this.ui.set((s) => ({ ...s, view: 'live' }));
    void this.launchSession(ready);
  }

  /** Click handler for the "모델 받기" button shown when a language pair isn't downloaded yet. */
  downloadModel(): void {
    const needed = this.live.get().downloadNeeded;
    if (!needed) return;
    this.chrome.prepare(needed.source, needed.target, (f) => this.setModelProgress(f)).then(
      () => {
        this.setModelProgress(null);
        this.live.set((s) => ({ ...s, downloadNeeded: null, notice: null }));
        this.session?.restartTracking();
        this.capture?.grab();
      },
      (error) => {
        this.setModelProgress(null);
        this.live.set((s) => ({ ...s, notice: `번역 모델을 받지 못했어요: ${messageOf(error)}` }));
      },
    );
  }

  pause(): void {
    this.session?.pause();
  }

  resume(): void {
    this.session?.resume();
    this.capture?.grab();
  }

  reselectRegion(): void {
    this.session?.stop();
    this.session = null;
    this.ui.set((s) => ({ ...s, view: 'select', previewText: null }));
    this.capture?.grab();
  }

  stopSharing(): void {
    this.session?.stop();
    this.session = null;
    this.capture?.stop();
    this.capture = null;
    this.stopDemo?.();
    this.stopDemo = null;
    this.pipWindow?.close();
    this.ui.set((s) => ({ ...s, view: 'start', stream: null, demo: false, region: null, previewText: null, modelProgress: null }));
  }

  clearHistory(): void {
    this.live.set((s) => ({ ...s, lines: [], subtitle: null }));
  }

  dismissNotice(): void {
    this.live.set((s) => ({ ...s, notice: null }));
  }

  dismissError(): void {
    this.ui.set((s) => ({ ...s, error: null }));
  }

  setPipWindow(pipWindow: Window | null): void {
    this.pipWindow = pipWindow;
    this.ui.set((s) => ({ ...s, pipOpen: pipWindow !== null }));
  }

  private beginCapture(stream: MediaStream, demo: boolean): boolean {
    if (!frameProcessingSupported()) {
      for (const track of stream.getTracks()) track.stop();
      this.stopDemo?.();
      this.stopDemo = null;
      this.setError('이 브라우저는 화면 프레임 처리를 지원하지 않아요. Chrome이나 Edge 최신 버전에서 열어 주세요.');
      return false;
    }
    const capture = new CaptureController(stream, GATE_PRESETS[this.settings.get().mode]);
    capture.onFrame = (image) => this.handleFrame(image);
    capture.onStats = (fps) => this.live.set((s) => ({ ...s, stats: { ...s.stats, fps } }));
    capture.onEnded = () => this.stopSharing();
    capture.onError = (message) => this.setError(`화면을 읽지 못했어요: ${message}`);
    this.capture = capture;
    this.ui.set((s) => ({ ...s, view: 'select', stream, demo, region: null, previewText: null, error: null }));
    void this.loadOcr().catch(() => {});
    return true;
  }

  private handleFrame(image: Blob) {
    if (this.session) this.session.handleFrame(image);
    else if (this.ui.get().view === 'select') void this.preview(image);
  }

  /** Shows what OCR reads in the region while the user is still choosing it. */
  private async preview(image: Blob) {
    if (this.previewing) return;
    this.previewing = true;
    try {
      const { text } = await (await this.loadOcr()).recognize(image);
      if (this.ui.get().view === 'select') {
        this.ui.set((s) => ({ ...s, previewText: cleanOcrText(text).join('\n') }));
      }
    } catch {
      // The OCR status already shows load errors.
    } finally {
      this.previewing = false;
    }
  }

  private async launchSession(ready: Promise<unknown>) {
    const { mode, source, target } = this.settings.get();
    const prepareError = await ready.then(
      () => null,
      (error: unknown) => error,
    );
    this.setModelProgress(null);
    let ocr: TesseractOcr;
    try {
      ocr = await this.loadOcr();
    } catch {
      return;
    }
    if (this.ui.get().view !== 'live') return;
    this.session?.stop();
    this.session = new TranslationSession(ocr, this.live, { mode, source, target, engine: this.engineFor(mode) });
    if (prepareError instanceof ModelDownloadRequiredError) {
      // The download lost its user activation. Offer a button to start it again.
      const { source: from, target: to } = prepareError;
      this.live.set((s) => ({ ...s, downloadNeeded: { source: from, target: to } }));
    } else if (prepareError) {
      this.live.set((s) => ({ ...s, notice: messageOf(prepareError) }));
    }
    this.capture?.setGate(GATE_PRESETS[mode]);
    this.capture?.grab();
  }

  /** Loads Tesseract once, switching its languages when the settings change. */
  private loadOcr(): Promise<TesseractOcr> {
    const { source, autoOcrLanguages } = this.settings.get();
    const languages = ocrLanguagesFor(source, autoOcrLanguages);
    const key = languages.join('+');
    if (this.ocr && key === this.ocrKey) return this.ocr;

    this.setOcr({ state: 'loading', progress: 0, message: '글자 인식 준비 중' });
    const previous = this.ocr;
    this.ocrKey = key;
    const loading = previous
      ? previous.then(async (ocr) => {
          await ocr.setLanguages(languages);
          return ocr;
        })
      : TesseractOcr.create(languages, (status, progress) => {
          if (status !== 'recognizing text') this.setOcr({ state: 'loading', progress, message: describeOcrStatus(status) });
        });
    this.ocr = loading;
    loading.then(
      () => {
        if (this.ocr === loading) this.setOcr({ state: 'ready', progress: 1, message: null });
      },
      (error) => {
        if (this.ocr !== loading) return;
        this.ocr = null;
        this.ocrKey = '';
        this.setOcr({ state: 'error', progress: 0, message: `글자 인식 엔진을 불러오지 못했어요: ${messageOf(error)}` });
      },
    );
    return loading;
  }

  private refreshEngine() {
    this.session?.update({ engine: this.engineFor(this.settings.get().mode) });
  }

  private setOcr(ocr: OcrStatus) {
    this.ui.set((s) => ({ ...s, ocr }));
  }

  private setModelProgress(modelProgress: number | null) {
    this.ui.set((s) => ({ ...s, modelProgress }));
  }

  private setError(error: string) {
    this.ui.set((s) => ({ ...s, error }));
  }
}

function describeOcrStatus(status: string): string {
  if (status.includes('traineddata')) return '언어 데이터 받는 중';
  if (status.includes('core')) return '글자 인식 엔진 받는 중';
  return '글자 인식 준비 중';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
