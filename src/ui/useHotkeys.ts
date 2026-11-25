import { useEffect, useRef } from 'react';

export interface HotkeyHandlers {
  space(): boolean;
  snooze(minutes: 5 | 10): boolean;
  fullscreen(): void;
  escape(): boolean;
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Global keyboard shortcuts. Handlers return true when they consumed the key. */
export function useHotkeys(h: HotkeyHandlers) {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (ref.current.escape()) e.preventDefault();
        return;
      }
      if (isTyping(e.target)) return;
      if (e.code === 'Space' || e.key === ' ') {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        if (ref.current.space()) e.preventDefault();
        return;
      }
      if (e.code === 'KeyS') {
        if (e.repeat) return;
        if (ref.current.snooze(e.shiftKey ? 10 : 5)) e.preventDefault();
        return;
      }
      if (e.code === 'KeyF' && !e.shiftKey) {
        if (e.repeat) return;
        ref.current.fullscreen();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
