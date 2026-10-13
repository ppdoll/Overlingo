import type { EngineId, Mode } from '../core/types';

export interface TranslateRequest {
  lines: string[];
  /** BCP 47 code, or 'auto'. */
  source: string;
  target: string;
  mode: Mode;
  /** Recently translated source lines, for engines that can use context. */
  context: string[];
}

export interface TranslateResult {
  lines: string[];
  costUsd?: number;
}

/** Engines throw errors whose message can be shown to the user as is. */
export interface TranslationEngine {
  readonly id: EngineId;
  readonly label: string;
  translate(request: TranslateRequest): Promise<TranslateResult>;
}

/** The pair's model isn't on this device yet. Downloading it has to start from a click. */
export class ModelDownloadRequiredError extends Error {
  constructor(
    readonly source: string,
    readonly target: string,
  ) {
    super('번역 모델을 받아야 해요');
    this.name = 'ModelDownloadRequiredError';
  }
}

/** Shows the recognized text as is, for browsers without a translator or for checking OCR. */
export class PassthroughEngine implements TranslationEngine {
  readonly id = 'none';
  readonly label = '번역 안 함';

  async translate({ lines }: TranslateRequest): Promise<TranslateResult> {
    return { lines };
  }
}
