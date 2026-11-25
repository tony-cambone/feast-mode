import type { CookAlongApi } from '../app/api';
import { MIN, equipLine, fmtCountdown, fmtHHMM } from './format';
import type { Nav } from './shared';
import { Btn } from './shared';
import { dayById } from '../data/types';

const DAY_MS = 24 * 3_600_000;
/** Far-off countdowns read as days so they fit the hero: '29d 2h', '1d 0h'. */
function fmtDays(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** The hero: what is due now, the countdown to the next task, and what comes after. */
export function NowPanel({ api, nav }: { api: CookAlongApi; nav: Nav }) {
  const { nowNext, now, plan } = api;
  const tz = plan.timeZone;
  const cur = nowNext.current;
  const next = nowNext.next;
  const ms = nowNext.nextInMs ?? (next ? next.time - now : undefined);
  const curRecipe = cur.find((o) => o.task.recipeIds?.length);
  const nextRecipe = next?.task.recipeIds?.length ? next : undefined;
  const recipeOcc = curRecipe ?? nextRecipe;
  const last = nowNext.lastStarted;

  // How far through the gap between the last task and the next one.
  const from = cur[0]?.time ?? last?.time;
  const gap = next && from !== undefined && next.time > from ? Math.min(1, Math.max(0, (now - from) / (next.time - from))) : undefined;
  const soon = ms !== undefined && ms <= 5 * MIN;
  const nextEq = next ? equipLine(plan, next.task) : null;

  return (
    <section className="hero panel" data-testid="now-panel" aria-label="Now and next">
      <div className="hero-now">
        <div className="hero-now-main">
          <div className="eyebrow">Now</div>
          {cur.length ? (
            <ul className="now-list">
              {cur.slice(0, 3).map((o, i) => {
                const eq = equipLine(plan, o.task);
                const snz = api.day.occ[o.occId]?.snoozedUntil;
                return (
                  <li key={o.occId}>
                    <button type="button" className={`now-item${i === 0 ? ' now-item-main' : ''}`} onClick={() => nav.openTask(o.occId)} data-testid="now-item">
                      <span className="now-title">{o.task.title}</span>
                      <span className="now-meta">
                        <span className="now-time">{fmtHHMM(o.time, tz)}</span>
                        {eq && <span className="eq-line">{eq}</span>}
                        {snz !== undefined && snz > now && <span className="now-snz">snoozed until {fmtHHMM(snz, tz)}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
              {cur.length > 3 && <li className="muted">+{cur.length - 3} more in progress</li>}
            </ul>
          ) : (
            <p className="now-idle">
              {last ? (
                <>
                  <span className="now-idle-lead">All caught up.</span> Last: {last.task.title} <span className="num">{fmtHHMM(last.time, tz)}</span>
                </>
              ) : next ? (
                <span className="now-idle-lead">Nothing due yet. Put your feet up.</span>
              ) : (
                <span className="now-idle-lead">Nothing on the plan.</span>
              )}
            </p>
          )}
        </div>
        {recipeOcc && (
          <Btn className="hero-recipe" data-testid="now-recipe" onClick={() => nav.openRecipesFor(recipeOcc.occId)}>
            {curRecipe ? 'Recipe' : 'Recipe for next'}
          </Btn>
        )}
      </div>

      <div className="hero-next">
        {next ? (
          <>
            <div className="eyebrow">Next in</div>
            <div className={`countdown${soon ? ' countdown-soon' : ''}`} data-testid="next-countdown" data-long={ms !== undefined && Math.abs(ms) >= 3_600_000 ? '' : undefined} aria-live="off">
              {ms !== undefined ? (ms >= DAY_MS ? fmtDays(ms) : fmtCountdown(ms)) : '--:--'}
            </div>
            {gap !== undefined && (
              <div className="gap-rail" aria-hidden="true">
                <i style={{ width: `${(gap * 100).toFixed(2)}%` }} />
              </div>
            )}
            <button type="button" className="next-task" onClick={() => nav.openTask(next.occId)}>
              <span className="next-time">
                {ms !== undefined && ms >= 12 * 3_600_000 && <span className="next-day">{(dayById(plan, next.day)?.label ?? '').split(' · ')[0]} </span>}
                {fmtHHMM(next.time, tz)}
              </span>
              <span className="next-body">
                <span className="next-title">{next.task.title}</span>
                {nextEq && <span className="eq-line">{nextEq}</span>}
              </span>
            </button>
          </>
        ) : (
          <>
            <div className="eyebrow">Next</div>
            <div className="countdown countdown-done" data-testid="next-countdown">
              All done
            </div>
            <p className="now-idle">Everything on the plan is behind you. Go and eat.</p>
          </>
        )}
      </div>

      {nowNext.upcoming.length > 0 && (
        <div className="hero-then">
          <div className="eyebrow">Then</div>
          <ol className="then-list" aria-label="Upcoming">
            {nowNext.upcoming.slice(0, 4).map((o) => (
              <li key={o.occId}>
                <button type="button" className="then-item" onClick={() => nav.openTask(o.occId)}>
                  <span className="then-time">{fmtHHMM(o.time, tz)}</span>
                  <span className="then-title">{o.task.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
