import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CookAlongApi } from '../app/api';
import { SOUNDS } from '../audio';
import { formatSetting } from '../data/types';
import type { SoundId } from '../engine/types';
import { TEXT_SIZES, THEMES, useDisplay } from './display';
import type { TextSize, ThemePref } from './display';
import { dateISOOf, fmtDay, fmtHHMM, quickJumps, toEpoch } from './format';
import { RecipePanelBody } from './RecipePanel';
import { renderBold } from './text';
import { Btn, CheckRow, Chips, Icon, Seg } from './shared';
import type { DrawerDesc, Nav } from './shared';

export function Drawer({
  title,
  z,
  onClose,
  children,
  testId,
  noBackdrop,
  sheet,
}: {
  title: string;
  z: number;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  noBackdrop?: boolean;
  sheet?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className={`drawer-backdrop${noBackdrop ? ' drawer-nobd' : ''}${sheet ? ' drawer-sheet' : ''}`} style={{ zIndex: z }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} data-testid={testId}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <Btn className="drawer-close" onClick={onClose} data-testid="drawer-close" aria-label="Close">
            <Icon name="x" />
            <kbd>Esc</kbd>
          </Btn>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  done: 'Done',
  alerting: 'Due now',
  snoozed: 'Snoozed',
  upcoming: 'Upcoming',
  'quiet-now': 'Now',
  missed: 'Missed',
};

/* ---------------- Task ---------------- */
export function TaskDrawer({ api, occId, nav, z, onClose }: { api: CookAlongApi; occId: string; nav: Nav; z: number; onClose: () => void }) {
  const occ = api.occurrences.find((o) => o.occId === occId);
  if (!occ)
    return (
      <Drawer title="Task" z={z} onClose={onClose}>
        This task is no longer on the plan.
      </Drawer>
    );
  const { plan } = api;
  const tz = plan.timeZone;
  const t = occ.task;
  const status = api.statusOf(occId);
  const done = status === 'done';
  const recipes = (t.recipeIds ?? []).map((id) => plan.recipes.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r);
  const fallbacks = (t.fallbackIds ?? []).map((id) => (plan.fallbacks ?? []).find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f);
  return (
    <Drawer title={t.title} z={z} onClose={onClose} testId="task-drawer">
      <div className="task-meta">
        <span className="big-time">{fmtHHMM(occ.time, tz)}</span>
        {occ.shiftMin !== 0 && (
          <span className="muted">
            was {fmtHHMM(occ.baseTime, tz)} ({occ.shiftMin > 0 ? '+' : ''}
            {occ.shiftMin} min)
          </span>
        )}
        <span className="status-tag" data-status={status}>
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>
      <Chips plan={plan} task={t} large />
      {t.details && <p className="task-details">{renderBold(t.details)}</p>}
      {recipes.length > 0 && (
        <section className="group">
          <h3>Recipes</h3>
          <div className="link-list">
            {recipes.map((r) => (
              <Btn key={r.id} onClick={() => nav.openRecipe(r.id)}>
                {r.name}
              </Btn>
            ))}
          </div>
        </section>
      )}
      {fallbacks.length > 0 && (
        <section className="group">
          <h3>If something goes wrong</h3>
          <div className="link-list">
            {fallbacks.map((f) => (
              <Btn key={f.id} onClick={() => nav.openFallback(f.id)}>
                {f.title}
              </Btn>
            ))}
          </div>
        </section>
      )}
      <div className="drawer-actions">
        {done ? (
          <Btn data-testid="task-undone" onClick={() => api.undone(occId)}>
            Undo done
          </Btn>
        ) : (
          <Btn className="btn-primary btn-wide" data-testid="task-done" onClick={() => api.done(occId)}>
            Mark done
          </Btn>
        )}
      </div>
    </Drawer>
  );
}

/* ---------------- Recipes (slide-over, non-modal) ---------------- */
export function RecipesDrawer({
  api,
  occId,
  recipeId,
  onChange,
  z,
  onClose,
}: {
  api: CookAlongApi;
  occId?: string;
  recipeId?: string;
  onChange: (n: { occId?: string; recipeId?: string }) => void;
  z: number;
  onClose: () => void;
}) {
  return (
    <Drawer title="Recipes" z={z} onClose={onClose} testId="recipes-drawer" noBackdrop>
      <RecipePanelBody api={api} occId={occId} recipeId={recipeId} onChange={onChange} />
    </Drawer>
  );
}

/* ---------------- Problems ---------------- */
export function ProblemsDrawer({ api, focusId, nav, z, onClose }: { api: CookAlongApi; focusId?: string; nav: Nav; z: number; onClose: () => void }) {
  const refs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (focusId) refs.current[focusId]?.scrollIntoView({ block: 'start' });
  }, [focusId]);
  const tz = api.plan.timeZone;
  const fallbacks = api.plan.fallbacks ?? [];
  const hasTemps = (api.plan.probeTargets?.length ?? 0) > 0;
  return (
    <Drawer title="Problems?" z={z} onClose={onClose} testId="problems-drawer">
      {hasTemps && (
        <section className="card-block" data-testid="problems-temps">
          <h3>Check temps</h3>
          <TempsList api={api} />
        </section>
      )}
      {fallbacks.map((f) => (
        <section
          key={f.id}
          className={`card-block${focusId === f.id ? ' card-focus' : ''}`}
          ref={(el) => {
            refs.current[f.id] = el;
          }}
          data-testid={`fallback-${f.id}`}
        >
          <h3>{f.title}</h3>
          {f.body.map((p, i) => (
            <p key={i}>{renderBold(p)}</p>
          ))}
          {f.relatedTaskIds.length > 0 && (
            <div className="link-list">
              {f.relatedTaskIds.map((tid) => {
                const occ = api.occurrences.find((o) => o.task.id === tid);
                const title = occ?.task.title ?? api.plan.tasks.find((t) => t.id === tid)?.title ?? tid;
                return (
                  <Btn key={tid} className="btn-left" disabled={!occ} onClick={() => occ && nav.openTask(occ.occId)}>
                    {occ && <span className="num muted">{fmtHHMM(occ.time, tz)}</span>}
                    {title}
                  </Btn>
                );
              })}
            </div>
          )}
          <div className="link-list">
            {f.actions.map((a, i) => {
              if (a.kind === 'variant') {
                const on = api.isVariantActive(a.variantId);
                return (
                  <Btn key={i} className={on ? 'btn-on' : 'btn-primary'} aria-pressed={on} data-testid={`variant-${a.variantId}`} onClick={() => api.toggleVariant(a.variantId)}>
                    {on ? (
                      <>
                        <Icon name="check" /> Applied: {a.label} (tap to undo)
                      </>
                    ) : (
                      a.label
                    )}
                  </Btn>
                );
              }
              if (a.kind === 'shiftLane') {
                return (
                  <Btn key={i} className="btn-primary" onClick={() => nav.shift(a.minutes, { kind: 'lane', lane: a.lane }, a.label)}>
                    {a.label}
                  </Btn>
                );
              }
              return (
                <Btn key={i} className="btn-primary" onClick={() => nav.shift(a.minutes, { kind: 'tasks', taskIds: a.taskIds }, a.label)}>
                  {a.label}
                </Btn>
              );
            })}
          </div>
        </section>
      ))}
      {!hasTemps && fallbacks.length === 0 && <p className="muted">This plan has no fallbacks. Use "Running late" on the dashboard to push tasks back.</p>}
    </Drawer>
  );
}

