import { DEMO_REGIONS, startDemoStream } from '../capture/demoSource';
import type { FrameSource } from '../capture/frameSource';
import { NativeCapture } from '../capture/nativeCapture';
import { GATE_PRESETS, type CapturedFrame } from '../capture/protocol';
import { frameProcessingSupported, StreamCapture } from '../capture/streamCapture';
import { ocrLanguagesFor } from '../core/languages';
import { cleanOcrText } from '../core/ocrText';
import type { Mode, NormRect } from '../core/types';
import { TesseractOcr } from '../ocr/tesseractOcr';
import { buildOverlayState } from '../overlay/state';
import { TranslationSession } from '../pipeline/session';
import {
  captureRegion,
  closeDemoWindow,
  hideOverlay,
  isDesktop,
  minimizeWindow,
  onOverlayReady,
  onRegionSelected,
  openDemoWindow,
  sendOverlayState,
  showOverlay,
  startRegionSelect,
  windowCovers,
  type ScreenRect,
} from '../platform/desktop';
import { initialLiveState, type ChatLayout, type LiveState } from '../state/live';
import {
  clearApiKey,
  KEY_PROVIDERS,
  loadApiKey,
  loadSettings,
  saveApiKey,
  saveSettings,
  type KeyProvider,
  type KeyStorage,
  type Settings,
} from '../state/settings';
import { createStore } from '../state/store';
import { ChromeEngine, chromeTranslatorSupported } from '../translate/chromeEngine';
import { LazyClaudeEngine, verifyClaudeKey } from '../translate/claude';
import { GeminiEngine, verifyGeminiKey } from '../translate/gemini';
import { ModelDownloadRequiredError, PassthroughEngine, type TranslationEngine } from '../translate/types';

export type View = 'start' | 'select' | 'live';

export interface OcrStatus {
  state: 'idle' | 'loading' | 'ready' | 'error';
  progress: number;
  message: string | null;
}

export interface UiState {
  view: View;
  /** Web: the screen share being read. */
  stream: MediaStream | null;
  /** Desktop: the region picked on screen, and a picture of it. */
  screenRegion: ScreenRect | null;
  regionPreviewUrl: string | null;
  demo: boolean;
  region: NormRect | null;
  /** What OCR reads in the region while it's being chosen. null until the first read. */
  previewText: string | null;
  ocr: OcrStatus;
  /** Translation model download progress (0..1), or null when nothing is downloading. */
  modelProgress: number | null;
  pipOpen: boolean;
  overlayOn: boolean;
  settingsOpen: boolean;
  /** Which API keys are registered. */
  keys: Record<KeyProvider, boolean>;
  error: string | null;
}

/** On the desktop the region is cut out natively, so the whole captured image is the region. */
const WHOLE_IMAGE: NormRect = { x: 0, y: 0, w: 1, h: 1 };

const passthrough = new PassthroughEngine();

/**
 * Owns capture, OCR, translation, and where translations are shown (the PiP window on the web,
 * the overlay on the desktop). The React views only render its stores.
 */
export class OverlingoController {
  readonly settings = createStore<Settings>(loadSettings());
  readonly live = createStore<LiveState>(initialLiveState);
  readonly ui = createStore<UiState>({
    view: 'start',
    stream: null,
    screenRegion: null,
    regionPreviewUrl: null,
    demo: false,
    region: null,
    previewText: null,
    ocr: { state: 'idle', progress: 0, message: null },
    modelProgress: null,
    pipOpen: false,
    overlayOn: false,
    settingsOpen: false,
    keys: { claude: false, gemini: false },
    error: null,
  });

  private capture: FrameSource | null = null;
  private stopDemo: (() => void) | null = null;
  private ocr: Promise<TesseractOcr> | null = null;
  private ocrKey = '';
  private previewing = false;
  private session: TranslationSession | null = null;
  private readonly chrome = new ChromeEngine();
  private readonly keys: Record<KeyProvider, string | null> = { claude: loadApiKey('claude'), gemini: loadApiKey('gemini') };
  /** Engines for the registered keys, made on first use. */
  private keyEngines: Partial<Record<KeyProvider, TranslationEngine>> = {};
  private pipWindow: Window | null = null;
  /** Desktop overlay: what was last sent, and whether the chat is mid-scroll. */
  private sentOverlay = '';
  private overlayStale = false;
  private overlayLayout: ChatLayout | null = null;

  constructor() {
    this.ui.set((s) => ({ ...s, keys: { claude: this.keys.claude !== null, gemini: this.keys.gemini !== null } }));
    this.settings.subscribe(() => saveSettings(this.settings.get()));
    if (isDesktop) {
      void onRegionSelected((region) => {
        if (region) this.beginNativeCapture(region, false);
      });
      void onOverlayReady(() => this.syncOverlay(true));
      this.live.subscribe(() => this.syncOverlay());
      this.settings.subscribe(() => this.syncOverlay());
    }
  }

  // Settings

