import { describe, expect, it } from 'vitest';
import { getActiveAlerts } from './alerts';
import { getBoard } from './board';
import { dayReducer, initialDayState } from './reducer';
import { ANCHOR_ALIGN_LABEL, alignVariantAnchors, isRemaining, planShift, shiftCandidates, shiftLabel } from './shift';
import { MIN, fixturePlan, occById, occsFor, roastPlan, thu, wed } from './testFixture';
import type { DayAction, DayState } from './types';

const apply = (s: DayState, ...actions: DayAction[]) => actions.reduce(dayReducer, s);
const doneAll = (ids: string[], at: number) => ids.map((occId) => ({ type: 'done' as const, occId, at }));

/** Cook has done everything through 11:45. */
const at1150 = apply(
  initialDayState(),
  ...doneAll(['t-0845', 't-0915', 't-1000', 't-1015', 't-1100', 't-1105', 't-stir@11:30'], thu('11:40')),
);

describe('"Running late +15" on the Oven lane', () => {
  const now = thu('11:50');
  const before = occsFor(at1150);
  const rec = planShift(before, at1150, now, 15, { kind: 'lane', lane: 'oven' }, 'Oven +15');
  const shifted = dayReducer(at1150, { type: 'applyShift', record: rec });
  const after = occsFor(shifted);

  it('shifts only remaining oven-lane occurrences', () => {
    expect(rec.label).toBe('Oven +15');
    expect(rec.at).toBe(now);
    expect(rec.deltas).toEqual({ 't-1200': 15, 't-1255': 15, 't-1335': 15 });
    expect(occById(after, 't-1200').time).toBe(thu('12:15'));
    expect(occById(after, 't-1255').time).toBe(thu('13:10'));
    expect(occById(after, 't-1335').time).toBe(thu('13:50'));
  });

  it('leaves done and non-oven occurrences untouched', () => {
    for (const id of ['t-1000', 't-1015', 't-1105', 't-1220', 't-1235', 't-1245', 't-stir@12:00', 't-1215']) {
      expect(occById(after, id).time).toBe(occById(before, id).time);
      expect(occById(after, id).shiftMin).toBe(0);
    }
  });

  it('updates the board and the alerts', () => {
    const board = (s: DayState, t: number) => getBoard(fixturePlan, occsFor(s), s, t).find((d) => d.device === 'oven')!;
    expect(board(at1150, thu('12:05')).setting).toBe(375);
    expect(board(shifted, thu('12:05')).setting).toBe(425);
    expect(board(shifted, thu('12:05')).next?.occ.time).toBe(thu('12:15'));
    expect(board(shifted, thu('13:05')).setting).toBe(375);
    expect(getActiveAlerts(after, shifted, thu('12:00'), true).map((a) => a.key)).toEqual(['t-stir@12:00#main']);
    // Heads-up follows the shifted time: [12:10, 12:15).
    expect(getActiveAlerts(after, shifted, thu('12:10'), true).map((a) => a.key)).toEqual(['t-stir@12:00#main', 't-1200#heads']);
  });

  it('undo restores the plan exactly', () => {
    const undone = dayReducer(shifted, { type: 'undoShift' });
    expect(undone.shifts).toEqual({});
    expect(undone.shiftLog).toEqual([]);
    expect(occsFor(undone).map((o) => [o.occId, o.time])).toEqual(before.map((o) => [o.occId, o.time]));
  });
});

