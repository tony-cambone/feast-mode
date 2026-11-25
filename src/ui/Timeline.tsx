import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { CookAlongApi } from '../app/api';
import { dayLabel, fmtHHMM } from './format';
import type { Nav } from './shared';
import { Icon } from './shared';

export function statusIcon(status: string, snoozedUntil: number | undefined, tz: string): ReactNode {
  switch (status) {
    case 'done':
      return <Icon name="check" size={20} />;
    case 'alerting':
      return <span className="pulse-dot" />;
    case 'snoozed':
      return (
        <span className="tl-snz">
          <Icon name="clock" size={16} />
          {snoozedUntil ? fmtHHMM(snoozedUntil, tz) : ''}
        </span>
      );
    case 'missed':
      return <span className="tl-missed">missed</span>;
    case 'quiet-now':
      return <span className="tl-quiet-dot" />;
    default:
      return null;
  }
}

/** Scroll `el` to the middle of its scroll parent `list` without moving the page. */
export function centerIn(list: HTMLElement, el: HTMLElement) {
  const top = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  list.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
}

/** Dashboard rail: today only. Time, title, status. */
export function Timeline({ api, nav }: { api: CookAlongApi; nav: Nav }) {
  const day = api.boardDay;
  const tz = api.plan.timeZone;
  const listRef = useRef<HTMLOListElement>(null);
  const rows = api.occurrences.filter((o) => o.day === day);
  const cur = api.nowNext.current[0] ?? api.nowNext.lastStarted;
  const currentId = cur && cur.day === day ? cur.occId : undefined;
  const doneCount = rows.filter((o) => api.statusOf(o.occId) === 'done').length;

  useEffect(() => {
    const list = listRef.current;
    if (!list || !currentId) return;
    const el = Array.from(list.children).find((c) => (c as HTMLElement).dataset.occ === currentId) as HTMLElement | undefined;
    if (el) centerIn(list, el);
  }, [currentId]);

  return (
    <section className="rail panel" aria-label="Timeline">
      <header className="rail-head">
        <h2 className="rail-day">{dayLabel(api.plan, day)}</h2>
        {rows.length > 0 && (
          <span className="rail-count" aria-label={`${doneCount} of ${rows.length} done`}>
            {doneCount}/{rows.length}
          </span>
        )}
      </header>
      {rows.length > 0 && (
        <div className="rail-progress" aria-hidden="true">
          <i style={{ width: `${(doneCount / rows.length) * 100}%` }} />
        </div>
      )}
      <ol className="timeline" data-testid="timeline" ref={listRef}>
        {rows.map((o) => {
          const status = api.statusOf(o.occId);
          return (
            <li key={o.occId} data-occ={o.occId}>
              <button
                type="button"
                className={`tl-row${currentId === o.occId ? ' tl-current' : ''}${o.task.critical ? ' tl-crit' : ''}`}
                data-testid={`timeline-row-${o.occId}`}
                data-status={status}
                onClick={() => nav.openTask(o.occId)}
              >
                <span className="tl-node" aria-hidden="true" />
                <span className="tl-time">
                  {fmtHHMM(o.time, tz)}
                  {o.shiftMin !== 0 && (
                    <span className="tl-shift">
                      {o.shiftMin > 0 ? '+' : ''}
                      {o.shiftMin}
                    </span>
                  )}
                </span>
                <span className="tl-title">{o.task.title}</span>
                <span className="tl-status" aria-label={status}>
                  {statusIcon(status, api.day.occ[o.occId]?.snoozedUntil, tz)}
                </span>
              </button>
            </li>
          );
        })}
        {rows.length === 0 && <li className="tl-empty muted">Nothing planned for this day.</li>}
      </ol>
    </section>
  );
}
