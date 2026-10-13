import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';

export interface OcrResult {
  text: string;
  confidence: number;
  ms: number;
}

/**
 * Tesseract in its own worker. Language data is fetched once from jsDelivr and cached by the
 * browser, so later sessions start quickly and work offline.
 */
export class TesseractOcr {
  private constructor(
    private readonly worker: Worker,
    private languages: string,
  ) {}

  static async create(languages: string[], onProgress?: (status: string, progress: number) => void): Promise<TesseractOcr> {
    const worker = await createWorker(languages, OEM.LSTM_ONLY, {
      logger: (message) => onProgress?.(message.status, message.progress),
    });
    const ocr = new TesseractOcr(worker, languages.join('+'));
    await ocr.configure();
    return ocr;
  }

  get languageKey(): string {
    return this.languages;
  }

  async setLanguages(languages: string[]): Promise<void> {
    const key = languages.join('+');
    if (key === this.languages) return;
    await this.worker.reinitialize(key, OEM.LSTM_ONLY);
    await this.configure();
    this.languages = key;
  }

  async recognize(image: Blob): Promise<OcrResult> {
    const started = performance.now();
    const { data } = await this.worker.recognize(image);
    return { text: data.text, confidence: data.confidence, ms: performance.now() - started };
  }

  async terminate(): Promise<void> {
    await this.worker.terminate();
  }

  private async configure() {
    // One block of text: a subtitle or a stack of chat lines.
    await this.worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
  }
}
