import { describe, expect, it } from 'vitest';
import type { DayAction, DayState } from './types';
import { STALE_AFTER_MIN } from './types';
import { getActiveAlerts, getNowNext, getQuietNotices, pickAlarmKind, statusOf, stripMarkdown } from './alerts';
import { dayReducer, initialDayState, migrateDayState } from './reducer';
import { planShift } from './shift';
import { MIN, fixturePlan, occById, occsFor, thu, wed } from './testFixture';

const apply = (s: DayState, ...actions: DayAction[]) => actions.reduce(dayReducer, s);
const keys = (s: DayState, now: number, headsUp = true) => getActiveAlerts(occsFor(s), s, now, headsUp).map((a) => a.key);

/** Acknowledge every alert as the cook would: Done for a main, Got it for a heads-up. Ack front-first. */
function ackAll(state: DayState, now: number): { state: DayState; acked: string[] } {
  const acked: string[] = [];
  for (let guard = 0; guard < 100; guard++) {
    const stack = getActiveAlerts(occsFor(state), state, now, true);
    if (stack.length === 0) break;
    const a = stack[0];
    acked.push(a.key);
    state =
      a.type === 'main'
        ? dayReducer(state, { type: 'done', occId: a.occ.occId, at: now })
        : dayReducer(state, { type: 'ackHeadsUp', occId: a.occ.occId, forTime: a.occ.time });
  }
  return { state, acked };
}

describe('statusOf', () => {
  const s0 = initialDayState();
  const occs = occsFor(s0);
  const o = occById(occs, 't-1200');

  it('upcoming -> alerting -> snoozed -> alerting -> done', () => {
    expect(statusOf(o, s0, thu('11:59'))).toBe('upcoming');
    expect(statusOf(o, s0, thu('12:00') - 1)).toBe('upcoming');
    expect(statusOf(o, s0, thu('12:00'))).toBe('alerting');
    const snoozed = dayReducer(s0, { type: 'snooze', occId: 't-1200', until: thu('12:06') });
    expect(statusOf(o, snoozed, thu('12:05'))).toBe('snoozed');
    expect(statusOf(o, snoozed, thu('12:06'))).toBe('alerting');
    const done = dayReducer(snoozed, { type: 'done', occId: 't-1200', at: thu('12:07') });
    expect(statusOf(o, done, thu('12:07'))).toBe('done');
    expect(statusOf(o, done, thu('11:00'))).toBe('done');
  });

  it('modal tasks go missed after the stale cutoff', () => {
    expect(statusOf(o, s0, thu('12:00') + STALE_AFTER_MIN * MIN - 1)).toBe('alerting');
    expect(statusOf(o, s0, thu('12:00') + STALE_AFTER_MIN * MIN)).toBe('missed');
  });

  it('quiet tasks: upcoming -> quiet-now for 15 min -> missed', () => {
    const q = occById(occs, 't-1215');
    expect(statusOf(q, s0, thu('12:14'))).toBe('upcoming');
    expect(statusOf(q, s0, thu('12:15'))).toBe('quiet-now');
    expect(statusOf(q, s0, thu('12:29') + 59_999)).toBe('quiet-now');
    expect(statusOf(q, s0, thu('12:30'))).toBe('missed');
  });
});

