import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validatePlan } from './validate';

type J = Record<string, any>;

/** A small valid plan to mutate. */
function base(): J {
  return {
    id: 'mini',
    title: 'Mini',
    timeZone: 'America/New_York',
    days: [{ id: 'd1', date: '2026-11-26', label: 'Day 1' }],
    devices: [{ id: 'oven', label: 'Oven' }],
    tasks: [
      { id: 'd1-1000', day: 'd1', time: '10:00', title: 'Oven on', recipeIds: ['r1'], devices: [{ device: 'oven', set: 350 }] },
      { id: 'd1-1010', day: 'd1', time: '10:10', title: 'In', headsUpMin: 5, devices: [{ device: 'oven', load: [{ id: 'x', label: 'Dish', forMin: 30 }] }] },
      { id: 'd1-1040', day: 'd1', time: '10:40', title: 'Out', headsUpMin: 5, devices: [{ device: 'oven', unload: ['x'], set: 'OFF' }] },
    ],
    recipes: [{ id: 'r1', name: 'R', ingredients: ['a'], steps: ['b'] }],
  };
}

function errorsOf(mut: (p: J) => void): string[] {
  const p = base();
  mut(p);
  const r = validatePlan(p);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors;
}
function warningsOf(mut: (p: J) => void): string[] {
  const p = base();
  mut(p);
  const r = validatePlan(p);
  expect(r.ok).toBe(true);
  return r.warnings;
}
const has = (list: string[], re: RegExp) => expect(list.some((m) => re.test(m)), list.join('\n')).toBe(true);

