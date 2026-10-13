export interface Language {
  /** BCP 47 code used by Chrome's Translator API. */
  code: string;
  label: string;
  /** Name used in prompts. */
  english: string;
  /** Tesseract traineddata name. */
  tesseract: string;
}

export const LANGUAGES: readonly Language[] = [
  { code: 'en', label: '영어', english: 'English', tesseract: 'eng' },
  { code: 'ja', label: '일본어', english: 'Japanese', tesseract: 'jpn' },
  { code: 'zh', label: '중국어(간체)', english: 'Simplified Chinese', tesseract: 'chi_sim' },
  { code: 'zh-Hant', label: '중국어(번체)', english: 'Traditional Chinese', tesseract: 'chi_tra' },
  { code: 'ko', label: '한국어', english: 'Korean', tesseract: 'kor' },
  { code: 'es', label: '스페인어', english: 'Spanish', tesseract: 'spa' },
  { code: 'fr', label: '프랑스어', english: 'French', tesseract: 'fra' },
  { code: 'de', label: '독일어', english: 'German', tesseract: 'deu' },
  { code: 'pt', label: '포르투갈어', english: 'Portuguese', tesseract: 'por' },
  { code: 'ru', label: '러시아어', english: 'Russian', tesseract: 'rus' },
  { code: 'vi', label: '베트남어', english: 'Vietnamese', tesseract: 'vie' },
  { code: 'th', label: '태국어', english: 'Thai', tesseract: 'tha' },
];

export const AUTO = 'auto';

export function findLanguage(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

/** Tesseract languages to load: the source language, or the user's list when auto-detecting. */
export function ocrLanguagesFor(source: string, autoLanguages: readonly string[]): string[] {
  const lang = findLanguage(source);
  if (lang) return [lang.tesseract];
  return autoLanguages.length > 0 ? [...autoLanguages] : ['eng'];
}

/** "zh-Hant" and "zh" are different languages for translation, but "en-US" and "en" aren't. */
export function sameLanguage(a: string, b: string): boolean {
  const base = (code: string) => (code.toLowerCase().startsWith('zh-hant') ? 'zh-hant' : code.toLowerCase().split('-')[0]);
  return base(a) === base(b);
}
