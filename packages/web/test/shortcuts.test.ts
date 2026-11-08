import { describe, expect, it } from 'vitest';
import { pageShortcut } from '../src/shortcuts';

const key = (target: object | null, extra = {}) => ({ metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, isComposing: false, target, ...extra });

describe('page shortcuts', () => {
  it('work from the page', () => expect(pageShortcut(key({ tagName: 'BODY' }))).toBe(true));
  it.each(['SELECT', 'INPUT', 'TEXTAREA', 'OPTION'])('leave %s alone', (tagName) => expect(pageShortcut(key({ tagName }))).toBe(false));
  it('leave editable text alone', () => expect(pageShortcut(key({ tagName: 'DIV', isContentEditable: true }))).toBe(false));
  it('leave handled, composing and modified keys alone', () => {
    for (const extra of [{ defaultPrevented: true }, { isComposing: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }]) expect(pageShortcut(key({ tagName: 'BODY' }, extra))).toBe(false);
  });
});
