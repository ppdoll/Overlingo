import { AUTO, findLanguage } from '../core/languages';
import type { TranslateRequest } from './types';

// The instructions shared by the LLM engines (Claude and Gemini).

export const SYSTEM_PROMPT = `You translate text that OCR read off someone's screen: chat messages or video subtitles.
Translate each input line into the target language. Keep the meaning, tone, slang, and emoji. Leave usernames, character names, and game terms as they are. Quietly fix obvious OCR mistakes. If a line is already in the target language, return it unchanged.
Return exactly one translation per input line, in the same order.`;

export function buildPrompt({ lines, source, target, mode, context }: TranslateRequest): string {
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
