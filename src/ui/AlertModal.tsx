import { useEffect, useRef } from 'react';
import type { CookAlongApi } from '../app/api';
import type { ActiveAlert } from '../engine/types';
import { MIN, fmtHHMM } from './format';
import { renderBold } from './text';
import { Btn, Chips } from './shared';
import type { Nav } from './shared';

/**
 * The full-screen alert. Three looks: critical (red, pulsing), calm (neutral) and
 * heads-up (amber, "in N min").
 */
export function AlertModal({ api, alert, rest, nav }: { api: CookAlongApi; alert: ActiveAlert; rest: ActiveAlert[]; nav: Nav }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [alert.key]);

  const { plan } = api;
  const tz = plan.timeZone;
  const { occ } = alert;
  const task = occ.task;
  const heads = alert.type === 'headsUp';
  const tone = heads ? 'heads' : alert.critical ? 'crit' : 'calm';
  const recipes = (task.recipeIds ?? []).map((id) => plan.recipes.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r);
  const fallbacks = (task.fallbackIds ?? []).map((id) => (plan.fallbacks ?? []).find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f);
  const snoozedAgain = !heads && alert.dueAt !== occ.time;
  const minsToGo = Math.max(1, Math.ceil((occ.time - api.now) / MIN));

  return (
    <div
      className={`alert alert-${tone}`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alert-title"
      data-testid="alert-modal"
      data-alert-type={alert.type}
      data-occ-id={occ.occId}
      data-critical={alert.critical ? 'true' : 'false'}
      ref={ref}
      tabIndex={-1}
    >
      <div className="alert-card">
        <div className="alert-band">
          <span className="alert-kicker">{heads ? `In ${minsToGo} min` : 'Now'}</span>
          <span className="alert-time">{fmtHHMM(occ.time, tz)}</span>
          {snoozedAgain && <span className="alert-note">snoozed</span>}
          {rest.length > 0 && <span className="alert-count">+{rest.length} waiting</span>}
        </div>

        <div className="alert-body">
          <h2 id="alert-title" className="alert-title" data-testid="alert-title">
            {task.title}
          </h2>
          {task.details && <p className="alert-details">{renderBold(task.details)}</p>}
          <Chips plan={plan} task={task} large />

          {(recipes.length > 0 || fallbacks.length > 0) && (
            <div className="alert-links">
              {recipes.map((r) => (
                <Btn key={r.id} onClick={() => nav.openRecipe(r.id)}>
                  Recipe: {r.name}
                </Btn>
              ))}
              {fallbacks.map((f) => (
                <Btn key={f.id} onClick={() => nav.openFallback(f.id)}>
                  Problem? {f.title}
                </Btn>
              ))}
            </div>
          )}
        </div>

        <div className="alert-actions">
          {heads ? (
            <>
              <Btn className="btn-xl alert-primary btn-grow" data-testid="btn-got-it" onClick={() => api.ackHeadsUp(occ.occId)}>
                Got it <kbd>Space</kbd>
              </Btn>
              <Btn className="btn-xl alert-secondary" data-testid="btn-already-done" onClick={() => api.done(occ.occId)}>
                Already done
              </Btn>
            </>
          ) : (
            <>
              <Btn className="btn-xl alert-primary btn-grow" data-testid="btn-done" onClick={() => api.done(occ.occId)}>
                Done <kbd>Space</kbd>
              </Btn>
              <Btn className="btn-xl alert-secondary" data-testid="btn-snooze-5" onClick={() => api.snooze(occ.occId, 5)}>
                Snooze 5 <kbd>S</kbd>
              </Btn>
              <Btn className="btn-xl alert-secondary" data-testid="btn-snooze-10" onClick={() => api.snooze(occ.occId, 10)}>
                Snooze 10 <kbd>⇧S</kbd>
              </Btn>
            </>
          )}
        </div>

        {rest.length > 0 && (
          <div className="alert-waiting" data-testid="alert-waiting">
            <div className="alert-waiting-head">Waiting behind this one</div>
            <ul>
              {rest.map((a) => (
                <li key={a.key} data-tone={a.type === 'headsUp' ? 'heads' : a.critical ? 'crit' : 'calm'}>
                  <span className="aw-time">{fmtHHMM(a.occ.time, tz)}</span>
                  <span className="aw-title">
                    {a.type === 'headsUp' ? 'Heads-up: ' : ''}
                    {a.occ.task.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
