import { AUTO, sameLanguage } from '../core/languages';
import { ModelDownloadRequiredError, type TranslateRequest, type TranslateResult, type TranslationEngine } from './types';

/** 'unresponsive': the API exists but never answered, as in some embedded Chromium builds. */
export type ModelState = AIAvailability | 'unsupported' | 'unresponsive';

const MIN_DETECTION_CONFIDENCE = 0.6;
const AVAILABILITY_TIMEOUT_MS = 5000;
const SWITCH_ENGINE_HINT = '데스크톱 Chrome 138 이상인지 확인하거나, 설정에서 다른 번역 엔진을 고르세요.';

export function chromeTranslatorSupported(): boolean {
  return globalThis.Translator !== undefined;
}

/** Whether the model for a pair (or the language detector, for 'auto') is ready on this device. */
export async function modelState(source: string, target: string): Promise<ModelState> {
  const check =
    source === AUTO
      ? globalThis.LanguageDetector?.availability()
      : globalThis.Translator?.availability({ sourceLanguage: source, targetLanguage: target });
  if (!check) return 'unsupported';
  try {
    return await withTimeout(check, AVAILABILITY_TIMEOUT_MS);
  } catch (error) {
    return error instanceof TimeoutError ? 'unresponsive' : 'unavailable';
  }
}

/** Chrome's on-device Translator API (Chrome 138+ desktop): free, and offline once downloaded. */
export class ChromeEngine implements TranslationEngine {
  readonly id = 'chrome';
  readonly label = 'Chrome 내장 번역';

  private readonly translators = new Map<string, Promise<TranslatorInstance>>();
  private detector: Promise<LanguageDetectorInstance> | null = null;

  /**
   * Gets the model for a pair ready, downloading it if needed. Downloads need user activation,
   * so call this synchronously from a click handler, before anything that could consume it.
   * With an 'auto' source only the language detector can be prepared up front.
   */
  prepare(source: string, target: string, onProgress?: (fraction: number) => void): Promise<unknown> {
    const ready = source === AUTO ? this.getDetector(onProgress) : this.getTranslator(source, target, onProgress);
    return ready.catch((error: unknown) => {
      throw toUserError(error, source, target);
    });
  }

  async translate({ lines, source, target }: TranslateRequest): Promise<TranslateResult> {
    try {
      const translated: string[] = [];
      for (const line of lines) {
        const from = source === AUTO ? await this.detect(line, target) : source;
        if (!from || sameLanguage(from, target)) {
          translated.push(line);
          continue;
        }
        const translator = await this.getReadyTranslator(from, target);
        translated.push(await translator.translate(line));
      }
      return { lines: translated };
    } catch (error) {
      throw toUserError(error, source, target);
    }
  }

  private getTranslator(source: string, target: string, onProgress?: (fraction: number) => void) {
    const key = `${source}>${target}`;
    let translator = this.translators.get(key);
    if (!translator) {
      const api = globalThis.Translator;
      if (!api) return Promise.reject(new Error(`이 브라우저는 내장 번역을 지원하지 않아요. ${SWITCH_ENGINE_HINT}`));
      translator = api.create({ sourceLanguage: source, targetLanguage: target, monitor: progressMonitor(onProgress) });
      this.translators.set(key, translator);
      translator.catch(() => this.translators.delete(key));
    }
    return translator;
  }

  /** Like getTranslator, but never starts a download: that has to come from a click. */
  private async getReadyTranslator(source: string, target: string): Promise<TranslatorInstance> {
    const existing = this.translators.get(`${source}>${target}`);
    if (existing) return existing;
    await this.requireDownloaded(source, target);
    return this.getTranslator(source, target);
  }

  private getDetector(onProgress?: (fraction: number) => void): Promise<LanguageDetectorInstance> {
    if (!this.detector) {
      const api = globalThis.LanguageDetector;
      if (!api) return Promise.reject(new Error(`이 브라우저는 언어 자동 감지를 지원하지 않아요. 원문 언어를 직접 고르세요.`));
      const detector = api.create({ monitor: progressMonitor(onProgress) });
      this.detector = detector;
      detector.catch(() => {
        if (this.detector === detector) this.detector = null;
      });
    }
    return this.detector;
  }

  private async detect(text: string, target: string): Promise<string | null> {
    if (!this.detector) await this.requireDownloaded(AUTO, target);
    const [best] = await (await this.getDetector()).detect(text);
    if (!best || best.detectedLanguage === 'und' || best.confidence < MIN_DETECTION_CONFIDENCE) return null;
    return best.detectedLanguage;
  }

  private async requireDownloaded(source: string, target: string): Promise<void> {
    const state = await modelState(source, target);
    if (state === 'available') return;
    if (state === 'downloadable' || state === 'downloading') throw new ModelDownloadRequiredError(source, target);
    if (state === 'unresponsive') throw new Error(`내장 번역이 응답하지 않아요. ${SWITCH_ENGINE_HINT}`);
    if (state === 'unsupported') throw new Error(`이 브라우저는 내장 번역을 지원하지 않아요. ${SWITCH_ENGINE_HINT}`);
    throw new Error(`내장 번역은 ${source} → ${target} 번역을 지원하지 않아요. 설정에서 다른 번역 엔진을 고르세요.`);
  }
}

/** Chrome reports problems as DOMExceptions with English messages; turn them into ours. */
function toUserError(error: unknown, source: string, target: string): Error {
  if (!(error instanceof DOMException)) return error instanceof Error ? error : new Error(String(error));
  if (error.name === 'NotAllowedError') return new ModelDownloadRequiredError(source, target);
  return new Error(`내장 번역 모델을 쓸 수 없어요 (${error.message}). ${SWITCH_ENGINE_HINT}`);
}

function progressMonitor(onProgress?: (fraction: number) => void) {
  if (!onProgress) return undefined;
  return (monitor: EventTarget) =>
    monitor.addEventListener('downloadprogress', (event) => onProgress((event as ProgressEvent).loaded));
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new TimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}
