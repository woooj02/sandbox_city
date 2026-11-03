import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Makes a panel behave like a dialog from the keyboard: focus moves into it when it opens, Tab and Shift+Tab stay
 * inside, Escape closes it, and focus returns to wherever it was before. Put the ref on the panel with tabIndex={-1}.
 */
export function useModal<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // an open cell editor takes Escape for itself (cancel the edit); anything else closes the dialog
        if (!(e.target instanceof Element && e.target.closest('.ag-cell-inline-editing, .ag-popup-editor, .ag-select-list'))) close.current();
        return;
      }
      const box = ref.current;
      if (e.key !== 'Tab' || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1], at = document.activeElement;
      const inside = !!at && box.contains(at);
      if (e.shiftKey && (!inside || at === first || at === box)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || at === last)) { e.preventDefault(); first.focus(); }
    };
    // capture phase: a focused grid cell must not swallow Escape or Tab before the dialog sees it
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); back?.focus({ preventScroll: true }); };
  }, [open]);
  return ref;
}
