import { buildPrompt, SYSTEM_PROMPT } from './prompt';
import type { TranslateRequest, TranslateResult, TranslationEngine } from './types';

// Gemini with the user's own API key. Keys from Google AI Studio are free (no card) with
// per-minute and daily limits, which makes this the free option where Chrome's built-in
// translator isn't available, such as inside the desktop app.

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_LABEL = 'Gemini';
export const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';
/** Pause after a rate limit when Gemini doesn't say how long to wait. */
const DEFAULT_COOLDOWN_MS = 30_000;

interface ModelInfo {
  name: string;
  supportedGenerationMethods?: string[];
}

/**
 * The model to use: the newest stable Flash-Lite, else the newest Flash. Picked from what the
 * key can use instead of hard-coded, so it keeps working as Google retires old models.
 */
export function pickModel(models: ModelInfo[]): string | null {
  let best: { name: string; rank: number } | null = null;
  for (const model of models) {
    if (!model.supportedGenerationMethods?.includes('generateContent')) continue;
    const rank = rankModel(model.name);
    if (rank >= 0 && (!best || rank > best.rank)) best = { name: model.name, rank };
  }
  return best?.name ?? null;
}

function rankModel(name: string): number {
  const match = /^models\/gemini-(\d+(?:\.\d+)?)-(flash-lite|flash)(?:-(.+))?$/.exec(name);
  if (!match) return -1;
  const [, version, kind, suffix = ''] = match;
  if (/tts|image|live|audio|thinking|exp/.test(suffix)) return -1;
  const stable = suffix === '' || /^\d{3}$/.test(suffix);
  // Flash-Lite first: fastest, and the most generous free limits.
  return (kind === 'flash-lite' ? 1000 : 0) + Number(version) * 10 + (stable ? 5 : 0);
}

export class GeminiEngine implements TranslationEngine {
  readonly id = 'gemini';
  readonly label = GEMINI_LABEL;
  private model: Promise<string> | null = null;
  private cooldownUntil = 0;

  constructor(private readonly apiKey: string) {}

  async translate(request: TranslateRequest): Promise<TranslateResult> {
    const waitMs = this.cooldownUntil - Date.now();
    if (waitMs > 0) throw new Error(rateLimitMessage(waitMs));
    this.model ??= findModel(this.apiKey);
    this.model.catch(() => {
      this.model = null;
    });
    const model = await this.model;

    const response = await call(`${API}/${model}:generateContent`, this.apiKey, {
      method: 'POST',
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildPrompt(request) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: { translations: { type: 'ARRAY', items: { type: 'STRING' } } },
            required: ['translations'],
          },
        },
      }),
    });
    if (!response.ok) {
      const error = await describeError(response);
      if (response.status === 429) this.cooldownUntil = Date.now() + error.retryMs;
      throw new Error(error.message);
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    };
    const [candidate] = data.candidates ?? [];
    if (candidate?.finishReason === 'SAFETY') throw new Error('Gemini가 이 문장의 번역을 거절했어요');
    const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    const translations = parseTranslations(text);
    if (!translations || translations.length !== request.lines.length) {
      throw new Error('Gemini 응답 형식이 예상과 달라요');
    }
    return { lines: translations };
  }
}

/** Checks a key by listing its models, which costs no quota. Throws with a user-facing message. */
export async function verifyGeminiKey(apiKey: string): Promise<void> {
  await findModel(apiKey);
}

async function findModel(apiKey: string): Promise<string> {
  const response = await call(`${API}/models?pageSize=1000`, apiKey, { method: 'GET' });
  if (!response.ok) throw new Error((await describeError(response)).message);
  const { models = [] } = (await response.json()) as { models?: ModelInfo[] };
  const model = pickModel(models);
  if (!model) throw new Error('이 키로 쓸 수 있는 Gemini Flash 모델이 없어요');
  return model;
}

/** The key goes in a header, never in the URL, so it doesn't end up in logs. */
async function call(url: string, apiKey: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey } });
  } catch {
    throw new Error('Gemini에 연결하지 못했어요');
  }
}

function parseTranslations(text: string): string[] | null {
  try {
    const { translations } = JSON.parse(text) as { translations?: unknown };
    return Array.isArray(translations) ? translations.map(String) : null;
  } catch {
    return null;
  }
}

async function describeError(response: Response): Promise<{ message: string; retryMs: number }> {
  let detail = '';
  let retryMs = DEFAULT_COOLDOWN_MS;
  try {
    const { error } = (await response.json()) as {
      error?: { message?: string; details?: { '@type'?: string; retryDelay?: string }[] };
    };
    detail = error?.message ?? '';
    const retry = error?.details?.find((d) => d['@type']?.includes('RetryInfo'))?.retryDelay;
    if (retry) retryMs = Math.max(1000, parseFloat(retry) * 1000);
  } catch {
    // No JSON body.
  }
  if (response.status === 429) return { message: rateLimitMessage(retryMs), retryMs };
  if (response.status === 400 && /api key/i.test(detail)) return { message: 'Gemini API 키가 올바르지 않아요', retryMs };
  if (response.status === 403) return { message: '이 키로는 Gemini를 쓸 수 없어요', retryMs };
  return { message: `Gemini API 오류가 났어요 (${response.status})`, retryMs };
}

function rateLimitMessage(waitMs: number): string {
  return `Gemini 무료 한도에 걸렸어요. ${Math.ceil(waitMs / 1000)}초 뒤에 다시 번역해요`;
}