describe('validatePlan: happy path', () => {
  it('accepts a minimal plan and ignores $schema', () => {
    const p = { ...base(), $schema: './plan.schema.json' };
    const r = validatePlan(p);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});

describe('validatePlan: errors', () => {
  it('rejects a non-object', () => {
    for (const bad of [null, [], 'x', 3]) {
      const r = validatePlan(bad);
      expect(r.ok).toBe(false);
    }
  });
  it('missing required fields and wrong types', () => {
    has(errorsOf((p) => delete p.title), /^title: required/);
    has(errorsOf((p) => delete p.days), /^days: required/);
    has(errorsOf((p) => (p.tasks = 'nope')), /^tasks: required array/);
    has(errorsOf((p) => (p.tempUnit = 'K')), /tempUnit: must be "F" or "C"/);
    has(errorsOf((p) => delete p.tasks[0].title), /tasks\[0\] \(d1-1000\)\.title: required/);
    has(errorsOf((p) => (p.tasks[0].headsUpMin = -1)), /headsUpMin: must be a number of minutes, 0 or more/);
    expect(validatePlan({ ...base(), tasks: [{ ...base().tasks[0], headsUpMin: 0 }] }).ok).toBe(true);
    has(errorsOf((p) => (p.tasks[0].critical = 'yes')), /\.critical: must be true or false/);
  });
  it('duplicate ids', () => {
    has(errorsOf((p) => p.tasks.push({ ...p.tasks[0] })), /duplicate task id "d1-1000"/);
    has(errorsOf((p) => p.recipes.push({ ...p.recipes[0] })), /duplicate recipe id "r1"/);
    has(errorsOf((p) => p.days.push({ ...p.days[0] })), /duplicate day id "d1"/);
    has(errorsOf((p) => p.devices.push({ id: 'oven', label: 'Again' })), /duplicate device id "oven"/);
    has(errorsOf((p) => (p.tasks[1].devices[0].load[0].id = 'x') && p.tasks.push({ id: 'd1-1050', day: 'd1', time: '10:50', title: 'T', devices: [{ device: 'oven', load: [{ id: 'x', label: 'Dup' }] }] })), /load item id "x" is already used/);
    has(errorsOf((p) => (p.fallbacks = [{ id: 'f', title: 't', body: [], relatedTaskIds: [], actions: [] }, { id: 'f', title: 't', body: [], relatedTaskIds: [], actions: [] }])), /duplicate fallback id "f"/);
    has(errorsOf((p) => (p.variants = [{ id: 'v', label: 'a' }, { id: 'v', label: 'b' }])), /duplicate variant id "v"/);
  });
  it('bad day, time, date, zone', () => {
    has(errorsOf((p) => (p.tasks[0].day = 'zz')), /tasks\[0\] \(d1-1000\)\.day: "zz" is not a day id \(days: d1\)/);
    has(errorsOf((p) => (p.tasks[0].time = '25:00')), /\.time: "25:00" is not a valid 24-hour/);
    has(errorsOf((p) => (p.tasks[0].time = '9:00')), /\.time: "9:00" is not a valid/);
    has(errorsOf((p) => (p.days[0].date = '2026-02-30')), /days\[0\].*\.date: "2026-02-30" is not a valid/);
    has(errorsOf((p) => (p.days[0].date = '11/26/2026')), /\.date: "11\/26\/2026" is not a valid/);
    has(errorsOf((p) => (p.timeZone = 'Mars/Olympus')), /timeZone: "Mars\/Olympus" is not a valid IANA/);
  });
  it('unknown device id', () => {
    has(errorsOf((p) => (p.tasks[0].devices[0].device = 'ovn')), /tasks\[0\] \(d1-1000\)\.devices\[0\]\.device: "ovn" is not a device id \(devices: oven\)/);
  });
  it('dangling references', () => {
    has(errorsOf((p) => (p.tasks[0].recipeIds = ['nope'])), /recipeIds: "nope" is not a recipe id/);
    has(errorsOf((p) => (p.tasks[0].fallbackIds = ['nope'])), /fallbackIds: "nope" is not a fallback id/);
    has(errorsOf((p) => (p.fallbacks = [{ id: 'f', title: 't', body: ['b'], relatedTaskIds: ['ghost'], actions: [] }])), /relatedTaskIds: "ghost" is not a task id/);
    has(errorsOf((p) => (p.fallbacks = [{ id: 'f', title: 't', body: ['b'], relatedTaskIds: [], actions: [{ kind: 'variant', label: 'l', variantId: 'zz' }] }])), /variantId: "zz" is not a variant id/);
    has(errorsOf((p) => (p.fallbacks = [{ id: 'f', title: 't', body: ['b'], relatedTaskIds: [], actions: [{ kind: 'shiftTasks', label: 'l', taskIds: ['ghost'], minutes: 5 }] }])), /taskIds: "ghost" is not a task id/);
    has(errorsOf((p) => (p.fallbacks = [{ id: 'f', title: 't', body: ['b'], relatedTaskIds: [], actions: [{ kind: 'shiftLane', label: 'l', lane: 'grill', minutes: 5 }] }])), /lane: "grill" is not a device id/);
    has(errorsOf((p) => (p.variants = [{ id: 'v', label: 'V', override: { ghost: { title: 'x' } } }])), /override\["ghost"\]: "ghost" is not a task id/);
    has(errorsOf((p) => (p.variants = [{ id: 'v', label: 'V', remove: ['ghost'] }])), /remove: "ghost" is not a task id/);
  });
  it('anchors', () => {
    const add = { id: 'a-fb', day: 'd1', time: '10:20', title: 'Added' };
    has(errorsOf((p) => (p.variants = [{ id: 'v', label: 'V', add: [add], anchors: { 'a-fb': 'ghost' } }])), /anchors\["a-fb"\]: "ghost" is not a task id/);
    has(errorsOf((p) => (p.variants = [{ id: 'v', label: 'V', add: [add], anchors: { nope: 'd1-1000' } }])), /anchors\["nope"\]: key must be the id of a task in this variant's "add"/);
    const ok = validatePlan({ ...base(), variants: [{ id: 'v', label: 'V', add: [add], anchors: { 'a-fb': 'd1-1000' } }] });
    expect(ok.ok).toBe(true);
  });
  it('repeatUntil before time', () => {
    has(errorsOf((p) => Object.assign(p.tasks[0], { repeatEveryMin: 30, repeatUntil: '09:00' })), /repeatUntil: "09:00" is before the task time "10:00"/);
  });
  it('bad device action shapes', () => {
    has(errorsOf((p) => (p.tasks[0].devices[0].set = true)), /\.set: must be a number/);
    has(errorsOf((p) => (p.tasks[1].devices[0].load = [{ label: 'no id' }])), /load\[0\]: must be/);
    has(errorsOf((p) => (p.tasks[2].devices[0].unload = 5)), /unload: must be an array of strings/);
  });
  it('bad recipe lines', () => {
    has(errorsOf((p) => (p.recipes[0].steps = [3])), /recipes\[0\] \(r1\)\.steps\[0\]: must be a string/);
  });
});

describe('validatePlan: warnings', () => {
  it('device not OFF at the end of a day', () => {
    const w = warningsOf((p) => (p.tasks[2].devices[0].set = 200));
    has(w, /device "oven" is still 200 at the end of day "d1".*"set": "OFF"/);
  });
  it('device not OFF in a variant', () => {
    const w = warningsOf((p) => {
      p.variants = [{ id: 'v', label: 'V', override: { 'd1-1040': { devices: [{ device: 'oven', unload: 'all' }] } } }];
    });
    has(w, /variant "v": device "oven" is still 350/);
  });
  it('unload of an item never loaded', () => {
    has(warningsOf((p) => (p.tasks[2].devices[0].unload = ['ghost'])), /unloads "ghost" from oven, but nothing with that id is loaded/);
  });
  it('tasks out of time order', () => {
    has(warningsOf((p) => p.tasks.unshift(p.tasks.pop())), /earlier than the previous d1 task/);
  });
  it('load/unload without headsUpMin', () => {
    has(warningsOf((p) => delete p.tasks[1].headsUpMin), /tasks\[1\] \(d1-1010\): loads or unloads a device but has no headsUpMin/);
  });
  it('a day with no tasks', () => {
    has(warningsOf((p) => p.days.push({ id: 'd2', date: '2026-11-27', label: 'Day 2' })), /day "d2" has no tasks/);
  });
});

describe('docs/MENU_PROMPT.md example', () => {
  it('the last json block validates with zero warnings', () => {
    const md = readFileSync(new URL('../../docs/MENU_PROMPT.md', import.meta.url), 'utf8');
    const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)];
    expect(blocks.length).toBeGreaterThan(0);
    const r = validatePlan(JSON.parse(blocks[blocks.length - 1][1]));
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});
