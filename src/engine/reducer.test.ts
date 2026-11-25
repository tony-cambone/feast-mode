import { describe, expect, it } from 'vitest';
import { getActiveAlerts } from './alerts';
import { dayReducer, initialDayState, initialPrefs, migrateDayState, migratePrefs, prefsReducer } from './reducer';
import { occsFor, thu } from './testFixture';
import type { DayState, ShiftRecord } from './types';

const rec = (label: string, deltas: Record<string, number>): ShiftRecord => ({ at: 1, label, deltas });

describe('dayReducer', () => {
  it('done / undone', () => {
    const s0 = initialDayState();
    const s1 = dayReducer(s0, { type: 'done', occId: 'a', at: 100 });
    expect(s1.occ.a).toEqual({ doneAt: 100 });
    expect(s0.occ).toEqual({}); // never mutates
    const s2 = dayReducer(s1, { type: 'undone', occId: 'a' });
    expect(s2.occ.a).toBeUndefined();
    expect(dayReducer(s2, { type: 'undone', occId: 'a' })).toBe(s2); // no-op keeps identity
  });

  it('undone keeps the heads-up ack; done clears a pending snooze', () => {
    let s = dayReducer(initialDayState(), { type: 'ackHeadsUp', occId: 'a', forTime: 5 });
    s = dayReducer(s, { type: 'snooze', occId: 'a', until: 50 });
    s = dayReducer(s, { type: 'done', occId: 'a', at: 60 });
    expect(s.occ.a).toEqual({ headsUpAckFor: 5, doneAt: 60 });
    s = dayReducer(s, { type: 'undone', occId: 'a' });
    expect(s.occ.a).toEqual({ headsUpAckFor: 5 });
  });

  it('applyShift adds deltas and logs; undoShift subtracts the last; resetShifts clears', () => {
    let s = initialDayState();
    s = dayReducer(s, { type: 'applyShift', record: rec('Oven +15', { a: 15, b: 15 }) });
    s = dayReducer(s, { type: 'applyShift', record: rec('All +10', { a: 10, c: 10 }) });
    expect(s.shifts).toEqual({ a: 25, b: 15, c: 10 });
    expect(s.shiftLog.map((r) => r.label)).toEqual(['Oven +15', 'All +10']);
    s = dayReducer(s, { type: 'undoShift' });
    expect(s.shifts).toEqual({ a: 15, b: 15 });
    s = dayReducer(s, { type: 'undoShift' });
    expect(s.shifts).toEqual({});
    expect(s.shiftLog).toEqual([]);
    expect(dayReducer(s, { type: 'undoShift' })).toBe(s);
    const empty = dayReducer(s, { type: 'applyShift', record: rec('none', {}) });
    expect(empty).toBe(s); // empty records are not logged
    s = dayReducer(s, { type: 'applyShift', record: rec('x', { a: 5 }) });
    s = dayReducer(s, { type: 'resetShifts' });
    expect(s.shifts).toEqual({});
    expect(s.shiftLog).toEqual([]);
  });

  it('applyShift clears snoozedUntil for every shifted occId (keeps other fields)', () => {
    let s = dayReducer(initialDayState(), { type: 'snooze', occId: 'a', until: 50 });
    s = dayReducer(s, { type: 'ackHeadsUp', occId: 'b', forTime: 7 });
    s = dayReducer(s, { type: 'snooze', occId: 'b', until: 60 });
    s = dayReducer(s, { type: 'snooze', occId: 'c', until: 70 });
    s = dayReducer(s, { type: 'applyShift', record: rec('x', { a: 5, b: 5 }) });
    expect(s.occ.a).toBeUndefined();
    expect(s.occ.b).toEqual({ headsUpAckFor: 7 });
    expect(s.occ.c).toEqual({ snoozedUntil: 70 }); // not shifted -> untouched
  });

  it('toggleVariant and reset', () => {
    let s = dayReducer(initialDayState(), { type: 'toggleVariant', variantId: 'late' });
    expect(s.activeVariants).toEqual(['late']);
    s = dayReducer(s, { type: 'done', occId: 'a', at: 1 });
    s = dayReducer(s, { type: 'toggleVariant', variantId: 'late' });
    expect(s.activeVariants).toEqual([]);
    expect(dayReducer(s, { type: 'reset' })).toEqual(initialDayState());
  });
});

