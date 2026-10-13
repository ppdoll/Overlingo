import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { OcrLine } from '../core/bubbles';
import type { Rect } from '../core/types';

export interface OcrResult {
  text: string;
  /** Each recognized line with its position, for grouping chat lines into bubbles. */
  lines: OcrLine[];
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

  /** Reads the whole image, or only `area` of it. Line boxes are always in whole-image pixels. */
  async recognize(image: Blob, area?: Rect): Promise<OcrResult> {
    const started = performance.now();
    const options = area ? { rectangle: { left: area.x, top: area.y, width: area.w, height: area.h } } : {};
    const { data } = await this.worker.recognize(image, options, { text: true, blocks: true });
    const lines = (data.blocks ?? []).flatMap((block) =>
      block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.map(({ text, bbox }) => ({
          text,
          box: { x: bbox.x0, y: bbox.y0, w: bbox.x1 - bbox.x0, h: bbox.y1 - bbox.y0 },
        })),
      ),
    );
    return { text: data.text, lines, confidence: data.confidence, ms: performance.now() - started };
  }

  async terminate(): Promise<void> {
    await this.worker.terminate();
  }

  private async configure() {
    // One block of text: a subtitle or a stack of chat lines.
    await this.worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
  }
}
