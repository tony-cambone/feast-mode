import { describe, expect, it } from 'vitest';
import { plan, bundledPlans } from './plan';
import { validatePlan } from './validate';
import type { BoardDevice, Day, DeviceSetting, PlanVariant, Task } from './types';

const BOARD_DEVICES: BoardDevice[] = plan.devices.map((d) => d.id);

const WED_IDS = [
  'wed-0900', 'wed-0915', 'wed-0930', 'wed-0945', 'wed-1000', 'wed-1010', 'wed-1045', 'wed-1100',
  'wed-1125', 'wed-1215', 'wed-1230', 'wed-1300', 'wed-1315', 'wed-1400', 'wed-1500', 'wed-1530',
  'wed-1600', 'wed-1700', 'wed-2100',
];
const THU_IDS = [
  'thu-0700', 'thu-0800', 'thu-0830', 'thu-0845', 'thu-0915', 'thu-0945', 'thu-1000', 'thu-1015',
  'thu-1100', 'thu-1105', 'thu-1115', 'thu-1130', 'thu-potato-stir', 'thu-1145', 'thu-1200',
  'thu-1215', 'thu-1220', 'thu-1225', 'thu-1235', 'thu-1245', 'thu-1255', 'thu-1255-grill', 'thu-1300', 'thu-1310',
  'thu-1320', 'thu-1335', 'thu-1345', 'thu-1400', 'thu-1500',
];

const mins = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const byDay = (tasks: Task[], day: Day) => tasks.filter((t) => t.day === day);
const hasLoadOrUnload = (t: Task) =>
  (t.devices ?? []).some((d) => (d.load && d.load.length > 0) || d.unload !== undefined);

function applyVariant(tasks: Task[], v: PlanVariant): Task[] {
  const removed = new Set(v.remove ?? []);
  const out = tasks
    .filter((t) => !removed.has(t.id))
    .map((t) => (v.override?.[t.id] ? ({ ...t, ...v.override[t.id] } as Task) : t));
  return [...out, ...(v.add ?? [])];
}
const sortStable = (tasks: Task[]) =>
  tasks.map((t, i) => ({ t, i })).sort((a, b) => mins(a.t.time) - mins(b.t.time) || a.i - b.i).map((x) => x.t);

/** Replay set actions for a day; returns state after the last task and a state-at(time) fn. */
function replay(tasks: Task[], day: Day) {
  const state = {} as Record<BoardDevice, DeviceSetting | null>;
  for (const d of BOARD_DEVICES) state[d] = 'OFF';
  const steps = sortStable(byDay(tasks, day));
  const at = (time: string) => {
    const s = {} as Record<BoardDevice, DeviceSetting>;
    for (const d of BOARD_DEVICES) s[d] = 'OFF';
    for (const t of steps) {
      if (mins(t.time) > mins(time)) break;
      for (const a of t.devices ?? []) if (a.set !== undefined) s[a.device] = a.set;
    }
    return s;
  };
  return { at, end: at('23:59') };
}