describe('getActiveAlerts', () => {
  const s0 = initialDayState();

  it('main fires exactly at time, never early', () => {
    expect(keys(s0, thu('08:45') - 1)).toEqual([]);
    expect(keys(s0, thu('08:45'))).toEqual(['t-0845#main']);
    const [a] = getActiveAlerts(occsFor(s0), s0, thu('08:45'), true);
    expect(a).toMatchObject({ type: 'main', critical: true, dueAt: thu('08:45'), firingId: `t-0845#main@${thu('08:45')}` });
  });

  it('heads-up is active in [time - headsUpMin, time) and is replaced by the main at time', () => {
    const s = apply(s0, { type: 'done', occId: 't-0845', at: thu('08:45') });
    expect(keys(s, thu('09:10') - 1)).toEqual([]);
    expect(keys(s, thu('09:10'))).toEqual(['t-0915#heads']);
    const [h] = getActiveAlerts(occsFor(s), s, thu('09:12'), true);
    expect(h).toMatchObject({ type: 'headsUp', dueAt: thu('09:10'), firingId: `t-0915#heads@${thu('09:10')}` });
    expect(keys(s, thu('09:15') - 1)).toEqual(['t-0915#heads']);
    expect(keys(s, thu('09:15'))).toEqual(['t-0915#main']);
    expect(keys(s, thu('09:12'), false)).toEqual([]); // headsUpEnabled = false
  });

  it('heads-up ack suppresses it for that time only; shifting the task re-arms it', () => {
    let s = apply(s0, { type: 'done', occId: 't-0845', at: thu('08:45') });
    s = dayReducer(s, { type: 'ackHeadsUp', occId: 't-0915', forTime: thu('09:15') });
    expect(keys(s, thu('09:11'))).toEqual([]);
    expect(keys(s, thu('09:15'))).toEqual(['t-0915#main']); // ack never suppresses the main
    // Running late +15 at 09:12: the heads-up re-arms for the new 09:30 time.
    const rec = planShift(occsFor(s), s, thu('09:12'), 15, { kind: 'lane', lane: 'traeger' }, 'Traeger +15');
    s = dayReducer(s, { type: 'applyShift', record: rec });
    expect(keys(s, thu('09:15'))).toEqual([]);
    expect(keys(s, thu('09:25'))).toEqual(['t-0915#heads']);
    expect(keys(s, thu('09:30'))).toEqual(['t-0915#main']);
  });

  it('done before time removes both heads-up and main', () => {
    const s = apply(s0, { type: 'done', occId: 't-0845', at: thu('08:45') }, { type: 'done', occId: 't-0915', at: thu('09:11') });
    expect(keys(s, thu('09:12'))).toEqual([]);
    expect(keys(s, thu('09:20'))).toEqual([]);
  });

  it('quiet tasks never produce alerts', () => {
    const occs = occsFor(s0);
    const all = [wed('13:15'), wed('13:20'), thu('12:15'), thu('12:16')].flatMap((t) => getActiveAlerts(occs, s0, t, true));
    expect(all.some((a) => a.occ.task.alert === 'quiet')).toBe(false);
  });

  it('stale cutoff: older than STALE_AFTER_MIN stops alarming', () => {
    // Wednesday 21:00 check is still alerting at 02:59 Thu, gone at 03:00.
    const s = apply(s0, ...['w-0900', 'w-1000', 'w-1100'].map((occId) => ({ type: 'done' as const, occId, at: wed('12:00') })));
    expect(keys(s, wed('21:00') + STALE_AFTER_MIN * MIN - 1)).toEqual(['w-2100#main']);
    expect(keys(s, wed('21:00') + STALE_AFTER_MIN * MIN)).toEqual([]);
    expect(keys(s0, thu('06:55'))).toEqual([]); // nothing from Wednesday blasts on Thursday morning
  });

  it('orders main before heads-up, critical before non-critical, then by time', () => {
    // 12:31: t-1235 heads-up active; mains: crit 12:00/12:20, non-crit stir 11:30/12:00/12:30, crit 11:00...
    const s = apply(
      s0,
      ...['t-0845', 't-0915', 't-1000', 't-1015'].map((occId) => ({ type: 'done' as const, occId, at: thu('10:15') })),
    );
    expect(keys(s, thu('12:31'))).toEqual([
      't-1100#main',
      't-1200#main',
      't-1220#main',
      't-1105#main',
      't-stir@11:30#main',
      't-stir@12:00#main',
      't-stir@12:30#main',
      't-1235#heads',
    ]);
  });
});

