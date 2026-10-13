import { normalizeLine } from './similarity';

// Scripts written without spaces between words. Tesseract puts spaces between these characters,
// so they are removed. Hangul is left out on purpose: Korean does use spaces between words.
const NO_SPACE_CHARS =
  '\\u3000-\\u303F\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF01-\\uFF60\\uFF66-\\uFF9F';
const SPACE_BETWEEN_NO_SPACE_CHARS = new RegExp(`([${NO_SPACE_CHARS}])\\s+(?=[${NO_SPACE_CHARS}])`, 'g');
const SPACE_BEFORE_PUNCTUATION = new RegExp(`([${NO_SPACE_CHARS}])\\s+(?=[!?.,:;)\\]])`, 'g');
// Tesseract often reads a lone capital I in subtitle fonts as a vertical bar.
const BAR_FOR_CAPITAL_I = /(^|\s)\|(?=[\s'’]|$)/g;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const WORD_PER_CHAR_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Splits raw OCR output into clean lines and drops lines that are probably noise. */
export function cleanOcrText(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) =>
      normalizeLine(line)
        .replace(SPACE_BETWEEN_NO_SPACE_CHARS, '$1')
        .replace(SPACE_BEFORE_PUNCTUATION, '$1')
        .replace(BAR_FOR_CAPITAL_I, '$1I'),
    )
    .filter(isLikelyText);
}

/** Rejects OCR noise such as window borders ("|", "—") or fragments of icons. */
export function isLikelyText(line: string): boolean {
  const chars = [...line.replace(/\s/g, '')];
  if (chars.length === 0) return false;
  const letters = chars.filter((c) => LETTER_OR_DIGIT.test(c)).length;
  if (letters / chars.length < 0.5) return false;
  return letters >= 2 || WORD_PER_CHAR_SCRIPT.test(line);
}
