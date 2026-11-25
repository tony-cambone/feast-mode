import { useState } from 'react';
import type { CookAlongApi } from '../app/api';
import { APP_NAME, TAGLINE } from './brand';
import { fmtDay, fmtHHMM } from './format';
import { Btn, Icon, Wordmark } from './shared';
import { DEFAULT_EMOJI } from './theme';

export function Toasts({ api, message }: { api: CookAlongApi; message: string | null }) {
  const tz = api.plan.timeZone;
  return (
    <div className={`toasts${message ? ' toasts-raised' : ''}`} aria-live="polite">
      {message && (
        <div className="toast toast-info" data-testid="toast">
          {message}
        </div>
      )}
      {api.quietNotices.map((o) => (
        <div key={o.occId} className="toast" data-testid={`quiet-${o.occId}`}>
          <div className="toast-text">
            <span className="toast-time">{fmtHHMM(o.time, tz)}</span>
            <strong>{o.task.title}</strong>
          </div>
          <Btn onClick={() => api.done(o.occId)}>Done</Btn>
        </div>
      ))}
    </div>
  );
}

/** The welcome screen. One big button unlocks sound, notifications and the wake lock. */
export function StartOverlay({ api, onPlans }: { api: CookAlongApi; onPlans?: () => void }) {
  const { plan } = api;
  const hasProgress = Object.values(api.day.occ).some((s) => s.doneAt !== undefined || s.snoozedUntil !== undefined);
  const days = plan.days.map((d) => d.label);
  const facts = [
    `${plan.tasks.length} step${plan.tasks.length === 1 ? '' : 's'}`,
    `${plan.recipes.length} recipe${plan.recipes.length === 1 ? '' : 's'}`,
    plan.devices.map((d) => d.short ?? d.label).join(', '),
  ].filter(Boolean);
  return (
    <div className="start" role="dialog" aria-modal="true" aria-label={`${APP_NAME}: start`}>
      <div className="start-card">
        <div className="start-brand">
          <Wordmark />
          <span className="start-tagline">{TAGLINE}</span>
        </div>
        <div className="start-emoji" aria-hidden="true">
          {plan.emoji || DEFAULT_EMOJI}
        </div>
        <h1 className="start-title">{plan.title || APP_NAME}</h1>
        {plan.subtitle && <p className="start-sub">{plan.subtitle}</p>}
        {days.length > 0 && (
          <ul className="start-days">
            {days.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        <p className="start-facts">{facts.join(' · ')}</p>
        {api.isTestMode && <p className="start-test">Test mode is on: fake clock, real alarms paused</p>}
        <Btn className="btn-start" data-testid="start-button" onClick={() => void api.start()}>
          {hasProgress ? 'Pick up where I left off' : 'Start my day'}
        </Btn>
        <p className="start-explain">Turns on the alarm sound and desktop notifications, and keeps the screen awake. Turn the laptop volume up.</p>
        {onPlans && (
          <Btn className="btn-ghost start-plans" data-testid="start-plans" onClick={onPlans}>
            Cook something else, or bring your own menu
          </Btn>
        )}
      </div>
    </div>
  );
}

/** At most one banner at a time, in priority order. */
export function Banners({ api }: { api: CookAlongApi }) {
  const [gone, setGone] = useState<Record<string, boolean>>({});
  if (!api.started) return null;
  const x = (k: string, onClick?: () => void) => (
    <Btn className="btn-ghost btn-icon banner-x" aria-label="Dismiss" onClick={() => (onClick ? onClick() : setGone((g) => ({ ...g, [k]: true })))}>
      <Icon name="x" />
    </Btn>
  );
  if (api.audio === 'locked' || api.audio === 'suspended') {
    return (
      <div className="banners">
        <div className="banner banner-bad" data-testid="banner-audio" role="alert">
          <div className="banner-body">
            <strong>Sound is {api.audio === 'locked' ? 'locked' : 'suspended'}.</strong> Alarms will be silent until you enable it.
          </div>
          <Btn className="btn-primary" onClick={() => void api.unlockAudio()}>
            Enable sound
          </Btn>
        </div>
      </div>
    );
  }
  const checklist = api.plan.setupChecklist ?? [];
  let el: React.ReactNode = null;
  if (api.audio === 'unsupported' && !gone.aus) {
    el = (
      <div className="banner banner-bad">
        <div className="banner-body">This browser can't play sound. Watch the screen for alerts.</div>
        {x('aus')}
      </div>
    );
  } else if (!api.storageOk && !gone.sto) {
    el = (
      <div className="banner banner-bad" data-testid="banner-storage">
        <div className="banner-body">
          <strong>Storage unavailable.</strong> Progress won't survive a reload.
        </div>
        {x('sto')}
      </div>
    );
  } else if ((api.notifications === 'denied' || api.notifications === 'unsupported') && !gone.not) {
    el = (
      <div className="banner banner-info">
        <div className="banner-body">Desktop notifications are {api.notifications === 'denied' ? 'blocked' : 'not supported'}. In-page alerts and sound still work.</div>
        {x('not')}
      </div>
    );
  } else if ((api.wakeLock === 'unsupported' || api.wakeLock === 'error') && !gone.wake) {
    el = (
      <div className="banner banner-info">
        <div className="banner-body">
          Can't keep the screen awake. Set laptop sleep to <strong>Never</strong> while plugged in.
        </div>
        {x('wake')}
      </div>
    );
  } else if (!api.prefs.setupChecklistDismissed && checklist.length) {
    el = (
      <div className="banner banner-info" data-testid="setup-checklist">
        <div className="banner-body">
          <strong>Before you start</strong>
          <ul className="cl-items">
            {checklist.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
        {x('cl', () => api.dismissChecklist())}
      </div>
    );
  }
  return el ? <div className="banners">{el}</div> : null;
}

/** Impossible to miss while rehearsing: a band across the top (plus a frame around the page, in CSS). */
export function TestBanner({ api }: { api: CookAlongApi }) {
  if (!api.isTestMode) return null;
  const tz = api.plan.timeZone;
  const speed = api.clock.mode === 'test' ? api.clock.speed : 1;
  return (
    <div className="test-band" data-testid="test-mode-banner" role="status">
      <span className="test-tag">Test mode</span>
      <span className="test-info">
        Fake clock <strong>{speed}×</strong> · {fmtDay(api.now, tz)} {fmtHHMM(api.now, tz)} · real alarms paused
        {api.testAutoExitAt != null && (
          <span className="test-auto">
            {' '}
            · hands back {fmtDay(api.testAutoExitAt, tz)} {fmtHHMM(api.testAutoExitAt, tz)}
          </span>
        )}
      </span>
      <Btn className="test-exit" onClick={() => api.setTestClock(null)} data-testid="test-exit">
        Exit test
      </Btn>
    </div>
  );
}

export function ConfirmDialog({
  message,
  yesLabel,
  onYes,
  onNo,
}: {
  message: string;
  yesLabel: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="confirm" role="alertdialog" aria-modal="true" aria-label="Confirm">
      <div className="confirm-card">
        <p>{message}</p>
        <div className="confirm-actions">
          <Btn className="btn-danger" onClick={onYes} data-testid="confirm-yes">
            {yesLabel}
          </Btn>
          <Btn onClick={onNo} data-testid="confirm-no">
            Cancel
          </Btn>
        </div>
      </div>
    </div>
  );
}

/** Printed checklist: every day of the plan, in order. Hidden on screen. */
export function PrintSheet({ api }: { api: CookAlongApi }) {
  const tz = api.plan.timeZone;
  return (
    <div className="print-sheet" aria-hidden="true">
      <h1>{api.plan.title}</h1>
      {api.plan.days.map((d) => (
        <section key={d.id}>
          <h2>{d.label}</h2>
          <ul>
            {api.occurrences
              .filter((o) => o.day === d.id)
              .map((o) => (
                <li key={o.occId}>
                  <span className="pt">{fmtHHMM(o.time, tz)}</span> <span className="pb">☐</span> {o.task.title}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