describe('Done persists through a migrate round-trip', () => {
  it('serialize -> JSON -> migrateDayState keeps done, snooze, ack, shifts, variants', () => {
    let s: DayState = initialDayState();
    s = dayReducer(s, { type: 'done', occId: 't-0845', at: thu('08:46') });
    s = dayReducer(s, { type: 'done', occId: 't-stir@11:30', at: thu('11:31') });
    s = dayReducer(s, { type: 'snooze', occId: 't-1000', until: thu('10:05') });
    s = dayReducer(s, { type: 'ackHeadsUp', occId: 't-0915', forTime: thu('09:15') });
    s = dayReducer(s, { type: 'applyShift', record: rec('Oven +15', { 't-1200': 15 }) });
    s = dayReducer(s, { type: 'toggleVariant', variantId: 'late' });
    const restored = migrateDayState(JSON.parse(JSON.stringify(s)));
    expect(restored).toEqual(s);
    // And the restored state drives alerts identically.
    const now = thu('08:50');
    expect(getActiveAlerts(occsFor(restored), restored, now, true).map((a) => a.key)).toEqual(
      getActiveAlerts(occsFor(s), s, now, true).map((a) => a.key),
    );
    expect(getActiveAlerts(occsFor(restored), restored, now, true).map((a) => a.key)).not.toContain('t-0845#main');
  });
});

describe('migrateDayState never throws and fills defaults', () => {
  it.each([undefined, null, 42, 'x', [], true, { version: 2, occ: { a: { doneAt: 1 } } }])('garbage %j -> initial', (raw) => {
    expect(migrateDayState(raw)).toEqual(initialDayState());
  });

  it('drops malformed fields and keeps the good ones', () => {
    const raw = {
      version: 1,
      occ: { a: { doneAt: 5, snoozedUntil: 'soon' }, b: 'nope', c: { headsUpAckFor: NaN }, d: { snoozedUntil: 7 } },
      shifts: { a: 15, b: 'x', c: 0, d: Infinity },
      shiftLog: [{ at: 1, label: 'Oven +15', deltas: { a: 15, z: 'q' } }, 'junk', { deltas: null }],
      activeVariants: ['late', 3, 'late'],
    };
    expect(migrateDayState(raw)).toEqual({
      version: 1,
      occ: { a: { doneAt: 5 }, d: { snoozedUntil: 7 } },
      shifts: { a: 15 },
      shiftLog: [{ at: 1, label: 'Oven +15', deltas: { a: 15 } }, { at: 0, label: '', deltas: {} }],
      activeVariants: ['late'],
    });
    expect(migrateDayState({})).toEqual(initialDayState());
  });

  it('survives hostile objects (throwing getters)', () => {
    const evil = Object.defineProperty({}, 'occ', { enumerable: true, get: () => { throw new Error('boom'); } });
    expect(() => migrateDayState(evil)).not.toThrow();
    expect(migrateDayState(evil)).toEqual(initialDayState());
    expect(() => migratePrefs(evil)).not.toThrow();
  });
});

describe('prefs', () => {
  it('settings patches are validated', () => {
    let p = initialPrefs();
    expect(p.settings).toEqual({ sound: 'klaxon', volume: 0.9, headsUpEnabled: true });
    p = prefsReducer(p, { type: 'settings', patch: { sound: 'bell', volume: 3 } });
    expect(p.settings).toEqual({ sound: 'bell', volume: 1, headsUpEnabled: true });
    p = prefsReducer(p, { type: 'settings', patch: { sound: 'siren' as never, volume: -1, headsUpEnabled: false } });
    expect(p.settings).toEqual({ sound: 'bell', volume: 0, headsUpEnabled: false });
  });

  it('toggleCheck and dismissChecklist', () => {
    let p = prefsReducer(initialPrefs(), { type: 'toggleCheck', key: 'gravy:ing:0' });
    expect(p.checks).toEqual({ 'gravy:ing:0': true });
    p = prefsReducer(p, { type: 'toggleCheck', key: 'gravy:ing:0' });
    expect(p.checks).toEqual({});
    p = prefsReducer(p, { type: 'dismissChecklist' });
    expect(p.setupChecklistDismissed).toBe(true);
    expect(prefsReducer(p, { type: 'dismissChecklist' })).toBe(p);
  });

  it('migratePrefs round-trips and repairs', () => {
    let p = prefsReducer(initialPrefs(), { type: 'toggleCheck', key: 'quiche:step:2' });
    p = prefsReducer(p, { type: 'settings', patch: { sound: 'triple-beep', volume: 0.4 } });
    expect(migratePrefs(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(migratePrefs(null)).toEqual(initialPrefs());
    expect(migratePrefs({ settings: { volume: 'loud', sound: 'nope' }, checks: { a: true, b: 'yes' } })).toEqual({
      ...initialPrefs(),
      checks: { a: true },
    });
  });
});