describe('catch-up after a hidden tab (10:05 -> 12:30)', () => {
  it('stacks every due unacknowledged alert in order; acking each empties it', () => {
    // Cook is on top of things until 10:05.
    let s = initialDayState();
    for (let t = thu('06:55'); t <= thu('10:05'); t += 15_000) s = ackAll(s, t).state;
    expect(keys(s, thu('10:05'))).toEqual([]);
    expect(s.occ['t-1000'].doneAt).toBe(thu('10:00'));
    expect(s.occ['t-1015']).toBeUndefined();

    // Tab hidden 10:05 -> 12:30: no ticks at all. On return, one derivation catches up.
    const stack = getActiveAlerts(occsFor(s), s, thu('12:30'), true);
    expect(stack.map((a) => a.key)).toEqual([
      't-1015#main', // critical mains, by time
      't-1100#main',
      't-1200#main',
      't-1220#main',
      't-1105#main', // non-critical mains, by time
      't-stir@11:30#main',
      't-stir@12:00#main',
      't-stir@12:30#main',
      't-1235#heads', // heads-up last (12:30 is inside 12:35's window)
    ]);
    // Heads-ups whose main is already due are gone (no stale "in 5 min" for 10:15, 12:00, 12:20).
    expect(stack.filter((a) => a.type === 'headsUp')).toHaveLength(1);
    // Quiet 12:15 shows as a toast, not a modal.
    expect(getQuietNotices(occsFor(s), s, thu('12:30')).map((o) => o.occId)).toEqual([]); // 12:15 + 15 = 12:30 -> window closed
    expect(getQuietNotices(occsFor(s), s, thu('12:29')).map((o) => o.occId)).toEqual(['t-1215']);

    const { state, acked } = ackAll(s, thu('12:30'));
    expect(acked).toEqual(stack.map((a) => a.key));
    expect(keys(state, thu('12:30'))).toEqual([]);
    expect(keys(state, thu('12:34'))).toEqual([]); // heads-up stays acknowledged
    expect(keys(state, thu('12:35'))).toEqual(['t-1235#main']);
  });
});

describe('snooze', () => {
  const base = apply(initialDayState(), ...['t-0845', 't-0915', 't-1000', 't-1015', 't-1100', 't-1105', 't-stir@11:30'].map((occId) => ({ type: 'done' as const, occId, at: thu('11:30') })));

  it.each([5, 10])('snooze %i hides the alert until exactly then, and it re-fires with a new firingId', (m) => {
    const at = thu('12:01');
    const first = getActiveAlerts(occsFor(base), base, at, true).find((a) => a.occ.occId === 't-1200')!;
    expect(first.firingId).toBe(`t-1200#main@${thu('12:00')}`);
    const s = dayReducer(base, { type: 'snooze', occId: 't-1200', until: at + m * MIN });
    const visible = (t: number) => getActiveAlerts(occsFor(s), s, t, true).find((a) => a.occ.occId === 't-1200');
    expect(visible(at)).toBeUndefined();
    expect(visible(at + m * MIN - 1)).toBeUndefined();
    const again = visible(at + m * MIN)!;
    expect(again).toBeDefined();
    expect(again.dueAt).toBe(at + m * MIN);
    expect(again.firingId).toBe(`t-1200#main@${at + m * MIN}`);
    expect(again.firingId).not.toBe(first.firingId);
    expect(statusOf(again.occ, s, at + 1)).toBe('snoozed');
  });

  it('snoozing twice re-fires after the second snooze; done clears the snooze', () => {
    let s = dayReducer(base, { type: 'snooze', occId: 't-1200', until: thu('12:05') });
    s = dayReducer(s, { type: 'snooze', occId: 't-1200', until: thu('12:15') });
    expect(keys(s, thu('12:10'))).not.toContain('t-1200#main');
    expect(keys(s, thu('12:15'))).toContain('t-1200#main');
    s = dayReducer(s, { type: 'done', occId: 't-1200', at: thu('12:16') });
    expect(s.occ['t-1200'].snoozedUntil).toBeUndefined();
    expect(keys(s, thu('12:16'))).not.toContain('t-1200#main');
  });

  it('a shift replaces a pending snooze: snoozed until 12:31, shifted to 12:25 -> fires at 12:25', () => {
    const at = thu('12:21');
    let s = dayReducer(base, { type: 'snooze', occId: 't-1220', until: thu('12:31') });
    const rec = planShift(occsFor(s), s, at, 5, { kind: 'tasks', taskIds: ['t-1220'] }, '1 task +5');
    expect(rec.deltas).toEqual({ 't-1220': 5 });
    s = dayReducer(s, { type: 'applyShift', record: rec });
    expect(s.occ['t-1220']?.snoozedUntil).toBeUndefined();
    const t1220 = (t: number) => getActiveAlerts(occsFor(s), s, t, true).find((a) => a.occ.occId === 't-1220' && a.type === 'main');
    expect(t1220(thu('12:24') + 59_999)).toBeUndefined();
    // (its heads-up re-arms for the new time in the meantime)
    expect(getActiveAlerts(occsFor(s), s, thu('12:22'), true).map((a) => a.key)).toContain('t-1220#heads');
    expect(t1220(thu('12:25'))).toMatchObject({ type: 'main', dueAt: thu('12:25') });
  });

  it('snooze and done survive a storage round-trip', () => {
    let s = dayReducer(base, { type: 'snooze', occId: 't-1200', until: thu('12:06') });
    s = dayReducer(s, { type: 'done', occId: 't-stir@12:00', at: thu('12:01') });
    const restored = migrateDayState(JSON.parse(JSON.stringify(s)));
    expect(restored).toEqual(s);
    expect(keys(restored, thu('12:03'))).toEqual([]);
    expect(keys(restored, thu('12:06'))).toEqual(['t-1200#main']);
  });
});

