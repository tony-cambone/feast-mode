/** Plan -> resolved tasks (variants applied) -> occurrences (repeats expanded, shifts applied). */
import type { BoardDevice, Equipment, Plan, Task } from '../data/types';
import type { Occurrence } from './types';
import { MINUTE_MS, minutesToHHMM, parseHHMM, zonedToEpoch } from './time';

const MAX_REPEATS = 500;

/**
 * Apply active variants (override/remove/add) to plan.tasks.
 * Variants apply in plan.variants order; within one variant: remove -> add -> override.
 * An override value of `null` removes that field from the task.
 * An added task whose id already exists replaces it in place. Unknown variant ids are ignored.
 */
export function resolveTasks(plan: Plan, activeVariants: string[]): Task[] {
  let tasks = plan.tasks.slice();
  if (!activeVariants || activeVariants.length === 0) return tasks;
  const active = new Set(activeVariants);
  for (const v of plan.variants ?? []) {
    if (!active.has(v.id)) continue;
    if (v.remove && v.remove.length) {
      const rm = new Set(v.remove);
      tasks = tasks.filter((t) => !rm.has(t.id));
    }
    for (const add of v.add ?? []) {
      const i = tasks.findIndex((t) => t.id === add.id);
      if (i >= 0) tasks[i] = add;
      else tasks.push(add);
    }
    if (v.override) {
      tasks = tasks.map((t) => {
        const o = v.override![t.id];
        if (!o) return t;
        // JSON has no `undefined`: an override value of null removes that field (e.g. "headsUpMin": null).
        const merged: Record<string, unknown> = { ...t, ...o, id: t.id };
        for (const [k, val] of Object.entries(o)) if (val === null) delete merged[k];
        return merged as unknown as Task;
      });
    }
  }
  return tasks;
}

/** True when the task expands into several occurrences (occIds then carry `@HH:MM`). */
export function isRepeating(task: Task): boolean {
  return (
    typeof task.repeatEveryMin === 'number' &&
    task.repeatEveryMin > 0 &&
    typeof task.repeatUntil === 'string' &&
    !Number.isNaN(parseHHMM(task.repeatUntil))
  );
}

/** Occurrence id for one repetition (base HH:MM). */
export function occIdFor(task: Task, baseHHMM: string): string {
  return isRepeating(task) ? `${task.id}@${baseHHMM}` : task.id;
}

/** Sort comparator: (time, order). */
export function byTimeThenOrder(a: Occurrence, b: Occurrence): number {
  return a.time - b.time || a.order - b.order;
}

/**
 * Expand repeats (time .. repeatUntil inclusive, every repeatEveryMin), compute base and
 * effective times with per-occurrence shifts, sort by (time, order). Tasks with a malformed
 * day/time are skipped (the data agent's plan test guards against that).
 */
export function buildOccurrences(plan: Plan, tasks: Task[], shifts: Record<string, number>): Occurrence[] {
  const out: Occurrence[] = [];
  const dateOf = dayDates(plan);
  tasks.forEach((task, taskIndex) => {
    const dateISO = dateOf.get(task.day);
    const start = parseHHMM(task.time);
    if (!dateISO || Number.isNaN(start)) return;
    const minutes: number[] = [];
    if (isRepeating(task)) {
      const until = parseHHMM(task.repeatUntil!);
      const every = task.repeatEveryMin!;
      for (let m = start; m <= until && minutes.length < MAX_REPEATS; m += every) minutes.push(m);
      if (minutes.length === 0) minutes.push(start);
    } else {
      minutes.push(start);
    }
    minutes.forEach((m, rep) => {
      const hhmm = minutesToHHMM(m);
      const baseTime = zonedToEpoch(dateISO, hhmm, plan.timeZone);
      if (Number.isNaN(baseTime)) return;
      const occId = occIdFor(task, hhmm);
      const raw = shifts?.[occId];
      const shiftMin = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
      out.push({
        occId,
        task,
        day: task.day,
        baseTime,
        shiftMin,
        time: baseTime + shiftMin * MINUTE_MS,
        order: taskIndex * 1000 + rep,
      });
    });
  });
  out.sort(byTimeThenOrder);
  return out;
}

