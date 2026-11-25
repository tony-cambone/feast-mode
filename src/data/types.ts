/**
 * Plan format. A plan is plain JSON (see plans/*.json and plans/plan.schema.json):
 * the event's days, the cooking devices you own, every timed task, and the recipes.
 * Load one with `validatePlan()` (src/data/validate.ts); the app never trusts raw JSON.
 *
 * Design notes:
 *  - Days and devices are defined by the plan, not the code. A one-day Sunday roast with an
 *    oven and an air fryer is as valid as a two-day Thanksgiving with a smoker and a grill.
 *  - `devices` on a task (what it does to each device) drives the equipment board, the Gantt,
 *    and which "running late" lanes the task belongs to.
 *  - Times are 'HH:MM' 24h in the plan's IANA time zone.
 */

/** A PlanDay id, e.g. 'wed', 'thu', 'day1'. */
export type Day = string;
/** A DeviceDef id ('oven', 'smoker', …) or a free-form place tag ('fridge', 'counter'). */
export type Equipment = string;
/** A DeviceDef id. */
export type BoardDevice = string;

export interface PlanDay {
  id: Day; // short slug, used in task.day and task ids
  date: string; // 'YYYY-MM-DD'
  label: string; // 'Wed 11/25 · Prep'
}

export interface DeviceDef {
  id: BoardDevice; // 'oven', 'traeger', 'air-fryer'
  label: string; // 'Propane grill'
  short?: string; // 'Grill' (chips, lane buttons)
  icon?: string; // a single emoji, optional
}

/**
 * A device setpoint. A number is degrees in `plan.tempUnit`. A string is a dial label
 * ('LOW', 'MED-HIGH', 'WARM', 'ON', 'HIGH PRESSURE', …). 'OFF' turns the device off and clears it.
 */
export type DeviceSetting = number | string;
export const OFF = 'OFF';

/** Something placed in/on a device. `id` is referenced later by `unload`. */
export interface LoadItem {
  id: string; // unique within the plan, e.g. 'thu-oven-turkey'
  label: string; // short, for the board: '15.6 lb turkey'
  forMin?: number; // expected time in the device; drives "~N min left" when no later unload exists
}

/** What a task does to one device. Applied in this order within a task: unload → set → load. */
export interface DeviceAction {
  device: BoardDevice;
  set?: DeviceSetting;
  load?: LoadItem[];
  unload?: string[] | 'all';
}

/** 'modal' = full-screen alert + looping sound. 'quiet' = list + small toast only, no modal, no sound. */
export type AlertKind = 'modal' | 'quiet';

export interface Task {
  id: string; // unique, e.g. 'thu-1200'
  day: Day;
  time: string; // 'HH:MM', 24h, plan time zone
  title: string; // short, scannable: 'Stuffing into oven'
  details?: string; // full instruction shown in the alert; **bold** supported
  equipment?: Equipment[]; // display tags; lane membership only when the task has no `devices`
  devices?: DeviceAction[]; // when present, these devices ARE the task's "running late" lanes
  recipeIds?: string[];
  fallbackIds?: string[];
  alert?: AlertKind; // default 'modal'
  headsUpMin?: number; // optional pre-alert N minutes before
  critical?: boolean; // red/bold + loud alarm; never auto-dismissed
  repeatEveryMin?: number; // e.g. stir potatoes every 30 min
  repeatUntil?: string; // 'HH:MM' inclusive
}

/** A recipe line is either text (checkable) or a sub-heading (not checkable). */
export type RecipeLine = string | { heading: string };

export interface Recipe {
  id: string;
  name: string;
  yield?: string;
  when?: string;
  ingredients: RecipeLine[];
  steps: RecipeLine[];
  notes?: string[];
}

export type FallbackAction =
  /** Turn a plan variant on/off (re-times / replaces tasks while active). */
  | { kind: 'variant'; label: string; variantId: string }
  /** Shift every remaining task in a device lane (today) by N minutes (negative = earlier). */
  | { kind: 'shiftLane'; label: string; lane: BoardDevice; minutes: number }
  /** Shift specific tasks (all their remaining occurrences) by N minutes. */
  | { kind: 'shiftTasks'; label: string; taskIds: string[]; minutes: number };

export interface Fallback {
  id: string;
  title: string;
  body: string[]; // paragraphs
  relatedTaskIds: string[];
  actions: FallbackAction[];
}

/** A named set of task changes applied while active (used by fallbacks). */
export interface PlanVariant {
  id: string;
  label: string;
  override?: Record<string, Partial<Omit<Task, 'id'>>>; // taskId -> replaced fields
  remove?: string[]; // taskIds hidden while active
  add?: Task[]; // extra tasks while active
  /**
   * addedTaskId -> taskId. When the variant is turned on, each added task inherits the
   * current "running late" shift of its anchor, so it stays in step with tasks already shifted.
   */
  anchors?: Record<string, string>;
}

export interface ProbeTarget {
  label: string; // 'Turkey breast'
  temp: number; // in plan.tempUnit
  note?: string;
}

export interface PlanTheme {
  /** CSS color for the accent (on / active). Default: warm amber. */
  accent?: string;
}

export interface Plan {
  /** Slug; namespaces saved progress so several plans can live side by side. */
  id: string;
  title: string;
  subtitle?: string;
  emoji?: string; // header + tab icon, e.g. '🦃'
  timeZone: string; // IANA, e.g. 'America/New_York'
  tempUnit?: 'F' | 'C'; // default 'F'
  days: PlanDay[]; // in date order
  devices: DeviceDef[]; // board + lane order
  tasks: Task[];
  recipes: Recipe[];
  fallbacks?: Fallback[];
  variants?: PlanVariant[];
  probeTargets?: ProbeTarget[];
  /** One-time setup checklist shown as a dismissible banner. */
  setupChecklist?: string[];
  theme?: PlanTheme;
}

/* ---------------- small helpers every layer may use ---------------- */

export function dayById(plan: Plan, id: Day): PlanDay | undefined {
  return plan.days.find((d) => d.id === id);
}

export function deviceById(plan: Plan, id: BoardDevice): DeviceDef | undefined {
  return plan.devices.find((d) => d.id === id);
}

/** Device label, or a capitalised tag for non-device equipment ('fridge' -> 'Fridge'). */
export function equipmentLabel(plan: Plan, id: Equipment, short = false): string {
  const d = deviceById(plan, id);
  if (d) return (short && d.short) || d.label;
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : '';
}

export function isDevice(plan: Plan, id: Equipment): boolean {
  return plan.devices.some((d) => d.id === id);
}

/** '425°F' / '220°C' / 'LOW' / 'OFF' */
export function formatSetting(plan: Plan, s: DeviceSetting): string {
  return typeof s === 'number' ? `${s}°${plan.tempUnit ?? 'F'}` : s;
}