describe('plan structure', () => {
  it('has basics', () => {
    expect(plan.title).toBe('Thanksgiving 2026');
    expect(plan.id).toBe('thanksgiving-2026');
    expect(plan.emoji).toBe('🦃');
    expect(plan.timeZone).toBe('America/New_York');
    expect(plan.tempUnit).toBe('F');
    expect(plan.days).toEqual([
      { id: 'wed', date: '2026-11-25', label: 'Wed 11/25 · Prep' },
      { id: 'thu', date: '2026-11-26', label: 'Thu 11/26 · Cook' },
    ]);
    expect(plan.devices.map((d) => d.id)).toEqual(['oven', 'traeger', 'grill', 'slowcooker', 'stove']);
    expect(plan.devices.find((d) => d.id === 'grill')).toMatchObject({ label: 'Propane grill', short: 'Grill' });
  });

  it('has the exact spec rows per day', () => {
    expect(byDay(plan.tasks, 'wed').map((t) => t.id)).toEqual(WED_IDS);
    expect(byDay(plan.tasks, 'thu').map((t) => t.id)).toEqual(THU_IDS);
  });

  it('has unique task ids and unique LoadItem ids', () => {
    const ids = [...plan.tasks.map((t) => t.id), ...(plan.variants ?? []).flatMap((v) => (v.add ?? []).map((t) => t.id))];
    expect(new Set(ids).size).toBe(ids.length);
    const items = [...plan.tasks, ...(plan.variants ?? []).flatMap((v) => v.add ?? [])]
      .flatMap((t) => t.devices ?? [])
      .flatMap((d) => d.load ?? [])
      .map((l) => l.id);
    expect(new Set(items).size).toBe(items.length);
  });

  it('has valid HH:MM times and non-decreasing order within each day', () => {
    const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const t of plan.tasks) {
      expect(t.time, t.id).toMatch(valid);
      if (t.repeatUntil) expect(t.repeatUntil, t.id).toMatch(valid);
      expect(t.id.startsWith(t.day + '-'), t.id).toBe(true);
    }
    for (const v of plan.variants ?? []) for (const t of v.add ?? []) expect(t.time).toMatch(valid);
    for (const day of ['wed', 'thu'] as Day[]) {
      const times = byDay(plan.tasks, day).map((t) => mins(t.time));
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });

  it('models the potato stir as one repeating task', () => {
    const t = plan.tasks.find((x) => x.id === 'thu-potato-stir')!;
    expect(t).toMatchObject({ time: '11:30', repeatEveryMin: 30, repeatUntil: '13:30', critical: false, alert: 'modal' });
  });

  it('applies the alert-level rules', () => {
    for (const t of byDay(plan.tasks, 'thu')) {
      const quiet = ['thu-1105', 'thu-1115', 'thu-1215', 'thu-potato-stir'].includes(t.id);
      expect(t.critical, t.id).toBe(!quiet);
      expect(t.alert ?? 'modal', t.id).toBe('modal');
    }
    for (const t of byDay(plan.tasks, 'wed')) {
      expect(t.critical, t.id).toBe(['wed-0900', 'wed-1700', 'wed-2100'].includes(t.id));
      expect(t.alert ?? 'modal', t.id).toBe(t.id === 'wed-1315' ? 'quiet' : 'modal');
    }
  });

  it('gives every Thursday load/unload task (and 10:00, 12:20) a 5 min heads-up', () => {
    for (const t of byDay(plan.tasks, 'thu')) {
      if (hasLoadOrUnload(t) || t.id === 'thu-1000' || t.id === 'thu-1220') {
        expect(t.headsUpMin, t.id).toBe(5);
      }
    }
    for (const v of plan.variants ?? [])
      for (const t of v.add ?? []) if (hasLoadOrUnload(t)) expect(t.headsUpMin, t.id).toBe(5);
  });

  it('has 11 recipes with content', () => {
    expect(plan.recipes.map((r) => r.id).sort()).toEqual(
      ['cranberry', 'gravy', 'green-beans', 'herb-butter', 'mashed', 'mushrooms', 'quiche', 'shrimp', 'stuffing', 'sweet-potato', 'turkeys'],
    );
    for (const r of plan.recipes) {
      expect(r.name).toBeTruthy();
      expect(r.ingredients.length, r.id).toBeGreaterThan(0);
      expect(r.steps.length, r.id).toBeGreaterThan(0);
    }
  });

  it('has probe targets and a setup checklist', () => {
    expect((plan.probeTargets ?? []).map((p) => [p.label, p.temp])).toEqual([
      ['Turkey breast', 160], ['Turkey thigh', 175], ['Stuffing center', 165],
    ]);
    expect(plan.setupChecklist ?? []).toHaveLength(4);
  });
});