describe('planShift remaining-set rules', () => {
  it('includes the alerting and the snoozed occurrence, excludes done/missed/quiet-now', () => {
    let s = apply(at1150, { type: 'snooze', occId: 't-stir@12:00', until: thu('12:10') });
    const now = thu('12:16'); // t-1200 alerting, stir@12:00 alerting again (snooze over), t-1215 quiet-now
    s = apply(s, { type: 'snooze', occId: 't-1200', until: thu('12:20') });
    const occs = occsFor(s);
    expect(isRemaining(occById(occs, 't-1200'), s, now)).toBe(true); // snoozed
    expect(isRemaining(occById(occs, 't-stir@12:00'), s, now)).toBe(true); // alerting
    expect(isRemaining(occById(occs, 't-1215'), s, now)).toBe(false); // quiet-now
    expect(isRemaining(occById(occs, 't-1015'), s, now)).toBe(false); // done
    expect(isRemaining(occById(occs, 'w-2100'), s, now)).toBe(false); // missed (stale)
    const rec = planShift(occs, s, now, 10, { kind: 'all' }, 'All +10');
    expect(Object.keys(rec.deltas).sort()).toEqual(
      ['t-1200', 't-stir@12:00', 't-1220', 't-stir@12:30', 't-1235', 't-1245', 't-1255', 't-1335'].sort(),
    );
    // w-0900 etc. are stale Wednesday tasks: never shifted.
    expect(rec.deltas['w-0900']).toBeUndefined();
  });

  it('task scope shifts all remaining occurrences of those tasks (negative allowed)', () => {
    const rec = planShift(occsFor(at1150), at1150, thu('11:50'), -45, { kind: 'tasks', taskIds: ['t-stir'] }, 'x');
    expect(rec.deltas).toEqual({ 't-stir@12:00': -45, 't-stir@12:30': -45 });
  });

  it('includes an occurrence exactly at now; zero minutes is an empty record', () => {
    const s = initialDayState();
    expect(planShift(occsFor(s), s, thu('08:45'), 5, { kind: 'lane', lane: 'traeger' }, 't').deltas).toMatchObject({ 't-0845': 5 });
    expect(planShift(occsFor(s), s, thu('08:45'), 0, { kind: 'all' }, 't').deltas).toEqual({});
  });

  it('shifts accumulate; undo pops one record at a time; reset clears', () => {
    let s = at1150;
    const r1 = planShift(occsFor(s), s, thu('11:50'), 15, { kind: 'lane', lane: 'oven' }, 'Oven +15');
    s = dayReducer(s, { type: 'applyShift', record: r1 });
    const r2 = planShift(occsFor(s), s, thu('11:51'), 15, { kind: 'all' }, 'All +15');
    s = dayReducer(s, { type: 'applyShift', record: r2 });
    expect(occById(occsFor(s), 't-1200').time).toBe(thu('12:30'));
    expect(occById(occsFor(s), 't-1220').time).toBe(thu('12:35'));
    expect(s.shiftLog.map((r) => r.label)).toEqual(['Oven +15', 'All +15']);
    s = dayReducer(s, { type: 'undoShift' });
    expect(occById(occsFor(s), 't-1200').time).toBe(thu('12:15'));
    expect(occById(occsFor(s), 't-1220').time).toBe(thu('12:20'));
    s = dayReducer(s, { type: 'applyShift', record: r2 });
    s = dayReducer(s, { type: 'resetShifts' });
    expect(s.shifts).toEqual({});
    expect(s.shiftLog).toEqual([]);
    expect(occById(occsFor(s), 't-1200').time).toBe(thu('12:00'));
    expect(occById(occsFor(s), 't-1200').time - occById(occsFor(s), 't-1100').time).toBe(60 * MIN);
  });
});

describe('shiftCandidates: running late stays within the current day', () => {
  const s0 = initialDayState();
  const occs = occsFor(s0);
  it("'all' and 'lane' only see the board day's occurrences", () => {
    const wedAll = planShift(shiftCandidates(fixturePlan, occs, wed('10:30'), { kind: 'all' }), s0, wed('10:30'), 15, { kind: 'all' }, 'All +15');
    // w-0900 is still alerting (not done) so it counts as remaining; no Thursday occurrence is touched.
    expect(Object.keys(wedAll.deltas).sort()).toEqual(['w-0900', 'w-1000', 'w-1100', 'w-1315', 'w-2100'].sort());
    const wedOven = planShift(shiftCandidates(fixturePlan, occs, wed('10:30'), { kind: 'lane', lane: 'oven' }), s0, wed('10:30'), 15, { kind: 'lane', lane: 'oven' }, 'Oven +15');
    expect(Object.keys(wedOven.deltas).sort()).toEqual(['w-1000', 'w-1100']);
    const thuAll = shiftCandidates(fixturePlan, occs, thu('09:00'), { kind: 'all' });
    expect(thuAll.every((o) => o.day === 'thu')).toBe(true);
  });
  it("'tasks' is unrestricted (whole-bird -45 from Wednesday moves Thursday tasks)", () => {
    const scope = { kind: 'tasks' as const, taskIds: ['t-0845', 't-0915'] };
    const rec = planShift(shiftCandidates(fixturePlan, occs, wed('20:00'), scope), s0, wed('20:00'), -45, scope, 'x');
    expect(rec.deltas).toEqual({ 't-0845': -45, 't-0915': -45 });
  });
});

