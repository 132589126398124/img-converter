import { useEffect, useRef } from 'react';
export function useDialog(open, ref, onClose) {
  const callback = useRef(onClose);
  useEffect(() => {
    callback.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const buttons = () =>
      [
        ...(ref.current?.querySelectorAll(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary',
        ) || []),
      ].filter((e) => e.getClientRects().length);
    buttons()[0]?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape') callback.current();
      if (event.key !== 'Tab') return;
      const items = buttons(),
        first = items[0],
        last = items.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !ref.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      }
      if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !ref.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      previous?.focus?.();
    };
  }, [open, ref]);
}
