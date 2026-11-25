import { Fragment } from 'react';
import type { ReactNode } from 'react';

/** Render `**bold**` as <strong>. Never uses innerHTML. */
export function renderBold(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>));
}