describe('alignVariantAnchors', () => {
  it('added tasks inherit their anchor\'s current shift when the variant turns on', () => {
    let s = initialDayState();
    const all = planShift(shiftCandidates(fixturePlan, occsFor(s), thu('09:00'), { kind: 'all' }), s, thu('09:00'), 15, { kind: 'all' }, 'All +15');
    s = dayReducer(s, { type: 'applyShift', record: all });
    s = dayReducer(s, { type: 'toggleVariant', variantId: 'late' });
    const rec = alignVariantAnchors(fixturePlan, s, 'late', thu('12:00'));
    expect(rec).toEqual({ at: thu('12:00'), label: ANCHOR_ALIGN_LABEL, deltas: { 't-1230-fb': 15 } });
    s = dayReducer(s, { type: 'applyShift', record: rec });
    expect(occById(occsFor(s), 't-1230-fb').time).toBe(thu('12:45'));
    // Already aligned -> nothing more; existing shift on the added task is accounted for.
    expect(alignVariantAnchors(fixturePlan, s, 'late', thu('12:01')).deltas).toEqual({});
    s = dayReducer(s, { type: 'applyShift', record: { at: 0, label: 'x', deltas: { 't-1230-fb': 5 } } });
    expect(alignVariantAnchors(fixturePlan, s, 'late', thu('12:02')).deltas).toEqual({ 't-1230-fb': -5 });
  });
  it('no anchor shift, unknown variant or no anchors -> empty record', () => {
    const s = dayReducer(initialDayState(), { type: 'toggleVariant', variantId: 'late' });
    expect(alignVariantAnchors(fixturePlan, s, 'late', 1).deltas).toEqual({});
    expect(alignVariantAnchors(fixturePlan, s, 'nope', 1).deltas).toEqual({});
  });
});

describe('lane membership in shifts', () => {
  it("'Traeger +30' does not move the oven turkey even though it is tagged traeger", () => {
    const s = initialDayState();
    const rec = planShift(occsFor(s), s, thu('09:00'), 30, { kind: 'lane', lane: 'traeger' }, 'Traeger +30');
    // t-0845 is overdue/alerting (remaining); t-1015 'Turkey into oven' (devices: oven) is not in the lane.
    expect(Object.keys(rec.deltas).sort()).toEqual(['t-0845', 't-0915', 't-1245']);
  });
});

describe('shiftLabel', () => {
  it('formats lane / all / tasks', () => {
    expect(shiftLabel(15, { kind: 'lane', lane: 'oven' }, fixturePlan)).toBe('Oven +15');
    expect(shiftLabel(30, { kind: 'lane', lane: 'traeger' }, fixturePlan)).toBe('Traeger +30');
    expect(shiftLabel(10, { kind: 'lane', lane: 'grill' }, fixturePlan)).toBe('Grill +10'); // short label
    expect(shiftLabel(-10, { kind: 'lane', lane: 'air-fryer' }, roastPlan)).toBe('Fryer -10');
    expect(shiftLabel(5, { kind: 'lane', lane: 'smoker' })).toBe('smoker +5'); // no plan: the id
    expect(shiftLabel(15, { kind: 'all' })).toBe('All +15');
    expect(shiftLabel(-45, { kind: 'tasks', taskIds: ['a', 'b', 'c', 'd'] })).toBe('4 tasks -45');
  });
});
