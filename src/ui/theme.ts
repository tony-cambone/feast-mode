/**
 * Plan-level look: the accent colour (plan.theme.accent) and the tab icon (plan.emoji).
 * Tints, the readable-on-dark / readable-on-light variants and the ink colour are all
 * derived in CSS from --accent-src (see styles/tokens.css).
 */
export const DEFAULT_EMOJI = '🍽️';

/** Point the design tokens at the plan's accent; an invalid or missing colour falls back to the default amber. */
export function applyAccent(accent: string | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  let ok = false;
  try {
    ok = !!accent && typeof CSS !== 'undefined' && CSS.supports('color', accent);
  } catch {
    ok = false;
  }
  if (ok) root.style.setProperty('--accent-src', accent as string);
  else root.style.removeProperty('--accent-src');
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, '');

/** Use the plan's emoji as the favicon. */
export function setFavicon(emoji: string | undefined): void {
  if (typeof document === 'undefined') return;
  const glyph = escapeXml((emoji ?? '').trim()).slice(0, 16) || DEFAULT_EMOJI;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${glyph}</text></svg>`;
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
