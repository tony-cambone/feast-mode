import { describe, expect, it } from 'vitest';
import {
  STORAGE_KEYS,
  createKV,
  getActiveAlerts,
  initialDayState,
  initialPrefs,
  makeTestClock,
} from '../engine';
import { NY, fixturePlan, occsFor, thu } from '../engine/testFixture';
import { DEFAULT_TITLE, alertNotification, documentTitle, idleTitle, loadStore, pickAlarmKind, storeReducer } from './useCookAlong';
import type { Store } from './useCookAlong';

const s0 = initialDayState();
const alertsAt = (t: number, state = s0) => getActiveAlerts(occsFor(state, fixturePlan), state, t, true);

describe('pickAlarmKind', () => {
  it('critical main -> alarm, main -> gentle, heads-up -> headsUp, none -> null', () => {
    expect(pickAlarmKind([])).toBeNull();
    expect(pickAlarmKind(alertsAt(thu('08:45')))).toBe('alarm');
    const doneTo1100 = ['t-0845', 't-0915', 't-1000', 't-1015', 't-1100'].reduce(
      (s, occId) => storeReducer({ clock: { mode: 'real' }, days: { real: s, test: s0 }, prefs: initialPrefs() }, { type: 'day', action: { type: 'done', occId, at: 0 } }).days.real,
      s0,
    );
    expect(pickAlarmKind(alertsAt(thu('11:05'), doneTo1100))).toBe('gentle');
    const only0845 = { ...s0, occ: { 't-0845': { doneAt: 1 } } };
    expect(pickAlarmKind(alertsAt(thu('09:11'), only0845))).toBe('headsUp');
    // Mixed: critical main + heads-up -> alarm.
    expect(pickAlarmKind([...alertsAt(thu('09:11'), only0845), ...alertsAt(thu('08:45'))])).toBe('alarm');
  });
});

describe('notification + title text', () => {
  it('main: "⏰ HH:MM title", body = details without **', () => {
    const [a] = alertsAt(thu('08:45'));
    expect(alertNotification(a, NY)).toEqual({ tag: 't-0845#main', title: '⏰ 08:45 Traeger on 325', body: 'Traeger on 325' });
    const withDetails = { ...a, occ: { ...a.occ, task: { ...a.occ.task, details: '**Stuffing OUT** (center 165°F)' } } };
    expect(alertNotification(withDetails, NY).body).toBe('Stuffing OUT (center 165°F)');
  });

  it('heads-up title says how soon', () => {
    const [h] = alertsAt(thu('09:11'), { ...s0, occ: { 't-0845': { doneAt: 1 } } });
    expect(alertNotification(h, NY)).toMatchObject({ tag: 't-0915#heads', title: '⏰ In 5 min (09:15): Turkey on the Traeger' });
  });

  it('document title', () => {
    expect(documentTitle([])).toBe(DEFAULT_TITLE);
    expect(DEFAULT_TITLE).toBe('Feast Mode');
    expect(documentTitle([], idleTitle(fixturePlan))).toBe('Fixture');
    expect(idleTitle({ title: 'Sunday roast', emoji: '🍗' })).toBe('🍗 Sunday roast');
    expect(idleTitle({ title: '' })).toBe(DEFAULT_TITLE);
    expect(documentTitle(alertsAt(thu('12:31')))).toMatch(/^⏰ \(\d+\) /);
    const stack = alertsAt(thu('12:31'));
    expect(documentTitle(stack)).toBe(`⏰ (${stack.length}) ${stack[0].occ.task.title}`);
  });
});

describe('storeReducer: progress is isolated per clock mode', () => {
  const base: Store = { clock: { mode: 'real' }, days: { real: initialDayState(), test: initialDayState() }, prefs: initialPrefs() };

  it('day actions apply to the current mode only; resetTest never touches real', () => {
    let s = storeReducer(base, { type: 'day', action: { type: 'done', occId: 'a', at: 1 } });
    expect(s.days.real.occ.a).toEqual({ doneAt: 1 });
    s = storeReducer(s, { type: 'clock', clock: makeTestClock(thu('09:00'), 60, 0) });
    expect(s.days.test.occ.a).toBeUndefined();
    s = storeReducer(s, { type: 'day', action: { type: 'done', occId: 'b', at: 2 } });
    expect(s.days.test.occ.b).toEqual({ doneAt: 2 });
    expect(s.days.real.occ.b).toBeUndefined();
    s = storeReducer(s, { type: 'resetTest' });
    expect(s.days.test).toEqual(initialDayState());
    expect(s.days.real.occ.a).toEqual({ doneAt: 1 });
    // Prefs are shared.
    s = storeReducer(s, { type: 'prefs', action: { type: 'toggleCheck', key: 'gravy:ing:0' } });
    s = storeReducer(s, { type: 'clock', clock: { mode: 'real' } });
    expect(s.prefs.checks['gravy:ing:0']).toBe(true);
  });

  it('no-op actions keep identity', () => {
    expect(storeReducer(base, { type: 'day', action: { type: 'undoShift' } })).toBe(base);
    expect(storeReducer(base, { type: 'day', action: { type: 'undone', occId: 'zz' } })).toBe(base);
  });
});

describe('loadStore', () => {
  it('reads all keys through migrate; garbage falls back to defaults', () => {
    const kv = createKV(null);
    kv.set(STORAGE_KEYS.clock, { mode: 'test', baseReal: 1, baseApp: thu('09:00'), speed: 60 });
    kv.set(STORAGE_KEYS.day('fixture', 'real'), { version: 1, occ: { a: { doneAt: 5 } } });
    kv.set(STORAGE_KEYS.day('fixture', 'test'), 'garbage');
    kv.set(STORAGE_KEYS.prefs, { settings: { sound: 'bell' } });
    const s = loadStore(kv, 'fixture');
    expect(s.clock).toEqual({ mode: 'test', baseReal: 1, baseApp: thu('09:00'), speed: 60 });
    expect(s.days.real.occ.a).toEqual({ doneAt: 5 });
    expect(s.days.test).toEqual(initialDayState());
    expect(s.prefs.settings.sound).toBe('bell');
    expect(loadStore(createKV(null), 'fixture')).toEqual({
      clock: { mode: 'real' },
      days: { real: initialDayState(), test: initialDayState() },
      prefs: initialPrefs(),
    });
  });

  it('a KV whose get throws still loads defaults', () => {
    const evil = { ok: false, get: () => { throw new Error('x'); }, set: () => false, remove: () => {} };
    expect(loadStore(evil, 'fixture').clock).toEqual({ mode: 'real' });
  });
});
