import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiEngine, pickModel } from './gemini';

const request = { lines: ['gg, that was close lol'], source: 'auto', target: 'ko', mode: 'chat' as const, context: [] };
const generate = { supportedGenerationMethods: ['generateContent'] };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('pickModel', () => {
  it('prefers the newest stable Flash-Lite and skips special-purpose models', () => {
    expect(
      pickModel([
        { name: 'models/gemini-2.5-flash', ...generate },
        { name: 'models/gemini-2.5-flash-lite', ...generate },
        { name: 'models/gemini-3.1-flash-lite-preview-09-2026', ...generate },
        { name: 'models/gemini-3.1-flash-lite', ...generate },
        { name: 'models/gemini-3.1-flash-image', ...generate },
        { name: 'models/gemini-3.1-pro', ...generate },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ]),
    ).toBe('models/gemini-3.1-flash-lite');
  });

  it('falls back to Flash, and to nothing when no Flash model is usable', () => {
    expect(pickModel([{ name: 'models/gemini-2.5-flash', ...generate }])).toBe('models/gemini-2.5-flash');
    expect(pickModel([{ name: 'models/gemini-2.5-pro', ...generate }])).toBeNull();
  });
});

describe('GeminiEngine', () => {
  it('sends the key in a header and reads the JSON translations', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(200, { models: [{ name: 'models/gemini-2.5-flash-lite', ...generate }] }))
      .mockResolvedValueOnce(
        json(200, { candidates: [{ content: { parts: [{ text: '{"translations":["gg, 아슬아슬했네 ㅋㅋ"]}' }] } }] }),
      );
    vi.stubGlobal('fetch', fetch);

    const result = await new GeminiEngine('test-key').translate(request);

    expect(result.lines).toEqual(['gg, 아슬아슬했네 ㅋㅋ']);
    const [url, init] = fetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent');
    expect(url).not.toContain('test-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
  });

  it('waits out the free quota after a rate limit instead of retrying right away', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(200, { models: [{ name: 'models/gemini-2.5-flash-lite', ...generate }] }))
      .mockResolvedValueOnce(
        json(429, { error: { message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '20s' }] } }),
      );
    vi.stubGlobal('fetch', fetch);
    const engine = new GeminiEngine('test-key');

    await expect(engine.translate(request)).rejects.toThrow('20초 뒤에');
    await expect(engine.translate(request)).rejects.toThrow('무료 한도');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('explains an invalid key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(400, { error: { message: 'API key not valid. Please pass a valid API key.' } })));
    await expect(new GeminiEngine('bad').translate(request)).rejects.toThrow('Gemini API 키가 올바르지 않아요');
  });
});
