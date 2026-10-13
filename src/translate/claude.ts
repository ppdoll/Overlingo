import type { TranslateRequest, TranslateResult, TranslationEngine } from './types';

// The Anthropic SDK is only loaded once someone actually uses Claude, keeping it (and zod)
// out of the bundle everyone downloads.

export const CLAUDE_MODEL = 'claude-haiku-5-5';
export const CLAUDE_LABEL = 'Claude Haiku 5.5';

export class LazyClaudeEngine implements TranslationEngine {
  readonly id = 'claude';
  readonly label = CLAUDE_LABEL;
  private engine: Promise<TranslationEngine> | null = null;

  constructor(private readonly apiKey: string) {}

  translate(request: TranslateRequest): Promise<TranslateResult> {
    this.engine ??= import('./claudeEngine').then(({ ClaudeEngine }) => new ClaudeEngine(this.apiKey));
    return this.engine.then((engine) => engine.translate(request));
  }
}

/** Checks a key without spending tokens. Throws an error with a user-facing message. */
export async function verifyClaudeKey(apiKey: string): Promise<void> {
  const { verifyClaudeKey: verify } = await import('./claudeEngine');
  await verify(apiKey);
}