/* ---------------- Temps ---------------- */
function TempsList({ api }: { api: CookAlongApi }) {
  const targets = api.plan.probeTargets ?? [];
  if (!targets.length) return <p className="muted">This plan has no probe targets.</p>;
  return (
    <ul className="temps">
      {targets.map((p, i) => (
        <li key={i}>
          <span className="temp-label">{p.label}</span>
          <span className="temp-val">{formatSetting(api.plan, p.temp)}</span>
          {p.note && <span className="muted temp-note">{p.note}</span>}
        </li>
      ))}
    </ul>
  );
}
export function TempsDrawer({ api, z, onClose }: { api: CookAlongApi; z: number; onClose: () => void }) {
  return (
    <Drawer title="Check temps" z={z} onClose={onClose} testId="temps-drawer">
      <TempsList api={api} />
    </Drawer>
  );
}

/* ---------------- Settings ---------------- */
const SPEEDS = [1, 10, 60, 120];

export function SettingsDrawer({ api, nav, z, onClose }: { api: CookAlongApi; nav: Nav; z: number; onClose: () => void }) {
  const s = api.prefs.settings;
  const { plan } = api;
  const tz = plan.timeZone;
  const display = useDisplay();
  const jumps = useMemo(() => quickJumps(plan, api.occurrences), [plan, api.occurrences]);
  const firstJump = jumps.find((j) => j.key === `${api.boardDay}-start`) ?? jumps[0];
  const initial = api.isTestMode || !firstJump ? api.now : firstJump.at;
  const [date, setDate] = useState(() => dateISOOf(initial, tz));
  const [time, setTime] = useState(() => fmtHHMM(initial, tz));
  const [speed, setSpeed] = useState(() => (api.clock.mode === 'test' ? api.clock.speed : 60));
  const activeSpeed = api.clock.mode === 'test' ? api.clock.speed : speed;
  const [fresh, setFresh] = useState(true);
  const hasTemps = (plan.probeTargets?.length ?? 0) > 0;

  const start = () => {
    if (!date || !time) return;
    const at = toEpoch(date, time, tz);
    if (Number.isFinite(at)) api.setTestClock(at, activeSpeed, { fresh });
  };
  const jump = (at: number) => {
    setDate(dateISOOf(at, tz));
    setTime(fmtHHMM(at, tz));
    if (api.isTestMode) api.setTestClock(at, activeSpeed, { fresh });
  };
  const pickSpeed = (n: number) => {
    setSpeed(n);
    if (api.isTestMode) api.setTestSpeed(n);
  };

  return (
    <Drawer title="Settings" z={z} onClose={onClose} testId="settings-drawer">
      <section className="group">
        <h3>Display</h3>
        <div className="set-row">
          <span className="set-label">Text size</span>
          <Seg<TextSize> label="Text size" value={display.prefs.textSize} onChange={(v) => display.set({ textSize: v })} options={TEXT_SIZES.map((o) => ({ ...o, testId: `text-${o.value}` }))} />
        </div>
        <div className="set-row">
          <span className="set-label">Theme</span>
          <Seg<ThemePref> label="Theme" value={display.prefs.theme} onChange={(v) => display.set({ theme: v })} options={THEMES.map((o) => ({ ...o, testId: `theme-${o.value}` }))} />
        </div>
        <div className="form-row">
          <Btn onClick={() => nav.fullscreen()} data-testid="btn-fullscreen">
            Fullscreen <kbd>F</kbd>
          </Btn>
          {hasTemps && (
            <Btn onClick={() => nav.open({ kind: 'temps' })} data-testid="open-temps">
              Check temps
            </Btn>
          )}
          <Btn onClick={() => window.print()} data-testid="print">
            Print checklist
          </Btn>
        </div>
      </section>

      <section className="group">
        <h3>Alarm sound</h3>
        <div className="set-row">
          <span className="set-label">Critical alarm</span>
          <Seg<SoundId> label="Critical alarm sound" value={s.sound} onChange={(v) => api.updateSettings({ sound: v })} options={SOUNDS.map((x) => ({ value: x.id, label: x.label, testId: `sound-${x.id}` }))} />
        </div>
        <label className="field field-wide">
          <span>Volume {Math.round(s.volume * 100)}%. Turn the laptop volume up too.</span>
          <input type="range" min={0} max={1} step={0.05} value={s.volume} data-testid="volume" onChange={(e) => api.updateSettings({ volume: Number(e.target.value) })} />
        </label>
        <div className="form-row">
          <Btn onClick={() => api.previewSound('alarm')} data-testid="test-alarm">
            Test alarm
          </Btn>
          <Btn onClick={() => api.previewSound('gentle')} data-testid="test-gentle">
            Test gentle
          </Btn>
          <Btn onClick={() => api.previewSound('headsUp')} data-testid="test-headsup">
            Test heads-up
          </Btn>
        </div>
        <CheckRow plain checked={s.headsUpEnabled} onChange={(v) => api.updateSettings({ headsUpEnabled: v })}>
          Heads-up alerts a few minutes before key tasks
        </CheckRow>
      </section>

      <section className="group">
        <h3>Rehearse (test mode)</h3>
        <p className="muted">
          A fake clock with its own progress, so your real day is never touched. Times are {tz}.
          {api.isTestMode && (
            <>
              {' '}
              <strong className="test-now">
                Now: {fmtDay(api.now, tz)} {fmtHHMM(api.now, tz)}
              </strong>
            </>
          )}
        </p>
        {jumps.length > 0 && (
          <div className="form-row">
            {jumps.map((j) => (
              <Btn key={j.key} className="btn-jump" data-testid={`jump-${j.key}`} onClick={() => jump(j.at)}>
                <span>{j.label}</span>
                <span className="num muted">{fmtHHMM(j.at, tz)}</span>
              </Btn>
            ))}
          </div>
        )}
        <div className="form-row">
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} data-testid="test-date" onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Time</span>
            <input type="time" value={time} data-testid="test-time" onChange={(e) => setTime(e.target.value)} />
          </label>
          <div className="field">
            <span>Speed</span>
            <Seg<number> label="Speed" value={activeSpeed} onChange={pickSpeed} options={SPEEDS.map((n) => ({ value: n, label: `${n}×`, testId: `speed-${n}` }))} />
          </div>
        </div>
        <CheckRow plain checked={fresh} onChange={setFresh} inputTestId="test-fresh">
          Fresh rehearsal: clear test progress and mark everything before this time done
        </CheckRow>
        <div className="form-row">
          {api.isTestMode ? (
            <>
              <Btn className="btn-primary" onClick={start} data-testid="test-apply">
                Apply date and time
              </Btn>
              <Btn onClick={() => api.setTestClock(null)} data-testid="test-exit-settings">
                Exit test mode
              </Btn>
            </>
          ) : (
            <Btn className="btn-primary" onClick={start} data-testid="test-start">
              Start test mode
            </Btn>
          )}
          <Btn onClick={() => nav.confirm('Wipe test-mode progress? Real progress is not touched.', 'Reset test progress', () => api.resetTestState())} data-testid="test-reset">
            Reset test progress
          </Btn>
        </div>
      </section>

      <section className="group">
        <h3>Real progress</h3>
        <div className="form-row">
          <Btn
            className="btn-danger"
            disabled={api.isTestMode}
            data-testid="reset-real"
            onClick={() => nav.confirm('Erase ALL real progress for this plan (done, snoozes, shifts)? This cannot be undone.', 'Erase real progress', () => api.resetDay())}
          >
            Reset real progress
          </Btn>
          {api.isTestMode && <span className="muted">Exit test mode first.</span>}
        </div>
      </section>
    </Drawer>
  );
}

export type { DrawerDesc };
