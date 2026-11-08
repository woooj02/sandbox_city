/** Letter shortcuts belong to the page, not to a control that takes letters itself. A dropdown jumps to an option on a keypress. */
const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);

interface KeyEventLike {
  metaKey: boolean; ctrlKey: boolean; altKey: boolean; defaultPrevented: boolean; isComposing: boolean;
  target: EventTarget | { tagName?: string; isContentEditable?: boolean } | null;
}

export function pageShortcut(e: KeyEventLike) {
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  return !e.metaKey && !e.ctrlKey && !e.altKey && !e.defaultPrevented && !e.isComposing && !TYPING.has(t?.tagName ?? '') && !t?.isContentEditable;
}
