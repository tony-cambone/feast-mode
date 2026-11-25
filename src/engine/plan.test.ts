import { describe, expect, it } from 'vitest';
import type { Plan, Task } from '../data/types';
import { buildOccurrences, lanesOf, resolveTasks, testModeCutoffs, touchedEquipment } from './plan';
import { MIN, fixturePlan, occById, thu, wed } from './testFixture';

describe('resolveTasks (variants)', () => {
  it('returns plan tasks when no variant is active', () => {
    expect(resolveTasks(fixturePlan, [])).toEqual(fixturePlan.tasks);
    expect(resolveTasks(fixturePlan, ['nope'])).toEqual(fixturePlan.tasks);
  });

  it('applies remove, add and override without mutating the plan', () => {
    const before = JSON.stringify(fixturePlan);
    const tasks = resolveTasks(fixturePlan, ['late']);
    const ids = tasks.map((t) => t.id);
    expect(ids).not.toContain('t-1105');
    expect(ids).toContain('t-1230-fb');
    const t1200 = tasks.find((t) => t.id === 't-1200')!;
    expect(t1200.title).toBe('Turkey stays in');
    expect(t1200.devices).toEqual([]);
    expect(t1200.headsUpMin).toBeUndefined();
    expect(t1200.time).toBe('12:00'); // untouched fields survive
    expect(ids.indexOf('t-1200')).toBe(fixturePlan.tasks.findIndex((t) => t.id === 't-1200') - 1); // in place (one removed before it)
    expect(JSON.stringify(fixturePlan)).toBe(before);
  });
});

describe('buildOccurrences', () => {
  const occs = buildOccurrences(fixturePlan, fixturePlan.tasks, {});

  it('expands repeats from time to repeatUntil inclusive with @HH:MM ids', () => {
    const stirs = occs.filter((o) => o.task.id === 't-stir');
    expect(stirs.map((o) => o.occId)).toEqual(['t-stir@11:30', 't-stir@12:00', 't-stir@12:30']);
    expect(stirs.map((o) => o.time)).toEqual([thu('11:30'), thu('12:00'), thu('12:30')]);
  });

  it('single tasks use the task id; times come from plan dates in NY time', () => {
    const o = occById(occs, 'w-1000');
    expect(o.day).toBe('wed');
    expect(o.baseTime).toBe(wed('10:00'));
    expect(o.time).toBe(o.baseTime);
    expect(o.shiftMin).toBe(0);
  });

  it('sorts by (time, plan order)', () => {
    for (let i = 1; i < occs.length; i++) {
      const a = occs[i - 1];
      const b = occs[i];
      expect(a.time < b.time || (a.time === b.time && a.order < b.order)).toBe(true);
    }
    // 12:00 tie: the stir repeat (plan index 11) sorts before t-1200 (index 12).
    const at1200 = occs.filter((o) => o.time === thu('12:00')).map((o) => o.occId);
    expect(at1200).toEqual(['t-stir@12:00', 't-1200']);
  });

  it('applies shifts per occurrence id and re-sorts', () => {
    const shifted = buildOccurrences(fixturePlan, fixturePlan.tasks, { 't-stir@12:00': 15, 't-1000': -10 });
    const s = occById(shifted, 't-stir@12:00');
    expect(s.baseTime).toBe(thu('12:00'));
    expect(s.shiftMin).toBe(15);
    expect(s.time).toBe(thu('12:15'));
    expect(occById(shifted, 't-stir@11:30').time).toBe(thu('11:30'));
    expect(occById(shifted, 't-stir@12:30').time).toBe(thu('12:30'));
    expect(occById(shifted, 't-1000').time).toBe(thu('09:50'));
    const idx = (id: string) => shifted.findIndex((o) => o.occId === id);
    expect(idx('t-1200')).toBeLessThan(idx('t-stir@12:00'));
    expect(occById(shifted, 't-1000').time - occById(shifted, 't-0915').time).toBe(35 * MIN);
  });

  it('skips tasks with malformed times instead of producing NaN', () => {
    const bad: Plan = { ...fixturePlan, tasks: [...fixturePlan.tasks, { id: 'x', day: 'thu', time: 'soon', title: 'x' } as Task] };
    const o = buildOccurrences(bad, bad.tasks, {});
    expect(o.some((x) => x.occId === 'x')).toBe(false);
    expect(o.every((x) => Number.isFinite(x.time))).toBe(true);
  });

  it('a repeat without repeatUntil is a single occurrence', () => {
    const t: Task = { id: 'r', day: 'thu', time: '10:00', title: 'r', repeatEveryMin: 30 };
    expect(buildOccurrences(fixturePlan, [t], {}).map((o) => o.occId)).toEqual(['r']);
  });
});

describe('lanesOf (running-late lanes)', () => {
  it('a task with devices is in exactly those device lanes, whatever its equipment tags say', () => {
    const t: Task = {
      id: 'a', day: 'thu', time: '12:55', title: 'a',
      equipment: ['traeger', 'none', 'counter'],
      devices: [{ device: 'oven', set: 350 }, { device: 'grill', set: 'OFF' }, { device: 'oven', load: [] }],
    };
    expect(lanesOf(t, fixturePlan)).toEqual(['oven', 'grill']);
    // "Turkey into oven · baste the Traeger bird" is NOT in the Traeger lane.
    expect(lanesOf(fixturePlan.tasks.find((x) => x.id === 't-1015')!, fixturePlan)).toEqual(['oven']);
    // An empty device list (a variant that strips the actions) falls back to the equipment tags.
    expect(lanesOf({ id: 'c', day: 'thu', time: '12:00', title: 'c', equipment: ['oven', 'traeger'], devices: [] }, fixturePlan)).toEqual(['oven', 'traeger']);
  });

  it('without devices: equipment filtered to cooking devices', () => {
    expect(lanesOf({ id: 'b', day: 'thu', time: '10:00', title: 'b', equipment: ['counter', 'traeger', 'fridge', 'none', 'traeger'] }, fixturePlan)).toEqual(['traeger']);
    expect(lanesOf({ id: 'b', day: 'thu', time: '10:00', title: 'b', equipment: ['counter'] }, fixturePlan)).toEqual([]);
    expect(lanesOf({ id: 'b', day: 'thu', time: '10:00', title: 'b' }, fixturePlan)).toEqual([]);
    expect(lanesOf(fixturePlan.tasks.find((x) => x.id === 't-1105')!, fixturePlan)).toEqual(['oven']);
  });

  it('touchedEquipment (board display) still includes every tag', () => {
    const t = fixturePlan.tasks.find((x) => x.id === 't-1015')!;
    expect(touchedEquipment(t)).toEqual(['oven', 'traeger']);
  });
});

describe('testModeCutoffs', () => {
  it('30 min before the first task of each plan day, sorted', () => {
    expect(testModeCutoffs(fixturePlan)).toEqual([wed('08:30'), thu('08:15')]);
  });
});
