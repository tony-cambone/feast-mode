/** "Running late": shift remaining occurrences in a scope by N minutes. */
import type { Plan } from '../data/types';
import { equipmentLabel } from '../data/types';
import { statusOf } from './alerts';
import { buildOccurrences, inLane, resolveTasks } from './plan';
import { boardDay } from './time';
import type { DayState, Occurrence, ShiftRecord, ShiftScope } from './types';

/** Not done AND (still in the future OR its main alert is up / snoozed). */
export function isRemaining(occ: Occurrence, state: DayState, now: number): boolean {
  const st = statusOf(occ, state, now);
  if (st === 'done') return false;
  return occ.time >= now || st === 'alerting' || st === 'snoozed';
}

export function inScope(occ: Occurrence, scope: ShiftScope): boolean {
  switch (scope.kind) {
    case 'all':
      return true;
    case 'lane':
      return inLane(occ.task, scope.lane);
    case 'tasks':
      return scope.taskIds.includes(occ.task.id);
    default:
      return false;
  }
}

/**
 * Build a ShiftRecord for every REMAINING occurrence in scope. Returns deltas only (no mutation).
 * minutes === 0 (or non-finite) yields an empty record.
 */
export function planShift(
  occs: Occurrence[],
  state: DayState,
  now: number,
  minutes: number,
  scope: ShiftScope,
  label: string,
): ShiftRecord {
  const deltas: Record<string, number> = {};
  if (Number.isFinite(minutes) && minutes !== 0) {
    for (const occ of occs) {
      if (inScope(occ, scope) && isRemaining(occ, state, now)) deltas[occ.occId] = minutes;
    }
  }
  return { at: now, label, deltas };
}

/**
 * Default label for a shift: 'Oven +15', 'All +15', 'Air fryer -10', '4 tasks -45'.
 * Lane names come from the plan's device (short label if it has one); without a plan, the id.
 */
export function shiftLabel(minutes: number, scope: ShiftScope, plan?: Pick<Plan, 'devices'>): string {
  const amount = minutes >= 0 ? `+${minutes}` : `${minutes}`;
  switch (scope.kind) {
    case 'all':
      return `All ${amount}`;
    case 'lane':
      return `${plan ? equipmentLabel(plan as Plan, scope.lane, true) : scope.lane} ${amount}`;
    case 'tasks':
      return `${scope.taskIds.length === 1 ? '1 task' : `${scope.taskIds.length} tasks`} ${amount}`;
    default:
      return amount;
  }
}

/**
 * Occurrences a "running late" shift may touch: scopes 'all' and 'lane' stay within the day
 * being cooked (boardDay(now)), so a Wednesday "+15 everything" never moves Thursday.
 * Scope 'tasks' is unrestricted (e.g. the whole-bird fallback moves Thursday tasks deliberately).
 */
export function shiftCandidates(plan: Plan, occs: Occurrence[], now: number, scope: ShiftScope): Occurrence[] {
  if (scope.kind === 'tasks') return occs;
  const day = boardDay(plan, now);
  return occs.filter((o) => o.day === day);
}

export const ANCHOR_ALIGN_LABEL = 'Fallback aligned to earlier shifts';

/**
 * When a variant is turned ON, its added tasks inherit their anchor's current shift
 * (`variant.anchors[addedTaskId] = anchorTaskId`). Returns the record to apply after the toggle:
 * delta = anchorShift - (existing shift of the added occurrence ?? 0); zero deltas skipped.
 * The anchor's shift is that of its first occurrence (looked up in the base plan if the variant removes it).
 */
export function alignVariantAnchors(plan: Plan, state: DayState, variantId: string, now: number): ShiftRecord {
  const deltas: Record<string, number> = {};
  const variant = (plan.variants ?? []).find((v) => v.id === variantId);
  if (variant?.anchors) {
    const active = state.activeVariants.includes(variantId) ? state.activeVariants : [...state.activeVariants, variantId];
    const occs = buildOccurrences(plan, resolveTasks(plan, active), state.shifts);
    let baseOccs: Occurrence[] | null = null;
    const firstOf = (list: Occurrence[], taskId: string) =>
      list.filter((o) => o.task.id === taskId).sort((a, b) => a.baseTime - b.baseTime)[0];
    for (const [addedId, anchorId] of Object.entries(variant.anchors)) {
      let anchor = firstOf(occs, anchorId);
      if (!anchor) anchor = firstOf((baseOccs ??= buildOccurrences(plan, plan.tasks, state.shifts)), anchorId);
      const anchorShift = anchor?.shiftMin ?? 0;
      for (const o of occs) {
        if (o.task.id !== addedId) continue;
        const d = anchorShift - (state.shifts[o.occId] ?? 0);
        if (d !== 0) deltas[o.occId] = d;
      }
    }
  }
  return { at: now, label: ANCHOR_ALIGN_LABEL, deltas };
}
