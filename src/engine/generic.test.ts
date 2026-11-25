/**
 * Generic paths: a one-day, °C, Europe/London plan with an 'air-fryer' device and none of the
 * optional arrays. Nothing in the engine may assume wed/thu, the Thanksgiving devices, NY or °F.
 */
import { describe, expect, it } from 'vitest';
import type { Plan } from '../data/types';
import { getActiveAlerts, getNowNext, statusOf } from './alerts';
import { getBoard } from './board';
import { buildOccurrences, dayDates, deviceIds, inLane, lanesOf, resolveTasks, testModeCutoffs } from './plan';
import { dayReducer, initialDayState } from './reducer';
import { alignVariantAnchors, planShift, shiftCandidates } from './shift';
import { getAllSpans, getDaySpans } from './spans';
import { LONDON, MIN, fixturePlan, occById, occsFor, roastPlan, sun, thu, wed } from './testFixture';
import { boardDay, currentPlanDay, epochToZoned, formatHHMM, zonedToEpoch } from './time';
import type { DayState } from './types';

const s0 = initialDayState();
const occs = occsFor(s0, roastPlan);

describe('time in the plan zone (Europe/London, BST in July)', () => {
  it('converts wall times with the plan zone, not New York', () => {
    expect(sun('11:00')).toBe(Date.UTC(2026, 6, 12, 10, 0)); // UTC+1
    expect(formatHHMM(sun('11:00'), LONDON)).toBe('11:00');
    expect(formatHHMM(sun('11:00'), 'America/New_York')).toBe('06:00');
    expect(epochToZoned(sun('13:00'), LONDON)).toMatchObject({ dateISO: '2026-07-12', hhmm: '13:00', weekday: 'Sun' });
    // London in winter is UTC+0.
    expect(zonedToEpoch('2026-12-20', '12:00', LONDON)).toBe(Date.UTC(2026, 11, 20, 12, 0));
  });

  it('occurrences use plan.days dates and the plan zone', () => {
    expect(dayDates(roastPlan)).toEqual(new Map([['sun', '2026-07-12']]));
    expect(occById(occs, 'r-1100').time).toBe(sun('11:00'));
    expect(occs.filter((o) => o.task.id === 'r-shake').map((o) => [o.occId, o.time])).toEqual([
      ['r-shake@12:15', sun('12:15')],
      ['r-shake@12:20', sun('12:20')],
    ]);
    expect(occs.every((o) => o.day === 'sun')).toBe(true);
  });
});

describe('days come from plan.days', () => {
  it('a one-day plan: that day is the board day before, during and after', () => {
    expect(currentPlanDay(roastPlan, sun('12:00'))).toBe('sun');
    expect(currentPlanDay(roastPlan, sun('12:00') - 24 * 60 * MIN)).toBeNull();
    expect(boardDay(roastPlan, sun('12:00') - 3 * 24 * 60 * MIN)).toBe('sun');
    expect(boardDay(roastPlan, sun('12:00') + 3 * 24 * 60 * MIN)).toBe('sun');
    // The date is taken in the plan zone: 00:30 London on the 12th is still the 11th in New York.
    expect(currentPlanDay(roastPlan, zonedToEpoch('2026-07-12', '00:30', LONDON))).toBe('sun');
  });

  it('nearest day across gaps, unsorted days, and no days', () => {
    const gappy: Plan = {
      ...roastPlan,
      days: [
        { id: 'd3', date: '2026-07-20', label: '' },
        { id: 'd1', date: '2026-07-10', label: '' },
        { id: 'd2', date: '2026-07-14', label: '' },
      ],
    };
    const at = (date: string) => zonedToEpoch(date, '12:00', LONDON);
    expect(boardDay(gappy, at('2026-07-01'))).toBe('d1');
    expect(boardDay(gappy, at('2026-07-11'))).toBe('d1');
    expect(boardDay(gappy, at('2026-07-12'))).toBe('d1'); // tie -> earlier
    expect(boardDay(gappy, at('2026-07-13'))).toBe('d2');
    expect(boardDay(gappy, at('2026-07-18'))).toBe('d3');
    expect(boardDay(gappy, at('2026-08-01'))).toBe('d3');
    expect(boardDay({ ...roastPlan, days: [] }, at('2026-07-12'))).toBe('');
  });

  it('two-day fixture still maps wed/thu', () => {
    expect(boardDay(fixturePlan, thu('12:00'))).toBe('thu');
    expect(boardDay(fixturePlan, wed('12:00'))).toBe('wed');
  });
});

