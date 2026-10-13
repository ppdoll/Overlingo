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
const CLAUDE_KEY = 'overlingo.claudeKey';

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
 * The Claude key never leaves this browser except in requests to Anthropic. By default it lives
 * in sessionStorage and disappears when the tab closes; "save on this device" uses localStorage.
 */
export function loadClaudeKey(): string | null {
  for (const storage of storages()) {
    try {
      const key = storage.getItem(CLAUDE_KEY);
      if (key) return key;
    } catch {
      // Try the next storage.
    }
  }
  return null;
}

export function saveClaudeKey(key: string, where: KeyStorage): void {
  clearClaudeKey();
  try {
    (where === 'local' ? localStorage : sessionStorage).setItem(CLAUDE_KEY, key);
  } catch {
    // The key stays in memory for this session only.
  }
}

export function clearClaudeKey(): void {
  for (const storage of storages()) {
    try {
      storage.removeItem(CLAUDE_KEY);
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
