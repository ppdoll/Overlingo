import { describe, expect, it } from 'vitest';
import { ChatLineTracker, SubtitleTracker } from './textDiff';

const A = '[Kenji] 次のラウンド行く?';
const B = '[Mia] gg, that was close lol';
const C = '[Sam] wait for me, brb';
const D = '[Kenji] ナイス!';
const E = '[Mia] 3, 2, 1, go';

describe('ChatLineTracker', () => {
  it('treats everything visible on the first pass as new', () => {
    expect(new ChatLineTracker().update([A, B])).toEqual([A, B]);
  });

  it('returns only the line that scrolled in', () => {
    const tracker = new ChatLineTracker();
    tracker.update([A, B, C, D]);
    expect(tracker.update([B, C, D, E])).toEqual([E]);
  });

  it('returns nothing when the chat did not change', () => {
    const tracker = new ChatLineTracker();
    tracker.update([A, B, C]);
    expect(tracker.update([A, B, C])).toEqual([]);
  });

  it('finds a line appended below without scrolling', () => {
    const tracker = new ChatLineTracker();
    tracker.update([A, B]);
    expect(tracker.update([A, B, C])).toEqual([C]);
  });

  it('tolerates small OCR differences in old lines', () => {
    const tracker = new ChatLineTracker();
    tracker.update([B, C]);
    expect(tracker.update([B, '[Sam] wait for me, brh', D])).toEqual([D]);
  });

  it('skips a half-visible line at the top', () => {
    const tracker = new ChatLineTracker();
    tracker.update([A, B, C, D]);
    expect(tracker.update(['xq#ff', C, D, E])).toEqual([E]);
  });

  it('falls back to lines it has not translated yet when nothing lines up', () => {
    const tracker = new ChatLineTracker();
    tracker.update([A, B]);
    expect(tracker.update([E, A])).toEqual([E]);
  });
});

describe('SubtitleTracker', () => {
  it('reports new text, ignores OCR jitter, and reports when the subtitle disappears', () => {
    const tracker = new SubtitleTracker();
    expect(tracker.update(["I never thought I'd see you here again."])).toEqual({
      kind: 'new',
      text: "I never thought I'd see you here again.",
    });
    expect(tracker.update(["I never thought I'd see you here agaln."])).toEqual({ kind: 'same' });
    expect(tracker.update([])).toEqual({ kind: 'clear' });
    expect(tracker.update([])).toEqual({ kind: 'same' });
    expect(tracker.update(['Where have you been?'])).toEqual({ kind: 'new', text: 'Where have you been?' });
  });

  it('keeps line breaks of two-line subtitles', () => {
    expect(new SubtitleTracker().update(['Wait.', 'Who are you?'])).toEqual({ kind: 'new', text: 'Wait.\nWho are you?' });
  });
});