describe('devices come from plan.devices', () => {
  it('the board has exactly the plan devices, in order, with °C settings', () => {
    const b = getBoard(roastPlan, occs, s0, sun('12:10'));
    expect(b.map((d) => d.device)).toEqual(['oven', 'air-fryer']);
    expect(deviceIds(roastPlan)).toEqual(['oven', 'air-fryer']);
    expect(b[0]).toMatchObject({ setting: 200, items: [{ id: 'chicken', label: 'Chicken', since: sun('11:15'), until: sun('12:45') }] });
    expect(b[1]).toMatchObject({ setting: 180, items: [{ id: 'potatoes', label: 'Potatoes', since: sun('12:00'), until: sun('12:45') }] });
    // next for the air fryer is the equipment-tagged shake.
    expect(b[1].next?.occ.occId).toBe('r-shake@12:15');
    const after = getBoard(roastPlan, occs, s0, sun('12:50'));
    expect(after.map((d) => d.setting)).toEqual(['OFF', 'OFF']);
  });

  it('spans: one entry per plan day, labels in the plan unit', () => {
    const all = getAllSpans(roastPlan, occs);
    expect(Object.keys(all)).toEqual(['sun']);
    expect(all.sun.filter((s) => s.kind === 'setting').map((s) => [s.device, s.label, s.start, s.end])).toEqual([
      ['oven', '200°C', sun('11:00'), sun('12:45')],
      ['air-fryer', '180°C', sun('12:00'), sun('12:45')],
    ]);
    expect(all.sun).toEqual(getDaySpans(roastPlan, occs, 'sun'));
    expect(Object.keys(getAllSpans(fixturePlan, occsFor(s0)))).toEqual(['wed', 'thu']);
    // A day without tasks still has an (empty) entry.
    const withExtraDay: Plan = { ...roastPlan, days: [...roastPlan.days, { id: 'mon', date: '2026-07-13', label: 'Mon' }] };
    expect(getAllSpans(withExtraDay, occs).mon).toEqual([]);
  });

  it('lanes: device actions, else equipment tags that are plan devices', () => {
    const shake = roastPlan.tasks.find((t) => t.id === 'r-shake')!;
    expect(lanesOf(shake, roastPlan)).toEqual(['air-fryer']); // 'counter' is not a device
    expect(lanesOf(shake, ['oven'])).toEqual([]);
    expect(inLane(shake, 'air-fryer')).toBe(true);
    expect(lanesOf(roastPlan.tasks.find((t) => t.id === 'r-1245')!, roastPlan)).toEqual(['oven', 'air-fryer']);
    expect(lanesOf(roastPlan.tasks.find((t) => t.id === 'r-1250')!, roastPlan)).toEqual([]);
  });
});

describe('running late on a custom device lane', () => {
  it('"Air fryer +10" moves only air-fryer tasks', () => {
    const now = sun('12:05');
    const scope = { kind: 'lane' as const, lane: 'air-fryer' };
    const rec = planShift(shiftCandidates(roastPlan, occs, now, scope), s0, now, 10, scope, 'Fryer +10');
    // r-1200 is alerting at 12:05 (not done) so it is remaining too.
    expect(Object.keys(rec.deltas).sort()).toEqual(['r-1200', 'r-1245', 'r-shake@12:15', 'r-shake@12:20']);
    const s = dayReducer(s0, { type: 'applyShift', record: rec });
    expect(occById(occsFor(s, roastPlan), 'r-1115').time).toBe(sun('11:15'));
    expect(occById(occsFor(s, roastPlan), 'r-shake@12:20').time).toBe(sun('12:30'));
  });
});

describe('alerts and now/next on the generic plan', () => {
  it('a 60x-style pass fires every modal occurrence once and never the quiet one', () => {
    let s: DayState = s0;
    const seen = new Map<string, number>();
    for (let t = sun('10:30'); t <= sun('13:30'); t += 15_000) {
      const stack = getActiveAlerts(occs, s, t, true);
      for (const a of stack) if (!seen.has(a.firingId)) seen.set(a.firingId, t);
      const front = stack[0];
      if (front)
        s =
          front.type === 'main'
            ? dayReducer(s, { type: 'done', occId: front.occ.occId, at: t })
            : dayReducer(s, { type: 'ackHeadsUp', occId: front.occ.occId, forTime: front.occ.time });
    }
    const mains = [...seen.keys()].filter((k) => k.includes('#main')).map((k) => k.split('#')[0]).sort();
    expect(mains).toEqual(occs.filter((o) => o.task.alert !== 'quiet').map((o) => o.occId).sort());
    const heads = [...seen.keys()].filter((k) => k.includes('#heads')).map((k) => k.split('#')[0]).sort();
    expect(heads).toEqual(['r-1100', 'r-1115', 'r-1200', 'r-1245']);
    expect(getActiveAlerts(occs, s, sun('13:30'), true)).toEqual([]);
    expect(statusOf(occById(occs, 'r-1250'), s, sun('13:30'))).toBe('missed'); // quiet, window passed
  });

  it('now/next', () => {
    const nn = getNowNext(roastPlan, occs, s0, sun('12:16'));
    expect(nn.lastStarted?.occId).toBe('r-shake@12:15');
    expect(nn.next?.occId).toBe('r-shake@12:20');
    expect(nn.nextInMs).toBe(4 * MIN);
  });
});

describe('optional plan arrays are treated as empty', () => {
  it('variants / fallbacks absent', () => {
    expect(roastPlan.variants).toBeUndefined();
    expect(resolveTasks(roastPlan, ['anything'])).toEqual(roastPlan.tasks);
    expect(alignVariantAnchors(roastPlan, s0, 'anything', 1).deltas).toEqual({});
    expect(buildOccurrences(roastPlan, resolveTasks(roastPlan, []), {})).toHaveLength(roastPlan.tasks.length + 1);
  });

  it('test-mode cutoffs come from plan.days (30 min before each day\'s first task)', () => {
    expect(testModeCutoffs(roastPlan)).toEqual([sun('10:30')]);
    expect(testModeCutoffs(fixturePlan)).toEqual([wed('08:30'), thu('08:15')]);
    expect(testModeCutoffs({ ...roastPlan, days: [...roastPlan.days, { id: 'mon', date: '2026-07-13', label: '' }] })).toEqual([sun('10:30')]);
  });
});

describe('variant override null removes a field', () => {
  it('"headsUpMin": null in an override unsets it', () => {
    const p: Plan = {
      ...roastPlan,
      variants: [{ id: 'v', label: 'v', override: { 'r-1100': { headsUpMin: null as unknown as undefined, title: 'Oven on' } } }],
    };
    const t = resolveTasks(p, ['v']).find((x) => x.id === 'r-1100')!;
    expect(t.title).toBe('Oven on');
    expect('headsUpMin' in t).toBe(false);
    expect(t.devices).toEqual(roastPlan.tasks[0].devices);
  });
});
