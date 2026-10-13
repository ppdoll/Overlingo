import { AUTO } from '../core/languages';
import type { EngineId, Mode } from '../core/types';

export type KeyStorage = 'session' | 'local';

/** 'aside': each chat bubble next to its translation. 'list': translations only, as bubbles. */
export type ChatView = 'aside' | 'list';

export interface Settings {
  mode: Mode;
  /** BCP 47 code, or 'auto'. */
  source: string;
  target: string;
  engines: Record<Mode, EngineId>;
  /** Tesseract languages to read when the source is 'auto'. */
  autoOcrLanguages: string[];
  keyStorage: KeyStorage;
  pipFontSize: number;
  showOriginal: boolean;
  chatView: ChatView;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'subtitle',
  source: AUTO,
  target: 'ko',
  engines: { chat: 'chrome', subtitle: 'chrome' },
  autoOcrLanguages: ['eng', 'jpn'],
  keyStorage: 'session',
  pipFontSize: 18,
  showOriginal: true,
  chatView: 'aside',
};

const SETTINGS_KEY = 'overlingo.settings';

/** Engines that run on the user's own API key. */
export type KeyProvider = 'claude' | 'gemini';
export const KEY_PROVIDERS: readonly KeyProvider[] = ['gemini', 'claude'];
const KEY_NAMES: Record<KeyProvider, string> = { claude: 'overlingo.claudeKey', gemini: 'overlingo.geminiKey' };

// Storage can be missing or throw (private windows, blocked site data), so every access is
// guarded and the app falls back to defaults.

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Settings> | null;
    if (!saved) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...saved, engines: { ...DEFAULT_SETTINGS.engines, ...saved.engines } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings just won't persist.
  }
}

/**
 * API keys never leave this browser except in requests to their own provider. By default they
 * live in sessionStorage and disappear when the tab closes; "save on this device" uses
 * localStorage.
 */
export function loadApiKey(provider: KeyProvider): string | null {
  for (const storage of storages()) {
    try {
      const key = storage.getItem(KEY_NAMES[provider]);
      if (key) return key;
    } catch {
      // Try the next storage.
    }
  }
  return null;
}

export function saveApiKey(provider: KeyProvider, key: string, where: KeyStorage): void {
  clearApiKey(provider);
  try {
    (where === 'local' ? localStorage : sessionStorage).setItem(KEY_NAMES[provider], key);
  } catch {
    // The key stays in memory for this session only.
  }
}

export function clearApiKey(provider: KeyProvider): void {
  for (const storage of storages()) {
    try {
      storage.removeItem(KEY_NAMES[provider]);
    } catch {
      // Nothing stored there.
    }
  }
}

function storages(): Storage[] {
  const found: Storage[] = [];
  try {
    found.push(sessionStorage);
  } catch {
    // Unavailable.
  }
  try {
    found.push(localStorage);
  } catch {
    // Unavailable.
  }
  return found;
}