describe('getNowNext', () => {
  const s0 = initialDayState();
  it('current = alerting + snoozed + quiet-now; next/upcoming skip done', () => {
    let s = apply(s0, ...['t-0845', 't-0915', 't-1000', 't-1015', 't-1100', 't-1105'].map((occId) => ({ type: 'done' as const, occId, at: thu('11:10') })));
    s = dayReducer(s, { type: 'snooze', occId: 't-stir@12:00', until: thu('12:20') });
    s = dayReducer(s, { type: 'done', occId: 't-1220', at: thu('12:16') }); // done early
    const nn = getNowNext(fixturePlan, occsFor(s), s, thu('12:16'));
    expect(nn.current.map((o) => o.occId)).toEqual(['t-stir@11:30', 't-stir@12:00', 't-1200', 't-1215']);
    expect(nn.lastStarted?.occId).toBe('t-1215');
    expect(nn.next?.occId).toBe('t-stir@12:30'); // 12:20 grill is done already
    expect(nn.nextInMs).toBe(14 * MIN);
    expect(nn.upcoming.map((o) => o.occId)).toEqual(['t-1235', 't-1245', 't-1255', 't-1335']);
  });

  it('before the day starts there is no lastStarted on the board day; after the end there is no next', () => {
    const early = getNowNext(fixturePlan, occsFor(s0), s0, wed('06:00'));
    expect(early.lastStarted).toBeUndefined();
    expect(early.next?.occId).toBe('w-0900');
    expect(early.upcoming).toHaveLength(4);
    const late = getNowNext(fixturePlan, occsFor(s0), s0, thu('20:00'));
    expect(late.next).toBeUndefined();
    expect(late.nextInMs).toBeUndefined();
    expect(late.upcoming).toEqual([]);
    expect(late.lastStarted?.occId).toBe('t-1335');
  });

  it('missed (stale) occurrences are not current', () => {
    const nn = getNowNext(fixturePlan, occsFor(s0), s0, thu('06:55'));
    expect(nn.current).toEqual([]);
    expect(nn.next?.occId).toBe('t-0845');
  });
});

describe('helpers', () => {
  it('pickAlarmKind: loudest wins', () => {
    const s0 = initialDayState();
    const occs = occsFor(s0);
    expect(pickAlarmKind([])).toBeNull();
    expect(pickAlarmKind(getActiveAlerts(occs, s0, thu('08:45'), true))).toBe('alarm');
    const s = apply(s0, ...['t-0845', 't-0915', 't-1000', 't-1015', 't-1100'].map((occId) => ({ type: 'done' as const, occId, at: thu('11:00') })));
    expect(pickAlarmKind(getActiveAlerts(occsFor(s), s, thu('11:05'), true))).toBe('gentle');
    const s2 = dayReducer(s0, { type: 'done', occId: 't-0845', at: thu('08:45') });
    expect(pickAlarmKind(getActiveAlerts(occsFor(s2), s2, thu('09:12'), true))).toBe('headsUp');
  });

  it('stripMarkdown removes bold markers', () => {
    expect(stripMarkdown('**Stuffing OUT** (center 165°F)')).toBe('Stuffing OUT (center 165°F)');
    expect(stripMarkdown(undefined)).toBe('');
  });
});