  updateSettings(patch: Partial<Settings>): void {
    const before = this.settings.get();
    this.settings.set((s) => ({ ...s, ...patch }));
    const after = this.settings.get();
    if (after.mode !== before.mode) {
      this.capture?.setGate(GATE_PRESETS[after.mode]);
      if (this.ui.get().demo && this.ui.get().view === 'select' && !isDesktop) this.setRegion(DEMO_REGIONS[after.mode]);
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
    if (wanted === 'claude' || wanted === 'gemini') {
      const engine = this.keyEngine(wanted);
      if (engine) return engine;
    }
    if (this.chromeUsable()) return this.chrome;
    return this.keyEngine('gemini') ?? this.keyEngine('claude') ?? passthrough;
  }

  /**
   * Chrome's built-in translator. The desktop app's webview (WebView2) has the API but no
   * translation models behind it, so it never translates there.
   */
  chromeUsable(): boolean {
    return !isDesktop && chromeTranslatorSupported();
  }

  private keyEngine(provider: KeyProvider): TranslationEngine | null {
    const key = this.keys[provider];
    if (!key) return null;
    return (this.keyEngines[provider] ??= provider === 'claude' ? new LazyClaudeEngine(key) : new GeminiEngine(key));
  }

  openSettings(open: boolean): void {
    this.ui.set((s) => ({ ...s, settingsOpen: open }));
  }

  // API keys (BYOK)

  /** Verifies the key with its provider before storing it. Throws with a message for the user. */
  async registerKey(provider: KeyProvider, key: string): Promise<void> {
    await verifyKey(provider, key);
    this.keys[provider] = key;
    delete this.keyEngines[provider];
    saveApiKey(provider, key, this.settings.get().keyStorage);
    this.ui.set((s) => ({ ...s, keys: { ...s.keys, [provider]: true } }));
    this.refreshEngine();
  }

  async testKey(provider: KeyProvider): Promise<void> {
    const key = this.keys[provider];
    if (!key) throw new Error('등록된 키가 없어요');
    await verifyKey(provider, key);
  }

  removeKey(provider: KeyProvider): void {
    clearApiKey(provider);
    this.keys[provider] = null;
    delete this.keyEngines[provider];
    this.ui.set((s) => ({ ...s, keys: { ...s.keys, [provider]: false } }));
    this.refreshEngine();
  }

  setKeyStorage(where: KeyStorage): void {
    this.updateSettings({ keyStorage: where });
    for (const provider of KEY_PROVIDERS) {
      const key = this.keys[provider];
      if (key) saveApiKey(provider, key, where);
    }
  }

  maskedKey(provider: KeyProvider): string | null {
    const key = this.keys[provider];
    return key ? `${key.slice(0, 6)}••••${key.slice(-4)}` : null;
  }

  // Capture: web

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
      this.beginStreamCapture(stream, false);
    } catch (error) {
      // NotAllowedError means the user closed the picker; nothing to report.
      if (error instanceof DOMException && error.name === 'NotAllowedError') return;
      this.setError(`화면 공유를 시작하지 못했어요: ${messageOf(error)}`);
    }
  }

  startDemo(): void {
    if (isDesktop) {
      void this.startDesktopDemo();
      return;
    }
    const demo = startDemoStream();
    this.stopDemo = demo.stop;
    if (this.beginStreamCapture(demo.stream, true)) this.setRegion(DEMO_REGIONS[this.settings.get().mode]);
  }

  setRegion(region: NormRect | null): void {
    this.ui.set((s) => ({ ...s, region, previewText: null }));
    this.capture?.setRegion(region);
    if (region) this.capture?.grab();
  }

  // Capture: desktop

  /** Freezes the screens so the user can drag out a region; the choice comes back as an event. */
  async selectScreenRegion(): Promise<void> {
    try {
      await startRegionSelect();
    } catch (error) {
      this.setError(`영역 선택을 시작하지 못했어요: ${messageOf(error)}`);
    }
  }

  // Translating

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
    const screenRegion = this.ui.get().screenRegion;
    if (isDesktop && screenRegion) void this.openOverlay(screenRegion);
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
    this.closeOverlay();
    this.ui.set((s) => ({ ...s, view: 'select', previewText: null }));
    this.capture?.grab();
    if (isDesktop && !this.ui.get().demo) void this.selectScreenRegion();
  }

  stopSharing(): void {
    this.session?.stop();
    this.session = null;
    this.capture?.stop();
    this.capture = null;
    this.stopDemo?.();
    this.stopDemo = null;
    this.pipWindow?.close();
    this.closeOverlay();
    if (isDesktop && this.ui.get().demo) void closeDemoWindow();
    this.ui.set((s) => ({
      ...s,
      view: 'start',
      stream: null,
      screenRegion: null,
      demo: false,
      region: null,
      previewText: null,
      modelProgress: null,
    }));
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

  private beginStreamCapture(stream: MediaStream, demo: boolean): boolean {
    if (!frameProcessingSupported()) {
      for (const track of stream.getTracks()) track.stop();
      this.stopDemo?.();
      this.stopDemo = null;
      this.setError('이 브라우저는 화면 프레임 처리를 지원하지 않아요. Chrome이나 Edge 최신 버전에서 열어 주세요.');
      return false;
    }
    this.useCapture(new StreamCapture(stream, GATE_PRESETS[this.settings.get().mode]));
    this.capture!.onEnded = () => this.stopSharing();
    this.ui.set((s) => ({ ...s, view: 'select', stream, demo, region: null, previewText: null, error: null }));
    void this.loadOcr().catch(() => {});
    return true;
  }

  private async startDesktopDemo() {
    try {
      const region = await openDemoWindow(DEMO_REGIONS[this.settings.get().mode], (moved) => this.followRegion(moved));
      this.beginNativeCapture(region, true);
    } catch (error) {
      this.setError(`샘플 채팅 창을 열지 못했어요: ${messageOf(error)}`);
    }
  }

  /** The sample chat window moved: read it where it is now. */
  private followRegion(region: ScreenRect) {
    if (!(this.capture instanceof NativeCapture)) return;
    this.capture.setScreenRegion(region);
    this.ui.set((s) => ({ ...s, screenRegion: region }));
    this.overlayStale = true;
    if (this.ui.get().overlayOn) void showOverlay(region).then(() => this.syncOverlay(true));
  }

  private beginNativeCapture(region: ScreenRect, demo: boolean) {
    this.session?.stop();
    this.session = null;
    this.closeOverlay();
    if (this.capture instanceof NativeCapture) {
      this.capture.setScreenRegion(region);
    } else {
      this.capture?.stop();
      this.useCapture(new NativeCapture(region, GATE_PRESETS[this.settings.get().mode]));
    }
    this.ui.set((s) => ({
      ...s,
      view: 'select',
      screenRegion: region,
      demo,
      region: WHOLE_IMAGE,
      previewText: null,
      error: null,
    }));
    void this.loadOcr().catch(() => {});
    void this.refreshRegionPreview(region);
    this.capture?.grab();
  }

  private useCapture(capture: FrameSource) {
    capture.onFrame = (frame) => this.handleFrame(frame);
    capture.onStats = (fps) => this.live.set((s) => ({ ...s, stats: { ...s.stats, fps } }));
    capture.onError = (message) => this.setError(`화면을 읽지 못했어요: ${message}`);
    capture.onMotion = () => {
      if (this.settings.get().mode !== 'chat' || this.overlayStale) return;
      this.overlayStale = true;
      this.syncOverlay();
    };
    this.capture = capture;
  }

  /** Desktop: a still picture of the picked region, for the confirm screen. */
  private async refreshRegionPreview(region: ScreenRect) {
    try {
      const image = await captureRegion(region, 0);
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const pixels = new Uint8ClampedArray(image.buffer, image.offset, image.width * image.height * 4);
      canvas.getContext('2d')!.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;
      const previous = this.ui.get().regionPreviewUrl;
      this.ui.set((s) => ({ ...s, regionPreviewUrl: URL.createObjectURL(blob) }));
      if (previous) URL.revokeObjectURL(previous);
    } catch {
      // The confirm screen works without a picture.
    }
  }

  private async openOverlay(region: ScreenRect) {
    try {
      await showOverlay(region);
      this.ui.set((s) => ({ ...s, overlayOn: true }));
      this.syncOverlay(true);
      // Whatever covers the region gets read instead of it, so get this window out of the way.
      if (await windowCovers(region)) await minimizeWindow();
    } catch (error) {
      this.setError(`오버레이를 띄우지 못했어요: ${messageOf(error)}`);
    }
  }

  private closeOverlay() {
    if (!this.ui.get().overlayOn) return;
    this.ui.set((s) => ({ ...s, overlayOn: false }));
    this.sentOverlay = '';
    void hideOverlay();
  }

  /** Sends the overlay what to draw, when that changed. */
  private syncOverlay(force = false) {
    const { overlayOn, screenRegion } = this.ui.get();
    if (!overlayOn || !screenRegion) return;
    const live = this.live.get();
    // A fresh read of the chat puts labels back in place after scrolling.
    if (live.layout !== this.overlayLayout) {
      this.overlayLayout = live.layout;
      this.overlayStale = false;
    }
    const state = buildOverlayState(live, this.settings.get(), screenRegion, this.overlayStale);
    const serialized = JSON.stringify(state);
    if (!force && serialized === this.sentOverlay) return;
    this.sentOverlay = serialized;
    void sendOverlayState(state);
  }

  private handleFrame(frame: CapturedFrame) {
    if (this.session) this.session.handleFrame(frame);
    else if (this.ui.get().view === 'select') void this.preview(frame.image);
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

function verifyKey(provider: KeyProvider, key: string): Promise<void> {
  return provider === 'claude' ? verifyClaudeKey(key) : verifyGeminiKey(key);
}

function describeOcrStatus(status: string): string {
  if (status.includes('traineddata')) return '언어 데이터 받는 중';
  if (status.includes('core')) return '글자 인식 엔진 받는 중';
  return '글자 인식 준비 중';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
