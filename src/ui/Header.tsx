import { useEffect, useRef, useState } from 'react';
import type { CookAlongApi } from '../app/api';
import { APP_NAME } from './brand';
import { dayLabel, fmtClock } from './format';
import type { DrawerDesc } from './shared';
import { Btn, Icon, Seg, Wordmark } from './shared';
import { DEFAULT_EMOJI } from './theme';

type Tone = 'ok' | 'warn' | 'bad';
export type View = 'dashboard' | 'schedule';

interface StatusItem {
  label: string;
  tone: Tone;
  value: string;
  /** Short headline when this is the thing that needs attention. */
  issue: string;
  why: string;
}

export function Header({
  api,
  view,
  setView,
  onOpen,
  onRecipes,
  onPlans,
}: {
  api: CookAlongApi;
  view: View;
  setView: (v: View) => void;
  onOpen: (d: DrawerDesc) => void;
  onRecipes: () => void;
  onPlans: () => void;
}) {
  const [pop, setPop] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pop) return;
    const down = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setPop(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPop(false);
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [pop]);

  const { plan } = api;
  const items: StatusItem[] = [
    {
      label: 'Sound',
      tone: api.audio === 'running' ? 'ok' : 'bad',
      value: api.audio === 'running' ? 'On' : api.audio === 'unsupported' ? 'Unsupported' : 'Off',
      issue: 'Sound is off',
      why: 'Alarms are silent unless sound is on. Turn the laptop volume up too.',
    },
    {
      label: 'Notifications',
      tone: api.notifications === 'granted' ? 'ok' : 'warn',
      value: api.notifications === 'granted' ? 'On' : api.notifications === 'default' ? 'Not asked' : api.notifications === 'denied' ? 'Blocked' : 'Unsupported',
      issue: 'No pop-ups',
      why: 'Desktop pop-ups are a backup if this window is hidden. The in-page alert and sound still work without them.',
    },
    {
      label: 'Screen awake',
      tone: api.wakeLock === 'active' ? 'ok' : api.wakeLock === 'released' ? 'warn' : 'bad',
      value: api.wakeLock === 'active' ? 'On' : api.wakeLock === 'released' ? 'Released' : 'Unavailable',
      issue: 'Screen may sleep',
      why: 'Keeps the display from sleeping. If unavailable, set the laptop sleep to Never while plugged in.',
    },
    {
      label: 'Storage',
      tone: api.storageOk ? 'ok' : 'bad',
      value: api.storageOk ? 'Saving' : 'Not saving',
      issue: 'Not saving',
      why: api.storageOk ? 'Progress survives a reload.' : "Progress won't survive a reload.",
    },
  ];
  const issues = items.filter((i) => i.tone !== 'ok');
  const worst = issues.find((i) => i.tone === 'bad') ?? issues[0];
  const tone: Tone = worst?.tone ?? 'ok';
  const summary = !worst ? 'Ready' : issues.length === 1 ? worst.issue : `${issues.length} things to check`;
  const clock = fmtClock(api.now, plan.timeZone);
  const hasProblems = (plan.fallbacks?.length ?? 0) > 0 || (plan.probeTargets?.length ?? 0) > 0;

  return (
    <header className="hdr">
      <Wordmark className="hdr-brand" />
      <button type="button" className="hdr-plan" data-testid="open-plans" aria-label={`Plans. Now cooking: ${plan.title || APP_NAME}`} onClick={onPlans}>
        <span className="plan-emoji" aria-hidden="true">{plan.emoji || DEFAULT_EMOJI}</span>
        <span className="hdr-plan-text">
          <span className="hdr-title">{plan.title || APP_NAME}</span>
          <span className="hdr-day">{dayLabel(plan, api.boardDay)}</span>
        </span>
        <Icon name="chevron" size={20} />
      </button>

      <div className="hdr-clock" data-testid="clock" aria-label="Current time">
        {clock.hm}
        <span className="hdr-sec">:{clock.ss}</span>
      </div>

      <div className="status-wrap" ref={popRef}>
        <button type="button" className="status-btn" data-tone={tone} aria-expanded={pop} aria-label={`System status: ${summary}`} data-testid="status-btn" onClick={() => setPop((p) => !p)}>
          <span className={`sdot sdot-${tone}`} />
          <span className="status-text">
            <span className="status-label">{summary}</span>
            <span className="status-hint">Keep this tab in front</span>
          </span>
        </button>
        {pop && (
          <div className="status-pop" role="dialog" aria-label="Status details" data-testid="status-pop">
            <div className="status-keep">Keep this tab in front. Background tabs get slowed down; missed alerts show the moment you come back.</div>
            {items.map((i) => (
              <div key={i.label} className="status-item">
                <span className={`sdot sdot-${i.tone}`} />
                <div>
                  <strong>
                    {i.label}: {i.value}
                  </strong>
                  <div className="muted">{i.why}</div>
                </div>
              </div>
            ))}
            {api.audio !== 'running' && api.audio !== 'unsupported' && (
              <Btn className="btn-primary" onClick={() => void api.unlockAudio()}>
                Enable sound
              </Btn>
            )}
          </div>
        )}
      </div>

      <nav className="hdr-actions" aria-label="Views and tools">
        <Seg<View>
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'dashboard', label: 'Dashboard', testId: 'view-dashboard' },
            { value: 'schedule', label: 'Schedule', testId: 'view-schedule' },
          ]}
        />
        <Btn className="btn-ghost" onClick={onRecipes} data-testid="open-recipes">
          Recipes
        </Btn>
        {hasProblems && (
          <Btn className="btn-ghost" onClick={() => onOpen({ kind: 'problems' })} data-testid="open-problems">
            Problems?
          </Btn>
        )}
        <Btn className="btn-ghost btn-icon" onClick={() => onOpen({ kind: 'settings' })} data-testid="open-settings" aria-label="Settings">
          <Icon name="sliders" size={26} />
        </Btn>
      </nav>
    </header>
  );
}