describe('references resolve', () => {
  const allTasks = [...plan.tasks, ...(plan.variants ?? []).flatMap((v) => v.add ?? [])];
  const taskIds = new Set(plan.tasks.map((t) => t.id));
  const recipeIds = new Set(plan.recipes.map((r) => r.id));
  const fallbackIds = new Set((plan.fallbacks ?? []).map((f) => f.id));
  const variantIds = new Set((plan.variants ?? []).map((v) => v.id));

  it('recipeIds and fallbackIds on tasks', () => {
    for (const t of allTasks) {
      for (const r of t.recipeIds ?? []) expect(recipeIds.has(r), `${t.id}:${r}`).toBe(true);
      for (const f of t.fallbackIds ?? []) expect(fallbackIds.has(f), `${t.id}:${f}`).toBe(true);
    }
    for (const v of plan.variants ?? [])
      for (const [id, o] of Object.entries(v.override ?? {})) {
        expect(taskIds.has(id)).toBe(true);
        for (const r of o.recipeIds ?? []) expect(recipeIds.has(r)).toBe(true);
      }
    for (const v of plan.variants ?? []) for (const id of v.remove ?? []) expect(taskIds.has(id)).toBe(true);
  });

  it('fallback related ids and actions', () => {
    expect((plan.fallbacks ?? []).map((f) => f.id)).toEqual(['oven-turkey-late', 'traeger-slow', 'whole-bird']);
    for (const f of plan.fallbacks ?? []) {
      for (const id of f.relatedTaskIds) expect(taskIds.has(id), `${f.id}:${id}`).toBe(true);
      for (const a of f.actions) {
        if (a.kind === 'variant') expect(variantIds.has(a.variantId)).toBe(true);
        if (a.kind === 'shiftTasks') for (const id of a.taskIds) expect(taskIds.has(id)).toBe(true);
      }
    }
    // every fallback is linked from at least one task, and tasks link back to related fallbacks
    for (const f of plan.fallbacks ?? [])
      for (const id of f.relatedTaskIds)
        expect(plan.tasks.find((t) => t.id === id)!.fallbackIds ?? [], `${id}->${f.id}`).toContain(f.id);
  });

  it('variant added ids end in -fb and are unique vs base', () => {
    for (const v of plan.variants ?? [])
      for (const t of v.add ?? []) {
        expect(t.id.endsWith('-fb')).toBe(true);
        expect(taskIds.has(t.id)).toBe(false);
      }
  });
});

