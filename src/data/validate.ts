/**
 * PLAN VALIDATOR. Dependency-free and erasable-TypeScript only (only `import type`), so the CLI can
 * run it directly with Node's type stripping: `node scripts/check-plan.ts plans/my.json`.
 *
 * Errors block loading (the data is not a usable plan). Warnings still load: they flag plans that
 * will probably misbehave on the day (a device left on, a missing heads-up, tasks out of order).
 */
import type { Plan } from './types';

export type PlanValidation =
  | { ok: true; plan: Plan; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

type Obj = Record<string, unknown>;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const mins = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const q = (v: unknown): string => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v) ?? String(v));
const list = (xs: Iterable<string>): string => [...xs].join(', ') || '(none)';

function validDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function validZone(z: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

interface Ctx {
  errors: string[];
  dayIds: Set<string>;
  deviceIds: Set<string>;
  recipeIds: Set<string>;
  fallbackIds: Set<string>;
  variantIds: Set<string>;
  taskIds: Set<string>;
}

function taskLabel(path: string, t: unknown): string {
  return isObj(t) && isNonEmpty(t.id) ? `${path} (${t.id})` : path;
}

/** Validate an array-of-strings field. */
function strArray(ctx: Ctx, v: unknown, where: string): v is string[] {
  if (!Array.isArray(v) || v.some((x) => !isStr(x))) {
    ctx.errors.push(`${where}: must be an array of strings, got ${q(v)}. Example: ["a", "b"].`);
    return false;
  }
  return true;
}

function checkDeviceActions(ctx: Ctx, v: unknown, where: string, loadIds: Map<string, string> | null): void {
  if (!Array.isArray(v)) {
    ctx.errors.push(`${where}.devices: must be an array of device actions like {"device": "oven", "set": 350}.`);
    return;
  }
  v.forEach((a, i) => {
    const w = `${where}.devices[${i}]`;
    if (!isObj(a)) {
      ctx.errors.push(`${w}: must be an object like {"device": "oven", "set": 350, "load": [...]}.`);
      return;
    }
    if (!isStr(a.device) || !ctx.deviceIds.has(a.device)) {
      ctx.errors.push(
        `${w}.device: ${q(a.device)} is not a device id (devices: ${list(ctx.deviceIds)}). Add it to the top-level "devices" list or fix the spelling.`,
      );
    }
    if (a.set !== undefined && !(isNum(a.set) || isNonEmpty(a.set))) {
      ctx.errors.push(`${w}.set: must be a number (temperature) or a non-empty string such as "LOW" or "OFF", got ${q(a.set)}.`);
    }
    if (a.unload !== undefined && a.unload !== 'all') {
      if (!strArray(ctx, a.unload, `${w}.unload`)) {
        /* reported */
      }
    }
    if (a.load !== undefined) {
      if (!Array.isArray(a.load)) {
        ctx.errors.push(`${w}.load: must be an array of {"id", "label", "forMin"?} items.`);
      } else {
        a.load.forEach((l, j) => {
          const lw = `${w}.load[${j}]`;
          if (!isObj(l) || !isNonEmpty(l.id) || !isNonEmpty(l.label)) {
            ctx.errors.push(`${lw}: must be {"id": "unique-id", "label": "short name", "forMin": 30}; "id" and "label" are required.`);
            return;
          }
          if (l.forMin !== undefined && !(isNum(l.forMin) && l.forMin > 0)) {
            ctx.errors.push(`${lw}.forMin: must be a positive number of minutes, got ${q(l.forMin)}.`);
          }
          if (loadIds) {
            const prev = loadIds.get(l.id);
            if (prev) ctx.errors.push(`${lw}: load item id "${l.id}" is already used at ${prev}. Load item ids must be unique across the plan; rename one.`);
            else loadIds.set(l.id, lw);
          }
        });
      }
    }
  });
}

/**
 * Validate the fields of a task. `partial` = variant override (no id/day/time/title required).
 */
function checkTaskFields(ctx: Ctx, t: Obj, where: string, partial: boolean, loadIds: Map<string, string> | null): void {
  const req = (key: string) => {
    if (!partial && t[key] === undefined) ctx.errors.push(`${where}.${key}: required field is missing.`);
  };
  if (!partial) {
    if (!isNonEmpty(t.id)) ctx.errors.push(`${where}.id: required, a non-empty string like "thu-1200".`);
  }
  req('day');
  if (t.day !== undefined && (!isStr(t.day) || !ctx.dayIds.has(t.day))) {
    ctx.errors.push(`${where}.day: ${q(t.day)} is not a day id (days: ${list(ctx.dayIds)}). Use one of the ids from the top-level "days" list.`);
  }
  req('time');
  if (t.time !== undefined && (!isStr(t.time) || !TIME_RE.test(t.time))) {
    ctx.errors.push(`${where}.time: ${q(t.time)} is not a valid 24-hour "HH:MM" time (e.g. "07:05", "13:30").`);
  }
  req('title');
  if (t.title !== undefined && !isNonEmpty(t.title)) ctx.errors.push(`${where}.title: must be a non-empty string.`);
  if (t.details !== undefined && !isStr(t.details)) ctx.errors.push(`${where}.details: must be a string.`);
  if (t.equipment !== undefined) strArray(ctx, t.equipment, `${where}.equipment`);
  if (t.devices !== undefined) checkDeviceActions(ctx, t.devices, where, loadIds);
  if (t.recipeIds !== undefined && strArray(ctx, t.recipeIds, `${where}.recipeIds`)) {
    for (const r of t.recipeIds) {
      if (!ctx.recipeIds.has(r)) ctx.errors.push(`${where}.recipeIds: "${r}" is not a recipe id (recipes: ${list(ctx.recipeIds)}). Fix the id or add the recipe.`);
    }
  }
  if (t.fallbackIds !== undefined && strArray(ctx, t.fallbackIds, `${where}.fallbackIds`)) {
    for (const f of t.fallbackIds) {
      if (!ctx.fallbackIds.has(f)) ctx.errors.push(`${where}.fallbackIds: "${f}" is not a fallback id (fallbacks: ${list(ctx.fallbackIds)}). Fix the id or add the fallback.`);
    }
  }
  if (t.alert !== undefined && t.alert !== 'modal' && t.alert !== 'quiet') {
    ctx.errors.push(`${where}.alert: must be "modal" or "quiet", got ${q(t.alert)}.`);
  }
  if (t.headsUpMin !== undefined && !(isNum(t.headsUpMin) && t.headsUpMin >= 0)) {
    ctx.errors.push(`${where}.headsUpMin: must be a number of minutes, 0 or more (use 5; 0 means no heads-up), got ${q(t.headsUpMin)}.`);
  }
  if (t.critical !== undefined && typeof t.critical !== 'boolean') {
    ctx.errors.push(`${where}.critical: must be true or false, got ${q(t.critical)}.`);
  }
  if (t.repeatEveryMin !== undefined && !(isNum(t.repeatEveryMin) && t.repeatEveryMin > 0)) {
    ctx.errors.push(`${where}.repeatEveryMin: must be a positive number of minutes, got ${q(t.repeatEveryMin)}.`);
  }
  if (t.repeatUntil !== undefined) {
    if (!isStr(t.repeatUntil) || !TIME_RE.test(t.repeatUntil)) {
      ctx.errors.push(`${where}.repeatUntil: ${q(t.repeatUntil)} is not a valid 24-hour "HH:MM" time.`);
    } else if (isStr(t.time) && TIME_RE.test(t.time) && mins(t.repeatUntil) < mins(t.time)) {
      ctx.errors.push(`${where}.repeatUntil: "${t.repeatUntil}" is before the task time "${t.time}". Set repeatUntil to a later time.`);
    }
  }
}

/** Keys that exist on a Task; override keys outside this set are reported. */
const TASK_KEYS = new Set([
  'id', 'day', 'time', 'title', 'details', 'equipment', 'devices', 'recipeIds', 'fallbackIds',
  'alert', 'headsUpMin', 'critical', 'repeatEveryMin', 'repeatUntil',
]);

function checkRecipeLines(ctx: Ctx, v: unknown, where: string, required: boolean): void {
  if (v === undefined) {
    if (required) ctx.errors.push(`${where}: required array is missing. Use text lines and {"heading": "..."} sub-headings.`);
    return;
  }
  if (!Array.isArray(v)) {
    ctx.errors.push(`${where}: must be an array of strings or {"heading": "..."} objects.`);
    return;
  }
  v.forEach((l, i) => {
    const ok = isStr(l) || (isObj(l) && isNonEmpty(l.heading));
    if (!ok) ctx.errors.push(`${where}[${i}]: must be a string or {"heading": "..."}, got ${q(l)}.`);
  });
}

function addDup(ctx: Ctx, seen: Set<string>, id: string, where: string, kind: string): void {
  if (seen.has(id)) ctx.errors.push(`${where}: duplicate ${kind} id "${id}". Ids must be unique; rename one.`);
  seen.add(id);
}

/* ------------------------------------------------------------------ replay (warnings) */

interface ReplayTask {
  id: string;
  day: string;
  time: string;
  devices?: Array<{ device: string; set?: unknown; load?: Array<{ id: string }>; unload?: string[] | 'all' }>;
}

function applyVariant(tasks: ReplayTask[], v: Obj): ReplayTask[] {
  const removed = new Set(Array.isArray(v.remove) ? (v.remove as string[]) : []);
  const override = isObj(v.override) ? v.override : {};
  const out = tasks
    .filter((t) => !removed.has(t.id))
    .map((t) => (isObj(override[t.id]) ? ({ ...t, ...(override[t.id] as Obj) } as ReplayTask) : t));
  return [...out, ...((Array.isArray(v.add) ? v.add : []) as ReplayTask[])];
}

function replayWarnings(tasks: ReplayTask[], days: string[], prefix: string, out: string[]): void {
  for (const day of days) {
    const steps = tasks
      .map((t, i) => ({ t, i }))
      .filter((x) => x.t.day === day)
      .sort((a, b) => mins(a.t.time) - mins(b.t.time) || a.i - b.i)
      .map((x) => x.t);
    const setting = new Map<string, unknown>();
    const loaded = new Map<string, Set<string>>();
    for (const t of steps) {
      for (const a of t.devices ?? []) {
        const items = loaded.get(a.device) ?? new Set<string>();
        loaded.set(a.device, items);
        if (Array.isArray(a.unload)) {
          for (const id of a.unload) {
            if (!items.has(id)) {
              out.push(`${prefix}task "${t.id}" (${day} ${t.time}) unloads "${id}" from ${a.device}, but nothing with that id is loaded there by then. Fix the id in "unload" or load it earlier.`);
            }
            items.delete(id);
          }
        } else if (a.unload === 'all') items.clear();
        if (a.set !== undefined) {
          setting.set(a.device, a.set);
          if (a.set === 'OFF') items.clear();
        }
        for (const l of a.load ?? []) items.add(l.id);
      }
    }
    for (const [device, s] of setting) {
      if (s !== 'OFF') {
        out.push(`${prefix}device "${device}" is still ${q(s)} at the end of day "${day}". Add {"device": "${device}", "set": "OFF"} to the last task that uses it.`);
      }
    }
  }
}

/* ------------------------------------------------------------------ main */

/**
 * Check unknown JSON against the plan format and its rules. Error strings name the path and
 * say how to fix it, e.g. `tasks[12] (thu-1200).devices[0].device: "ovn" is not a device id
 * (devices: oven, traeger, grill)`. Ignores a top-level "$schema" key.
 */
export function validatePlan(raw: unknown): PlanValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) {
    return { ok: false, errors: ['(root): the plan must be a JSON object { "id", "title", "timeZone", "days", "devices", "tasks", "recipes", ... }.'], warnings };
  }
  const p: Obj = { ...raw };
  delete p.$schema;

  const ctx: Ctx = {
    errors,
    dayIds: new Set(),
    deviceIds: new Set(),
    recipeIds: new Set(),
    fallbackIds: new Set(),
    variantIds: new Set(),
    taskIds: new Set(),
  };

  // --- header
  if (!isNonEmpty(p.id)) errors.push('id: required, a short slug such as "thanksgiving-2026" (it namespaces saved progress).');
  if (!isNonEmpty(p.title)) errors.push('title: required, a non-empty string.');
  for (const k of ['subtitle', 'emoji']) {
    if (p[k] !== undefined && !isStr(p[k])) errors.push(`${k}: must be a string.`);
  }
  if (!isNonEmpty(p.timeZone)) {
    errors.push('timeZone: required, an IANA zone name such as "America/New_York" or "Europe/London".');
  } else if (!validZone(p.timeZone)) {
    errors.push(`timeZone: ${q(p.timeZone)} is not a valid IANA time zone. Use a name like "America/Chicago" or "Europe/London".`);
  }
  if (p.tempUnit !== undefined && p.tempUnit !== 'F' && p.tempUnit !== 'C') {
    errors.push(`tempUnit: must be "F" or "C", got ${q(p.tempUnit)}.`);
  }
  if (p.theme !== undefined) {
    if (!isObj(p.theme) || (p.theme.accent !== undefined && !isStr(p.theme.accent))) {
      errors.push('theme: must be an object like {"accent": "#d97706"}.');
    }
  }

  // --- days
  const dayOrder: string[] = [];
  if (!Array.isArray(p.days) || p.days.length === 0) {
    errors.push('days: required, a non-empty array like [{"id": "sat", "date": "2026-11-28", "label": "Sat 11/28"}].');
  } else {
    p.days.forEach((d, i) => {
      const w = `days[${i}]`;
      if (!isObj(d)) return void errors.push(`${w}: must be {"id", "date", "label"}.`);
      if (!isNonEmpty(d.id) || /\s/.test(d.id)) errors.push(`${w}.id: required, a short slug without spaces such as "wed" or "day1".`);
      else {
        addDup(ctx, ctx.dayIds, d.id, w, 'day');
        dayOrder.push(d.id);
      }
      if (!isStr(d.date) || !validDate(d.date)) errors.push(`${w} (${q(d.id)}).date: ${q(d.date)} is not a valid "YYYY-MM-DD" date.`);
      if (!isNonEmpty(d.label)) errors.push(`${w} (${q(d.id)}).label: required, text shown on the day tab (e.g. "Wed 11/25 · Prep").`);
    });
  }

  // --- devices
  if (!Array.isArray(p.devices)) {
    errors.push('devices: required array (may be empty), e.g. [{"id": "oven", "label": "Oven"}].');
  } else {
    p.devices.forEach((d, i) => {
      const w = `devices[${i}]`;
      if (!isObj(d)) return void errors.push(`${w}: must be {"id", "label", "short"?, "icon"?}.`);
      if (!isNonEmpty(d.id) || /\s/.test(d.id)) errors.push(`${w}.id: required, a slug without spaces such as "oven" or "air-fryer".`);
      else addDup(ctx, ctx.deviceIds, d.id, w, 'device');
      if (!isNonEmpty(d.label)) errors.push(`${w} (${q(d.id)}).label: required, the display name (e.g. "Propane grill").`);
      for (const k of ['short', 'icon']) {
        if (d[k] !== undefined && !isStr(d[k])) errors.push(`${w} (${q(d.id)}).${k}: must be a string.`);
      }
    });
  }

  // --- recipes (ids first so tasks can reference them)
  if (!Array.isArray(p.recipes)) {
    errors.push('recipes: required array (may be empty).');
  } else {
    p.recipes.forEach((r, i) => {
      const w = `recipes[${i}]`;
      if (!isObj(r)) return void errors.push(`${w}: must be {"id", "name", "ingredients", "steps", ...}.`);
      if (!isNonEmpty(r.id)) errors.push(`${w}.id: required, a slug such as "gravy".`);
      else addDup(ctx, ctx.recipeIds, r.id, w, 'recipe');
      const rw = isNonEmpty(r.id) ? `${w} (${r.id})` : w;
      if (!isNonEmpty(r.name)) errors.push(`${rw}.name: required, the recipe title.`);
      for (const k of ['yield', 'when']) {
        if (r[k] !== undefined && !isStr(r[k])) errors.push(`${rw}.${k}: must be a string.`);
      }
      checkRecipeLines(ctx, r.ingredients, `${rw}.ingredients`, true);
      checkRecipeLines(ctx, r.steps, `${rw}.steps`, true);
      if (r.notes !== undefined) strArray(ctx, r.notes, `${rw}.notes`);
    });
  }

  // --- fallbacks / variants ids (collected before tasks reference them)
  const fallbacksRaw: unknown[] = Array.isArray(p.fallbacks) ? p.fallbacks : [];
  const variantsRaw: unknown[] = Array.isArray(p.variants) ? p.variants : [];
  if (p.fallbacks !== undefined && !Array.isArray(p.fallbacks)) errors.push('fallbacks: must be an array.');
  if (p.variants !== undefined && !Array.isArray(p.variants)) errors.push('variants: must be an array.');
  fallbacksRaw.forEach((f, i) => {
    if (isObj(f) && isNonEmpty(f.id)) addDup(ctx, ctx.fallbackIds, f.id, `fallbacks[${i}]`, 'fallback');
  });
  variantsRaw.forEach((v, i) => {
    if (isObj(v) && isNonEmpty(v.id)) addDup(ctx, ctx.variantIds, v.id, `variants[${i}]`, 'variant');
  });

  // --- tasks
  const loadIds = new Map<string, string>();
  const baseTasks: Obj[] = [];
  if (!Array.isArray(p.tasks)) {
    errors.push('tasks: required array of tasks.');
  } else {
    // collect ids first so duplicates are reported at the later task
    p.tasks.forEach((t, i) => {
      const w = taskLabel(`tasks[${i}]`, t);
      if (!isObj(t)) return void errors.push(`${w}: must be an object like {"id", "day", "time", "title"}.`);
      if (isNonEmpty(t.id)) addDup(ctx, ctx.taskIds, t.id, w, 'task');
      baseTasks.push(t);
    });
    p.tasks.forEach((t, i) => {
      if (isObj(t)) checkTaskFields(ctx, t, taskLabel(`tasks[${i}]`, t), false, loadIds);
    });
  }

  // --- fallbacks
  fallbacksRaw.forEach((f, i) => {
    const w = `fallbacks[${i}]`;
    if (!isObj(f)) return void errors.push(`${w}: must be {"id", "title", "body", "relatedTaskIds", "actions"}.`);
    const fw = isNonEmpty(f.id) ? `${w} (${f.id})` : w;
    if (!isNonEmpty(f.id)) errors.push(`${w}.id: required, a slug.`);
    if (!isNonEmpty(f.title)) errors.push(`${fw}.title: required.`);
    strArray(ctx, f.body, `${fw}.body`);
    if (strArray(ctx, f.relatedTaskIds, `${fw}.relatedTaskIds`)) {
      for (const id of f.relatedTaskIds) {
        if (!ctx.taskIds.has(id)) errors.push(`${fw}.relatedTaskIds: "${id}" is not a task id. Use an id from "tasks".`);
      }
    }
    if (!Array.isArray(f.actions)) {
      errors.push(`${fw}.actions: must be an array (may be empty) of {"kind": "variant"|"shiftLane"|"shiftTasks", ...}.`);
    } else {
      f.actions.forEach((a, j) => {
        const aw = `${fw}.actions[${j}]`;
        if (!isObj(a)) return void errors.push(`${aw}: must be an object with "kind".`);
        if (!isNonEmpty(a.label)) errors.push(`${aw}.label: required, the button text.`);
        if (a.kind === 'variant') {
          if (!isStr(a.variantId) || !ctx.variantIds.has(a.variantId)) {
            errors.push(`${aw}.variantId: ${q(a.variantId)} is not a variant id (variants: ${list(ctx.variantIds)}). Add the variant or fix the id.`);
          }
        } else if (a.kind === 'shiftLane') {
          if (!isStr(a.lane) || !ctx.deviceIds.has(a.lane)) {
            errors.push(`${aw}.lane: ${q(a.lane)} is not a device id (devices: ${list(ctx.deviceIds)}).`);
          }
          if (!isNum(a.minutes)) errors.push(`${aw}.minutes: must be a number (negative = earlier).`);
        } else if (a.kind === 'shiftTasks') {
          if (strArray(ctx, a.taskIds, `${aw}.taskIds`)) {
            for (const id of a.taskIds) {
              if (!ctx.taskIds.has(id)) errors.push(`${aw}.taskIds: "${id}" is not a task id. Use an id from "tasks".`);
            }
          }
          if (!isNum(a.minutes)) errors.push(`${aw}.minutes: must be a number (negative = earlier).`);
        } else {
          errors.push(`${aw}.kind: ${q(a.kind)} is not one of "variant", "shiftLane", "shiftTasks".`);
        }
      });
    }
  });

  // --- variants
  const addedByVariant: Obj[][] = [];
  variantsRaw.forEach((v, i) => {
    const w = `variants[${i}]`;
    const added: Obj[] = [];
    addedByVariant.push(added);
    if (!isObj(v)) return void errors.push(`${w}: must be {"id", "label", "override"?, "remove"?, "add"?, "anchors"?}.`);
    const vw = isNonEmpty(v.id) ? `${w} (${v.id})` : w;
    if (!isNonEmpty(v.id)) errors.push(`${w}.id: required, a slug.`);
    if (!isNonEmpty(v.label)) errors.push(`${vw}.label: required.`);
    if (v.override !== undefined) {
      if (!isObj(v.override)) errors.push(`${vw}.override: must be an object keyed by task id.`);
      else {
        for (const [tid, o] of Object.entries(v.override)) {
          const ow = `${vw}.override["${tid}"]`;
          if (!ctx.taskIds.has(tid)) errors.push(`${ow}: "${tid}" is not a task id. Override keys must be ids from "tasks".`);
          if (!isObj(o)) {
            errors.push(`${ow}: must be an object of fields to replace.`);
            continue;
          }
          if ('id' in o) errors.push(`${ow}.id: cannot be overridden; remove it.`);
          for (const k of Object.keys(o)) {
            if (!TASK_KEYS.has(k)) errors.push(`${ow}.${k}: unknown task field. Valid fields: ${list(TASK_KEYS)}.`);
          }
          checkTaskFields(ctx, o, ow, true, null);
        }
      }
    }
    if (v.remove !== undefined && strArray(ctx, v.remove, `${vw}.remove`)) {
      for (const id of v.remove) {
        if (!ctx.taskIds.has(id)) errors.push(`${vw}.remove: "${id}" is not a task id.`);
      }
    }
    const addedIds = new Set<string>();
    if (v.add !== undefined) {
      if (!Array.isArray(v.add)) errors.push(`${vw}.add: must be an array of tasks.`);
      else {
        v.add.forEach((t, j) => {
          const tw = taskLabel(`${vw}.add[${j}]`, t);
          if (!isObj(t)) return void errors.push(`${tw}: must be a task object.`);
          if (isNonEmpty(t.id)) {
            if (ctx.taskIds.has(t.id)) errors.push(`${tw}: duplicate task id "${t.id}" (already in "tasks"). Added task ids must be new; end them in "-fb" by convention.`);
            else addDup(ctx, addedIds, t.id, tw, 'added task');
          }
          checkTaskFields(ctx, t, tw, false, loadIds);
          added.push(t);
        });
      }
    }
    if (v.anchors !== undefined) {
      if (!isObj(v.anchors)) errors.push(`${vw}.anchors: must be an object {addedTaskId: taskId}.`);
      else {
        for (const [a, b] of Object.entries(v.anchors)) {
          if (!addedIds.has(a)) errors.push(`${vw}.anchors["${a}"]: key must be the id of a task in this variant's "add" list.`);
          if (!isStr(b) || !ctx.taskIds.has(b)) errors.push(`${vw}.anchors["${a}"]: ${q(b)} is not a task id in "tasks".`);
        }
      }
    }
  });

  // --- probe targets, checklist
  if (p.probeTargets !== undefined) {
    if (!Array.isArray(p.probeTargets)) errors.push('probeTargets: must be an array of {"label", "temp", "note"?}.');
    else {
      p.probeTargets.forEach((t, i) => {
        const w = `probeTargets[${i}]`;
        if (!isObj(t) || !isNonEmpty(t.label) || !isNum(t.temp)) errors.push(`${w}: must be {"label": "Turkey breast", "temp": 165}; "temp" is a number in the plan's tempUnit.`);
        else if (t.note !== undefined && !isStr(t.note)) errors.push(`${w}.note: must be a string.`);
      });
    }
  }
  if (p.setupChecklist !== undefined) strArray(ctx, p.setupChecklist, 'setupChecklist');

  if (errors.length > 0) return { ok: false, errors, warnings };

  // ---------------- warnings (data is structurally sound from here)
  const plan = p as unknown as Plan;
  const days = plan.days.map((d) => d.id);
  const tasks = plan.tasks as unknown as Array<ReplayTask & Obj>;

  for (const d of plan.days) {
    if (!tasks.some((t) => t.day === d.id)) {
      warnings.push(`day "${d.id}" has no tasks. Add tasks with "day": "${d.id}" or remove the day.`);
    }
  }

  const lastTime = new Map<string, { time: string; id: string }>();
  tasks.forEach((t, i) => {
    const prev = lastTime.get(t.day);
    if (prev && mins(t.time) < mins(prev.time)) {
      warnings.push(`tasks[${i}] (${t.id}): time ${t.time} is earlier than the previous ${t.day} task "${prev.id}" (${prev.time}). Reorder the tasks list by time.`);
    }
    if (!prev || mins(t.time) >= mins(prev.time)) lastTime.set(t.day, { time: t.time, id: t.id });
  });

  const needsHeadsUp = (t: Obj): boolean =>
    Array.isArray(t.devices) &&
    (t.devices as Array<{ load?: unknown[]; unload?: unknown }>).some((a) => (a.load && a.load.length > 0) || a.unload !== undefined);
  tasks.forEach((t, i) => {
    if (needsHeadsUp(t) && t.headsUpMin === undefined) {
      warnings.push(`tasks[${i}] (${t.id}): loads or unloads a device but has no headsUpMin. Add "headsUpMin": 5 so you get a warning before it.`);
    }
  });
  (plan.variants ?? []).forEach((v, vi) => {
    (v.add ?? []).forEach((t, j) => {
      if (needsHeadsUp(t as unknown as Obj) && t.headsUpMin === undefined) {
        warnings.push(`variants[${vi}] (${v.id}).add[${j}] (${t.id}): loads or unloads a device but has no headsUpMin. Add "headsUpMin": 5.`);
      }
    });
  });

  replayWarnings(tasks, days, '', warnings);
  for (const v of plan.variants ?? []) {
    const vt = applyVariant(tasks, v as unknown as Obj);
    const vw: string[] = [];
    replayWarnings(vt, days, `variant "${v.id}": `, vw);
    // only report variant problems that the base plan does not already have
    for (const m of vw) {
      const bare = m.replace(`variant "${v.id}": `, '');
      if (!warnings.includes(bare)) warnings.push(m);
    }
  }

  return { ok: true, plan, warnings };
}