/** Day id -> 'YYYY-MM-DD' for the plan's days. */
export function dayDates(plan: Plan): Map<string, string> {
  return new Map((plan.days ?? []).map((d) => [d.id, d.date]));
}

/** The plan's device ids, in board/lane order. */
export function deviceIds(plan: Pick<Plan, 'devices'>): BoardDevice[] {
  return (plan.devices ?? []).map((d) => d.id);
}

/**
 * "Running late" lane membership. A task with device actions belongs to exactly those devices'
 * lanes. A task without (absent or empty `devices`) uses its equipment tags that are device ids,
 * so 'fridge' / 'counter' tags never form lanes, and tags like ['oven', 'traeger'] on
 * "turkey in · baste the Traeger bird" (which has an oven action) do NOT put it in the Traeger lane.
 * Pass the plan (or its device ids).
 */
export function lanesOf(task: Task, planOrDeviceIds: Pick<Plan, 'devices'> | readonly BoardDevice[]): BoardDevice[] {
  const ids: readonly BoardDevice[] = Array.isArray(planOrDeviceIds)
    ? planOrDeviceIds
    : deviceIds(planOrDeviceIds as Pick<Plan, 'devices'>);
  const out: BoardDevice[] = [];
  const add = (e: Equipment) => {
    if (!out.includes(e)) out.push(e);
  };
  if (task.devices && task.devices.length > 0) for (const d of task.devices) add(d.device);
  else for (const e of task.equipment ?? []) if (ids.includes(e)) add(e);
  return out;
}

/**
 * Is the task in `lane` (a device id)? Same rule as lanesOf, without needing the device list:
 * an equipment tag equal to a device id is by definition a device tag.
 */
export function inLane(task: Task, lane: BoardDevice): boolean {
  if (task.devices && task.devices.length > 0) return task.devices.some((d) => d.device === lane);
  return (task.equipment ?? []).includes(lane);
}

/** Display-only: every device a task mentions (equipment[] ∪ devices[].device, 'none' excluded). Used by the board's `next`. */
export function touchedEquipment(task: Task): Equipment[] {
  const out: Equipment[] = [];
  const add = (e: Equipment) => {
    if (e !== 'none' && !out.includes(e)) out.push(e);
  };
  for (const e of task.equipment ?? []) add(e);
  for (const d of task.devices ?? []) add(d.device);
  return out;
}

/** Minutes before a plan day's first task at which a forgotten rehearsal hands back to the real clock. */
export const TEST_CUTOFF_LEAD_MIN = 30;

/**
 * Real-time cutoffs for test mode: for each of plan.days, 30 min before its first (base,
 * unshifted) task; days without tasks have none. Sorted. A test clock started before a cutoff is
 * switched back to the real clock once that cutoff passes.
 */
export function testModeCutoffs(plan: Plan): number[] {
  const out: number[] = [];
  for (const day of plan.days ?? []) {
    let first = Infinity;
    for (const t of plan.tasks ?? []) {
      if (t.day !== day.id) continue;
      const at = zonedToEpoch(day.date, t.time, plan.timeZone);
      if (Number.isFinite(at) && at < first) first = at;
    }
    if (Number.isFinite(first)) out.push(first - TEST_CUTOFF_LEAD_MIN * MINUTE_MS);
  }
  return out.sort((a, b) => a - b);
}

/** Lookup helper: occId -> occurrence. */
export function indexOccurrences(occs: Occurrence[]): Map<string, Occurrence> {
  const m = new Map<string, Occurrence>();
  for (const o of occs) m.set(o.occId, o);
  return m;
}
