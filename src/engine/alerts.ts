/**
 * Status, alert stack and now/next — all pure derivations from (occurrences, state, now),
 * so catch-up after a hidden tab, sleep or reload is automatic.
 */
import type { Plan } from '../data/types';
import { byTimeThenOrder } from './plan';
import { MINUTE_MS, boardDay } from './time';
import type { ActiveAlert, DayState, NowNext, Occurrence, OccState, OccStatus } from './types';
import { QUIET_WINDOW_MIN, STALE_AFTER_MIN } from './types';

export const STALE_AFTER_MS = STALE_AFTER_MIN * MINUTE_MS;
export const QUIET_WINDOW_MS = QUIET_WINDOW_MIN * MINUTE_MS;

const EMPTY: OccState = {};

export function occStateOf(state: DayState, occId: string): OccState {
  return state.occ[occId] ?? EMPTY;
}

export function isQuiet(occ: Occurrence): boolean {
  return occ.task.alert === 'quiet';
}

export function isDone(state: DayState, occId: string): boolean {
  return typeof state.occ[occId]?.doneAt === 'number';
}

export function statusOf(occ: Occurrence, state: DayState, now: number): OccStatus {
  const s = occStateOf(state, occ.occId);
  if (typeof s.doneAt === 'number') return 'done';
  if (now < occ.time) return 'upcoming';
  if (isQuiet(occ)) return now - occ.time < QUIET_WINDOW_MS ? 'quiet-now' : 'missed';
  if (now - occ.time >= STALE_AFTER_MS) return 'missed';
  if (typeof s.snoozedUntil === 'number' && s.snoozedUntil > now) return 'snoozed';
  return 'alerting';
}

/** Lead time of a task's heads-up, in ms; 0 when it has none. */
function headsUpMs(occ: Occurrence): number {
  const n = occ.task.headsUpMin;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n * MINUTE_MS : 0;
}

/**
 * Active alert stack, front first. See the contract comment in index.ts.
 * main:    not quiet, not done, time <= now < time + STALE, not snoozed (snoozedUntil unset or <= now).
 *          dueAt = max(time, snoozedUntil) so every snooze expiry is a new firing.
 * headsUp: enabled, task.headsUpMin, not quiet, not done, time - headsUpMin <= now < time,
 *          headsUpAckFor !== time (shifting the task re-arms it).
 */
export function getActiveAlerts(occs: Occurrence[], state: DayState, now: number, headsUpEnabled: boolean): ActiveAlert[] {
  const out: ActiveAlert[] = [];
  for (const occ of occs) {
    if (isQuiet(occ)) continue;
    const s = occStateOf(state, occ.occId);
    if (typeof s.doneAt === 'number') continue;
    const critical = occ.task.critical === true;
    if (now >= occ.time) {
      if (now - occ.time >= STALE_AFTER_MS) continue;
      const snoozed = typeof s.snoozedUntil === 'number' ? s.snoozedUntil : undefined;
      if (snoozed !== undefined && snoozed > now) continue;
      const dueAt = snoozed !== undefined && snoozed > occ.time ? snoozed : occ.time;
      const key = `${occ.occId}#main`;
      out.push({ key, type: 'main', occ, critical, dueAt, firingId: `${key}@${dueAt}` });
    } else if (headsUpEnabled) {
      const lead = headsUpMs(occ);
      if (lead === 0) continue;
      const dueAt = occ.time - lead;
      if (now < dueAt) continue;
      if (s.headsUpAckFor === occ.time) continue;
      const key = `${occ.occId}#heads`;
      out.push({ key, type: 'headsUp', occ, critical, dueAt, firingId: `${key}@${dueAt}` });
    }
  }
  out.sort(compareAlerts);
  return out;
}

/** main before headsUp; critical before non-critical; then occ.time; then order. */
export function compareAlerts(a: ActiveAlert, b: ActiveAlert): number {
  if (a.type !== b.type) return a.type === 'main' ? -1 : 1;
  if (a.critical !== b.critical) return a.critical ? -1 : 1;
  return byTimeThenOrder(a.occ, b.occ);
}

/** Quiet tasks inside [time, time + QUIET_WINDOW_MIN) and not done. */
export function getQuietNotices(occs: Occurrence[], state: DayState, now: number): Occurrence[] {
  return occs
    .filter((o) => isQuiet(o) && !isDone(state, o.occId) && now >= o.time && now - o.time < QUIET_WINDOW_MS)
    .sort(byTimeThenOrder);
}

export function getNowNext(plan: Plan, occs: Occurrence[], state: DayState, now: number): NowNext {
  const sorted = occs.slice().sort(byTimeThenOrder);
  const day = boardDay(plan, now);
  const current: Occurrence[] = [];
  let lastStarted: Occurrence | undefined;
  const future: Occurrence[] = [];
  for (const o of sorted) {
    if (o.time <= now) {
      if (o.day === day) lastStarted = o;
      const st = statusOf(o, state, now);
      if (st === 'alerting' || st === 'snoozed' || st === 'quiet-now') current.push(o);
    } else if (!isDone(state, o.occId)) {
      future.push(o);
    }
  }
  const next = future[0];
  return {
    current,
    lastStarted,
    next,
    nextInMs: next ? next.time - now : undefined,
    upcoming: future.slice(1, 5),
  };
}

/* ---------------- helpers for the store (sound / notifications / title) ---------------- */

export type AlarmLevel = 'alarm' | 'gentle' | 'headsUp';

/** The loudest active alert decides the sound: critical main -> alarm; any main -> gentle; heads-up -> headsUp; none -> null. */
export function pickAlarmKind(alerts: readonly ActiveAlert[]): AlarmLevel | null {
  if (alerts.length === 0) return null;
  if (alerts.some((a) => a.type === 'main' && a.critical)) return 'alarm';
  if (alerts.some((a) => a.type === 'main')) return 'gentle';
  return 'headsUp';
}

/** Strip markdown emphasis markers for plain-text surfaces (notifications). */
export function stripMarkdown(s: string | undefined): string {
  return (s ?? '').replace(/\*\*/g, '');
}
