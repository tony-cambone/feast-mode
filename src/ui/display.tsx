/**
 * Display options (text size, theme). Saved per browser in localStorage; every read and write
 * is wrapped so the app still works when storage is blocked.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type TextSize = 's' | 'm' | 'l' | 'xl';
export type ThemePref = 'dark' | 'light' | 'auto';
export interface DisplayPrefs {
  textSize: TextSize;
  theme: ThemePref;
}

export const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: 's', label: 'S' },
  { value: 'm', label: 'M' },
  { value: 'l', label: 'L' },
  { value: 'xl', label: 'XL' },
];
export const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'auto', label: 'Auto' },
];

const KEY = 'tg:ui:display';
const LEGACY_THEME_KEY = 'tg:ui:theme';
const DEFAULTS: DisplayPrefs = { textSize: 'm', theme: 'dark' };

const isTextSize = (v: unknown): v is TextSize => v === 's' || v === 'm' || v === 'l' || v === 'xl';
const isTheme = (v: unknown): v is ThemePref => v === 'dark' || v === 'light' || v === 'auto';

export function loadDisplay(): DisplayPrefs {
  const out = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (isTextSize(p.textSize)) out.textSize = p.textSize;
      if (isTheme(p.theme)) out.theme = p.theme;
    } else if (localStorage.getItem(LEGACY_THEME_KEY) === 'light') {
      out.theme = 'light';
    }
  } catch {
    /* storage blocked or bad JSON: defaults */
  }
  return out;
}

function saveDisplay(p: DisplayPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* not saved; still applies for this page load */
  }
}

function systemPrefersLight(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
}

interface DisplayApi {
  prefs: DisplayPrefs;
  set(patch: Partial<DisplayPrefs>): void;
}
const Ctx = createContext<DisplayApi>({ prefs: DEFAULTS, set: () => undefined });
export const useDisplay = (): DisplayApi => useContext(Ctx);

/** Holds the display options and mirrors them onto <html data-theme data-text>. */
export function DisplayProvider({ children, override }: { children: ReactNode; override?: Partial<DisplayPrefs> }) {
  const [prefs, setPrefs] = useState<DisplayPrefs>(() => ({ ...loadDisplay(), ...override }));
  const [sysLight, setSysLight] = useState(systemPrefersLight);

  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia('(prefers-color-scheme: light)');
    } catch {
      return;
    }
    const on = () => setSysLight(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const resolved = prefs.theme === 'auto' ? (sysLight ? 'light' : 'dark') : prefs.theme;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.text = prefs.textSize;
  }, [resolved, prefs.textSize]);

  const set = useCallback((patch: Partial<DisplayPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      saveDisplay(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ prefs, set }), [prefs, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