describe('devices', () => {
  it('no task has device actions on both oven and grill', () => {
    for (const t of [...plan.tasks, ...(plan.variants ?? []).flatMap((v) => v.add ?? [])]) {
      const ds = new Set((t.devices ?? []).map((d) => d.device));
      expect(ds.has('oven') && ds.has('grill'), t.id).toBe(false);
    }
  });

  it('variant anchors map added ids to existing tasks', () => {
    const base = new Set(plan.tasks.map((t) => t.id));
    for (const v of plan.variants ?? []) {
      const added = new Set((v.add ?? []).map((t) => t.id));
      for (const [a, b] of Object.entries(v.anchors ?? {})) {
        expect(added.has(a), a).toBe(true);
        expect(base.has(b), b).toBe(true);
      }
    }
    expect(Object.keys((plan.variants ?? [])[0].anchors ?? {}).sort()).toEqual(
      ['thu-1230-fb', 'thu-1250-fb', 'thu-1320-fb', 'thu-1345-fb'],
    );
  });

  it('every device ends each day OFF', () => {
    for (const day of ['wed', 'thu'] as Day[]) {
      const { end } = replay(plan.tasks, day);
      for (const d of BOARD_DEVICES) expect(end[d], `${day} ${d}`).toBe('OFF');
    }
  });

  it('every device ends Thursday OFF with the variant applied', () => {
    for (const v of plan.variants ?? []) {
      const tasks = applyVariant(plan.tasks, v);
      const { end } = replay(tasks, 'thu');
      for (const d of BOARD_DEVICES) expect(end[d], `${v.id} ${d}`).toBe('OFF');
      // oven turkey stays in and Traeger runs at 350 for the stuffing in the variant
      expect(replay(tasks, 'thu').at('12:00').oven).toBe(425);
      expect(replay(tasks, 'thu').at('12:40').oven).toBe(350);
      expect(replay(tasks, 'thu').at('12:46').traeger).toBe(350);
      expect(replay(tasks, 'thu').at('13:44').traeger).toBe(350);
      expect(tasks.some((t) => t.id === 'thu-1225')).toBe(false);
    }
  });

  it('unload ids refer to previously loaded items', () => {
    const loaded = new Set<string>();
    for (const t of sortStable(plan.tasks)) {
      for (const a of t.devices ?? []) {
        if (Array.isArray(a.unload)) for (const id of a.unload) expect(loaded.has(id), `${t.id}:${id}`).toBe(true);
        for (const l of a.load ?? []) loaded.add(l.id);
      }
    }
  });

  it('matches the board facts from the equipment table (Thursday)', () => {
    const { at } = replay(plan.tasks, 'thu');
    expect(at('10:00').oven).toBe(425);
    expect(at('10:10')).toMatchObject({ oven: 425, traeger: 325, grill: 'OFF', slowcooker: 'OFF' });
    expect(at('12:00').oven).toBe(375);
    expect(at('12:10')).toMatchObject({ oven: 375, traeger: 325, grill: 'OFF', slowcooker: 'LOW' });
    expect(at('12:40')).toMatchObject({ oven: 375, traeger: 325, grill: 375, slowcooker: 'LOW' });
    expect(at('12:55').oven).toBe(350);
    expect(at('13:00')).toMatchObject({ oven: 350, traeger: 'OFF', grill: 'OFF', slowcooker: 'LOW' });
    expect(at('08:45').traeger).toBe(325);
    expect(at('08:44').traeger).toBe('OFF');
    expect(at('12:44').traeger).toBe(325);
    expect(at('12:45').traeger).toBe('OFF');
    expect(at('12:20').grill).toBe(375);
    expect(at('12:55').grill).toBe('OFF');
    expect(at('11:00').slowcooker).toBe('LOW');
    expect(at('13:44').slowcooker).toBe('LOW');
    expect(at('13:45').slowcooker).toBe('OFF');
    expect(at('13:35').oven).toBe('OFF');
  });

  it('Wednesday oven steps', () => {
    const { at } = replay(plan.tasks, 'wed');
    expect(at('09:30').oven).toBe(400);
    expect(at('10:45').oven).toBe(375);
    expect(at('11:25').oven).toBe(350);
    expect(at('12:15').oven).toBe('OFF');
  });
});

describe('bundled plans', () => {
  it('ships thanksgiving-2026 and christmas-dinner, both with zero errors', () => {
    expect(bundledPlans.map((p) => p.id)).toEqual(['thanksgiving-2026', 'christmas-dinner']);
    for (const p of bundledPlans) expect(validatePlan(p).ok, p.id).toBe(true);
  });

  it('christmas-dinner has zero warnings and the expected shape', () => {
    const xmas = bundledPlans.find((p) => p.id === 'christmas-dinner')!;
    const r = validatePlan(xmas);
    expect(r.warnings).toEqual([]);
    expect(xmas.timeZone).toBe('America/Chicago');
    expect(xmas.tempUnit).toBe('F');
    expect(xmas.emoji).toBe('🎄');
    expect(xmas.theme?.accent).toBeTruthy();
    expect(xmas.days.map((d) => d.id)).toEqual(['eve', 'day']);
    expect(xmas.devices.map((d) => d.id)).toEqual(['oven', 'stove', 'slowcooker']);
    expect(xmas.subtitle?.toLowerCase()).toContain('example');
    expect(xmas.tasks.length).toBeGreaterThanOrEqual(18);
    expect(xmas.tasks.length).toBeLessThanOrEqual(22);
    expect(xmas.recipes.length).toBeGreaterThanOrEqual(5);
    expect(xmas.recipes.length).toBeLessThanOrEqual(6);
    expect((xmas.fallbacks ?? []).length).toBe(1);
    expect(xmas.tasks.find((t) => t.id === 'day-1600')?.time).toBe('16:00');
    expect((xmas.probeTargets ?? []).length).toBeGreaterThan(0);
  });

  it('thanksgiving loads with zero warnings', () => {
    const r = validatePlan(plan);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('the oven-turkey-late override of thu-1200 sets headsUpMin 0 (no heads-up)', () => {
    expect(plan.variants?.[0].override?.['thu-1200']?.headsUpMin).toBe(0);
  });
});
