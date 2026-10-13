/**
 * Breaks text into lines no wider than `maxWidth`: by words, or by characters for Japanese and
 * Chinese, which don't put spaces between words. Line breaks in the text, blank lines
 * included, are kept.
 */
export function wrapText(text: string, maxWidth: number, widthOf: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const tokens = /\s/.test(paragraph) ? paragraph.split(/(?<=\s)/) : [...paragraph];
    let line = '';
    for (const token of tokens) {
      // Trailing spaces take no room at the end of a line.
      if (line && widthOf((line + token).trimEnd()) > maxWidth) {
        lines.push(line.trimEnd());
        line = token.trimStart();
      } else {
        line += token;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
