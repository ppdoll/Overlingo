import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod';
import { AUTO, findLanguage } from '../core/languages';
import { CLAUDE_LABEL, CLAUDE_MODEL } from './claude';
import type { TranslateRequest, TranslateResult, TranslationEngine } from './types';

// Claude Haiku 5.5 rates for prompts up to 100K tokens, in USD per token.
const INPUT_PRICE = 0.1 / 1_000_000;
const OUTPUT_PRICE = 0.5 / 1_000_000;

const Translations = z.object({ translations: z.array(z.string()) });

const SYSTEM_PROMPT = `You translate text that OCR read off someone's screen: chat messages or video subtitles.
Translate each input line into the target language. Keep the meaning, tone, slang, and emoji. Leave usernames, character names, and game terms as they are. Quietly fix obvious OCR mistakes. If a line is already in the target language, return it unchanged.
Return exactly one translation per input line, in the same order.`;

/**
 * Claude with the user's own API key (BYOK). The key goes from the user's browser straight to
 * Anthropic and nowhere else: the case `dangerouslyAllowBrowser` exists for. The app never
 * ships a key of its own.
 */
export class ClaudeEngine implements TranslationEngine {
  readonly id = 'claude';
  readonly label = CLAUDE_LABEL;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = createClient(apiKey, 1);
  }

  async translate(request: TranslateRequest): Promise<TranslateResult> {
    let response;
    try {
      response = await this.client.messages.parse({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildPrompt(request) }],
        // Low effort keeps latency down: Haiku 5.5 can skip thinking on requests this simple.
        output_config: { effort: 'low', format: zodOutputFormat(Translations) },
      });
    } catch (error) {
      throw new Error(describeClaudeError(error));
    }
    if (response.stop_reason === 'refusal') throw new Error('Claude가 이 문장의 번역을 거절했어요');
    const translations = response.parsed_output?.translations;
    if (!translations || translations.length !== request.lines.length) {
      throw new Error('Claude 응답 형식이 예상과 달라요');
    }
    const { input_tokens, output_tokens } = response.usage;
    return { lines: translations, costUsd: input_tokens * INPUT_PRICE + output_tokens * OUTPUT_PRICE };
  }
}

/** Checks a key without spending tokens. Throws an error with a user-facing message. */
export async function verifyClaudeKey(apiKey: string): Promise<void> {
  try {
    await createClient(apiKey, 0).models.retrieve(CLAUDE_MODEL);
  } catch (error) {
    throw new Error(describeClaudeError(error));
  }
}

function createClient(apiKey: string, maxRetries: number): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries });
}

function buildPrompt({ lines, source, target, mode, context }: TranslateRequest): string {
  const name = (code: string) => findLanguage(code)?.english ?? code;
  const parts = [
    `Target language: ${name(target)}`,
    `Source language: ${source === AUTO ? 'detect it per line' : name(source)}`,
    `Text type: ${mode === 'chat' ? 'chat messages' : 'video subtitles'}`,
  ];
  if (context.length > 0) {
    parts.push(`Earlier lines, for context only (don't translate these):\n${context.map((l) => `- ${l}`).join('\n')}`);
  }
  parts.push(`Lines to translate:\n${JSON.stringify(lines)}`);
  return parts.join('\n\n');
}

function describeClaudeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'Claude API 키가 올바르지 않아요';
  if (error instanceof Anthropic.PermissionDeniedError) return '이 키로는 Claude Haiku 5.5를 쓸 수 없어요';
  if (error instanceof Anthropic.RateLimitError) return 'Claude 요청이 너무 많아요. 잠시 후 다시 시도해요';
  if (error instanceof Anthropic.APIConnectionError) return 'Anthropic에 연결하지 못했어요';
  if (error instanceof Anthropic.APIError) return `Claude API 오류가 났어요 (${error.status ?? '상태 코드 없음'})`;
  return error instanceof Error ? error.message : String(error);
}
