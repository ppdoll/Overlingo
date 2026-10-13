// Chromium APIs that TypeScript's DOM library doesn't include yet.

interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
  maxBufferSize?: number;
}

declare class MediaStreamTrackProcessor {
  constructor(init: MediaStreamTrackProcessorInit);
  readonly readable: ReadableStream<VideoFrame>;
}

interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
  preferInitialWindowPlacement?: boolean;
}

interface DocumentPictureInPicture extends EventTarget {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
  readonly window: Window | null;
}

interface Window {
  documentPictureInPicture?: DocumentPictureInPicture;
}

type AIAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface AICreateOptions {
  monitor?: (monitor: EventTarget) => void;
  signal?: AbortSignal;
}

interface TranslatorLanguages {
  sourceLanguage: string;
  targetLanguage: string;
}

interface TranslatorInstance {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

interface TranslatorConstructor {
  availability(options: TranslatorLanguages): Promise<AIAvailability>;
  create(options: TranslatorLanguages & AICreateOptions): Promise<TranslatorInstance>;
}

interface LanguageDetectionResult {
  detectedLanguage: string;
  confidence: number;
}

interface LanguageDetectorInstance {
  detect(input: string, options?: { signal?: AbortSignal }): Promise<LanguageDetectionResult[]>;
  destroy(): void;
}

interface LanguageDetectorConstructor {
  availability(options?: { expectedInputLanguages?: string[] }): Promise<AIAvailability>;
  create(options?: AICreateOptions & { expectedInputLanguages?: string[] }): Promise<LanguageDetectorInstance>;
}

// Read these through globalThis: they are undefined outside Chrome 138+ desktop.
declare var Translator: TranslatorConstructor | undefined;
declare var LanguageDetector: LanguageDetectorConstructor | undefined;
