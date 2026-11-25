/**
 * Engine against the REAL bundled Thanksgiving plan: equipment-board spot-checks,
 * planned spans, and a 60x "e2e" simulation through all of Thursday.
 */
import { describe, expect, it } from 'vitest';
import { plan } from '../data/plan';
import type { BoardDevice } from '../data/types';
import { dayById } from '../data/types';
import { getActiveAlerts, getNowNext, pickAlarmKind } from './alerts';
import { getBoard } from './board';
import { buildOccurrences, resolveTasks } from './plan';
import { dayReducer, initialDayState } from './reducer';
import { alignVariantAnchors, planShift, shiftCandidates } from './shift';
import { isRepeating } from './plan';
import { parseHHMM } from './time';
import { getDaySpans } from './spans';
import { zonedToEpoch } from './time';
import type { ActiveAlert, DayState, DeviceStatus, Occurrence } from './types';

const dateOf = (id: string) => dayById(plan, id)!.date;
const thu = (hhmm: string) => zonedToEpoch(dateOf('thu'), hhmm, plan.timeZone);
const wed = (hhmm: string) => zonedToEpoch(dateOf('wed'), hhmm, plan.timeZone);
const MIN = 60_000;
const occsFor = (s: DayState) => buildOccurrences(plan, resolveTasks(plan, s.activeVariants), s.shifts);

function boardAt(now: number, s: DayState = initialDayState()): Record<BoardDevice, DeviceStatus> {
  return Object.fromEntries(getBoard(plan, occsFor(s), s, now).map((d) => [d.device, d])) as Record<BoardDevice, DeviceStatus>;
}
const labels = (d: DeviceStatus) => d.items.map((i) => i.label);

/** Thursday board spot-checks (10:10, 12:10, 12:40, 13:00); shared by the fresh-state test and the simulation. */
function expectThursdaySpotChecks(board: (now: number) => Record<BoardDevice, DeviceStatus>) {
  // 10:10 — Oven 425°F empty, next 10:15 turkey in · Traeger 325°F 19.4 lb turkey · Grill OFF · Slow cooker OFF (next 11:00)
  let b = board(thu('10:10'));
  expect(b.oven.setting).toBe(425);
  expect(b.oven.items).toEqual([]);
  expect(b.oven.next?.occ.time).toBe(thu('10:15'));
  expect(b.oven.next?.load).toEqual(['15.6 lb turkey']);
  expect(b.traeger.setting).toBe(325);
  expect(labels(b.traeger)).toEqual(['19.4 lb turkey']);
  expect(b.grill.setting).toBe('OFF');
  expect(b.slowcooker.setting).toBe('OFF');
  expect(b.slowcooker.items).toEqual([]);
  expect(b.slowcooker.next?.occ.time).toBe(thu('11:00'));

  // 12:10 — Oven 375°F stuffing ×2 · Traeger 325°F turkey · Grill OFF (next 12:20) · Slow cooker LOW mashed potatoes
  b = board(thu('12:10'));
  expect(b.oven.setting).toBe(375);
  expect(labels(b.oven)).toEqual(['Stuffing pan 1', 'Stuffing pan 2']);
  expect(b.traeger.setting).toBe(325);
  expect(labels(b.traeger)).toEqual(['19.4 lb turkey']);
  expect(b.grill.setting).toBe('OFF');
  expect(b.grill.next?.occ.time).toBe(thu('12:20'));
  expect(b.grill.next?.set).toBe(375);
  expect(b.slowcooker.setting).toBe('LOW');
  expect(labels(b.slowcooker)).toEqual(['Mashed potatoes']);

  // 12:40 — Oven 375°F stuffing · Traeger 325°F turkey · Grill ~375°F stuffed mushrooms · Slow cooker LOW potatoes
  b = board(thu('12:40'));
  expect(b.oven.setting).toBe(375);
  expect(labels(b.oven)).toEqual(['Stuffing pan 1', 'Stuffing pan 2']);
  expect(b.traeger.setting).toBe(325);
  expect(labels(b.traeger)).toEqual(['19.4 lb turkey']);
  expect(b.grill.setting).toBe(375);
  expect(labels(b.grill)).toEqual(['Stuffed mushrooms']);
  expect(b.slowcooker.setting).toBe('LOW');
  expect(labels(b.slowcooker)).toEqual(['Mashed potatoes']);

  // 13:00 — Oven 350°F sweet potato + green bean casseroles · Traeger OFF · Grill OFF · Slow cooker LOW potatoes
  b = board(thu('13:00'));
  expect(b.oven.setting).toBe(350);
  expect(labels(b.oven)).toEqual(['Sweet potato casserole', 'Green bean casserole']);
  expect(b.traeger.setting).toBe('OFF');
  expect(b.traeger.items).toEqual([]);
  expect(b.grill.setting).toBe('OFF');
  expect(b.grill.items).toEqual([]);
  expect(b.slowcooker.setting).toBe('LOW');
  expect(labels(b.slowcooker)).toEqual(['Mashed potatoes']);
}

describe('real plan: equipment board', () => {
  it('Thursday spot-checks (10:10, 12:10, 12:40, 13:00) from a fresh state', () => {
    expectThursdaySpotChecks((t) => boardAt(t));
  });

  it('planned out-times on the board', () => {
    const b = boardAt(thu('12:10'));
    expect(b.oven.items.map((i) => i.until)).toEqual([thu('12:55'), thu('12:55')]);
    expect(b.traeger.items[0].until).toBe(thu('12:45'));
    expect(b.slowcooker.items[0].until).toBe(thu('13:45'));
  });

  it('Wednesday spot-checks', () => {
    let b = boardAt(wed('10:05'));
    expect(b.oven.setting).toBe(400);
    expect(labels(b.oven)).toEqual(['Sweet potatoes', 'Mushroom caps']);
    expect(b.oven.items.map((i) => i.until)).toEqual([wed('10:45'), wed('10:10')]);
    expect(b.stove.setting).toBe('MED');
    expect(labels(b.stove)).toEqual(['Bacon, then shallot + spinach']);

    b = boardAt(wed('11:30'));
    expect(b.oven.setting).toBe(350);
    expect(labels(b.oven)).toEqual(['Bacon-spinach quiche']);
    expect(b.oven.items[0].until).toBe(wed('12:15'));

    b = boardAt(wed('12:20'));
    expect(b.oven).toMatchObject({ setting: 'OFF', items: [] });
    expect(b.oven.next?.occ.occId).toBe('wed-1400'); // tagged oven (bread toast fallback)

    b = boardAt(wed('16:30'));
    expect(b.stove).toMatchObject({ setting: 'OFF', items: [] });
    expect(b.traeger.next?.occ.occId).toBe('wed-1700');
  });

  it('"Running late +15" on the Oven lane moves the oven board only', () => {
    const s0 = initialDayState();
    const done = ['thu-0700', 'thu-0800', 'thu-0830', 'thu-0845', 'thu-0915', 'thu-0945', 'thu-1000', 'thu-1015', 'thu-1100', 'thu-1105', 'thu-1115', 'thu-1130', 'thu-potato-stir@11:30', 'thu-1145']
      .reduce((s, occId) => dayReducer(s, { type: 'done', occId, at: thu('11:46') }), s0);
    const rec = planShift(occsFor(done), done, thu('11:50'), 15, { kind: 'lane', lane: 'oven' }, 'Oven +15');
    const shifted = dayReducer(done, { type: 'applyShift', record: rec });
    const occs = occsFor(shifted);
    for (const id of Object.keys(rec.deltas)) {
      const o = occs.find((x) => x.occId === id)!;
      expect(o.task.equipment?.includes('oven') || o.task.devices?.some((d) => d.device === 'oven')).toBe(true);
    }
    expect(rec.deltas['thu-1200']).toBe(15);
    expect(rec.deltas['thu-1245']).toBeUndefined(); // Traeger
    expect(rec.deltas['thu-1015']).toBeUndefined(); // done
    const b = boardAt(thu('12:10'), shifted);
    expect(b.oven.setting).toBe(425);
    expect(labels(b.oven)).toEqual(['15.6 lb turkey']);
    expect(b.traeger.setting).toBe(325);
    expect(boardAt(thu('12:15'), shifted).oven.setting).toBe(375);
    const undone = dayReducer(shifted, { type: 'undoShift' });
    expect(labels(boardAt(thu('12:10'), undone).oven)).toEqual(['Stuffing pan 1', 'Stuffing pan 2']);
  });
});

describe('real plan: review scenarios', () => {
  /** Cook on time through `until` (everything before it marked done at its time). */
  const onTimeUntil = (until: number, s: DayState = initialDayState()) =>
    occsFor(s)
      .filter((o) => o.time < until)
      .reduce((st, o) => dayReducer(st, { type: 'done', occId: o.occId, at: o.time }), s);

  it("'Traeger slow' fallback (+30 Traeger lane) never moves the oven turkey or the stuffing", () => {
    const action = (plan.fallbacks ?? [])
      .flatMap((f) => f.actions)
      .find((a) => a.kind === 'shiftLane' && a.lane === 'traeger' && a.minutes === 30);
    expect(action).toBeDefined();
    const s = onTimeUntil(thu('11:50'));
    const scope = { kind: 'lane' as const, lane: 'traeger' as const };
    const rec = planShift(shiftCandidates(plan, occsFor(s), thu('11:50'), scope), s, thu('11:50'), 30, scope, 'Traeger +30');
    const shifted = dayReducer(s, { type: 'applyShift', record: rec });
    for (const id of Object.keys(rec.deltas)) {
      const o = occsFor(shifted).find((x) => x.occId === id)!;
      expect(o.task.devices ? o.task.devices.some((d) => d.device === 'traeger') : o.task.equipment?.includes('traeger'), id).toBe(true);
      expect((o.task.devices ?? []).some((d) => d.device === 'oven'), id).toBe(false);
    }
    expect(rec.deltas['thu-1245']).toBe(30);
    expect(rec.deltas['thu-1200']).toBeUndefined();
    expect(rec.deltas['thu-1255']).toBeUndefined();
    const b = boardAt(thu('12:10'), shifted);
    expect(b.oven.setting).toBe(375);
    expect(labels(b.oven)).toEqual(['Stuffing pan 1', 'Stuffing pan 2']);
    expect(labels(boardAt(thu('12:55') - 1, shifted).oven)).toEqual(['Stuffing pan 1', 'Stuffing pan 2']);
    expect(labels(boardAt(thu('13:00'), shifted).traeger)).toEqual(['19.4 lb turkey']); // bird stays on until 13:15
  });

  it("'All +15' at 09:00 then 'oven-turkey-late' at 12:00: added tasks follow their anchors", () => {
    let s = onTimeUntil(thu('09:00'));
    const all = { kind: 'all' as const };
    const rec = planShift(shiftCandidates(plan, occsFor(s), thu('09:00'), all), s, thu('09:00'), 15, all, 'All +15');
    expect(Object.keys(rec.deltas).every((id) => !id.startsWith('wed-'))).toBe(true);
    s = dayReducer(s, { type: 'applyShift', record: rec });
    s = onTimeUntil(thu('12:00'), s);
    s = dayReducer(s, { type: 'toggleVariant', variantId: 'oven-turkey-late' });
    const align = alignVariantAnchors(plan, s, 'oven-turkey-late', thu('12:00'));
    s = dayReducer(s, { type: 'applyShift', record: align });
    const occs = occsFor(s);
    const at = (id: string) => occs.find((o) => o.occId === id)!;
    const anchors = (plan.variants ?? []).find((v) => v.id === 'oven-turkey-late')!.anchors!;
    expect(Object.keys(anchors).length).toBeGreaterThan(0);
    for (const [added, anchor] of Object.entries(anchors)) expect(at(added).shiftMin, added).toBe(at(anchor).shiftMin);
    expect(at('thu-1245').time).toBe(thu('13:00'));
    expect(at('thu-1250-fb').time).toBe(thu('13:05')); // stuffing goes on after the Traeger is at 350
    expect(at('thu-1250-fb').time).toBeGreaterThan(at('thu-1245').time);
    // One undo removes just the alignment.
    const undone = dayReducer(s, { type: 'undoShift' });
    expect(occsFor(undone).find((o) => o.occId === 'thu-1250-fb')!.time).toBe(thu('12:50'));
  });
});

describe('real plan: planned spans (Schedule view)', () => {
  const s0 = initialDayState();
  const spans = getDaySpans(plan, occsFor(s0), 'thu');
  const settings = (device: BoardDevice) =>
    spans.filter((s) => s.device === device && s.kind === 'setting').map((s) => [s.label, s.start, s.end]);

  it('Thursday device settings', () => {
    expect(settings('oven')).toEqual([
      ['425°F', thu('10:00'), thu('12:00')],
      ['375°F', thu('12:00'), thu('12:55')],
      ['350°F', thu('12:55'), thu('13:35')],
    ]);
    expect(settings('traeger')).toEqual([['325°F', thu('08:45'), thu('12:45')]]);
    expect(settings('grill')).toEqual([['375°F', thu('12:20'), thu('12:55')]]);
    expect(settings('slowcooker')).toEqual([['LOW', thu('11:00'), thu('13:45')]]);
  });

  it('Thursday item spans', () => {
    const item = (label: string) => spans.filter((s) => s.kind === 'item' && s.label === label).map((s) => [s.device, s.start, s.end]);
    expect(item('15.6 lb turkey')).toEqual([['oven', thu('10:15'), thu('12:00')]]);
    expect(item('Stuffing pan 1')).toEqual([['oven', thu('12:00'), thu('12:55')]]);
    expect(item('Stuffing pan 2')).toEqual([['oven', thu('12:00'), thu('12:55')]]);
    expect(item('19.4 lb turkey')).toEqual([['traeger', thu('09:15'), thu('12:45')]]);
    expect(item('Stuffed mushrooms')).toEqual([['grill', thu('12:35'), thu('12:55')]]);
    expect(item('Mashed potatoes')).toEqual([['slowcooker', thu('11:00'), thu('13:45')]]);
  });

  it('an oven-lane shift moves the oven spans (and not the Traeger)', () => {
    const rec = planShift(occsFor(s0), s0, thu('09:00'), 15, { kind: 'lane', lane: 'oven' }, 'Oven +15');
    const shifted = dayReducer(s0, { type: 'applyShift', record: rec });
    const sp = getDaySpans(plan, occsFor(shifted), 'thu');
    expect(sp.filter((s) => s.device === 'oven' && s.kind === 'setting').map((s) => [s.label, s.start, s.end])).toEqual([
      ['425°F', thu('10:15'), thu('12:15')],
      ['375°F', thu('12:15'), thu('13:10')],
      ['350°F', thu('13:10'), thu('13:50')],
    ]);
    expect(sp.find((s) => s.label === '15.6 lb turkey')).toMatchObject({ start: thu('10:30'), end: thu('12:15') });
    expect(sp.filter((s) => s.device === 'traeger')).toEqual(spans.filter((s) => s.device === 'traeger'));
  });

  it('Wednesday has spans too', () => {
    const w = getDaySpans(plan, occsFor(s0), 'wed');
    expect(w.filter((s) => s.device === 'oven' && s.kind === 'setting').map((s) => [s.label, s.start, s.end])).toEqual([
      ['400°F', wed('09:30'), wed('10:45')],
      ['375°F', wed('10:45'), wed('11:25')],
      ['350°F', wed('11:25'), wed('12:15')],
    ]);
  });
});

/* ---------------------------------------------------------------- 60x simulation */

interface Firing {
  alert: ActiveAlert;
  seenAt: number;
}

/**
 * App clock 06:55 -> 15:10 stepping like a 250 ms ticker at 60x (15 app-seconds per step).
 * Each step: derive the stack; record first sighting of every firingId; acknowledge the FRONT
 * alert (Done for a main, Got it for a heads-up) — one tap per tick, like the cook would.
 */
function simulateThursday(activeVariants: string[]) {
  const STEP = 15_000;
  let state = initialDayState();
  for (const v of activeVariants) state = dayReducer(state, { type: 'toggleVariant', variantId: v });
  const occs = occsFor(state);
  const firings = new Map<string, Firing>();
  const order: Firing[] = [];
  const boards = new Map<number, Record<BoardDevice, DeviceStatus>>();
  const spotTimes = new Set([thu('10:10'), thu('12:10'), thu('12:40'), thu('13:00')]);
  let steps = 0;
  let maxStack = 0;
  const kinds = new Set<string>();

  for (let t = thu('06:55'); t <= thu('15:10'); t += STEP) {
    steps++;
    const stack = getActiveAlerts(occs, state, t, true);
    maxStack = Math.max(maxStack, stack.length);
    for (const a of stack) {
      if (!firings.has(a.firingId)) {
        const f = { alert: a, seenAt: t };
        firings.set(a.firingId, f);
        order.push(f);
      }
    }
    kinds.add(pickAlarmKind(stack) ?? 'off');
    // Exercise the rest of the derivations every tick, like the hook does.
    getNowNext(plan, occs, state, t);
    const board = Object.fromEntries(getBoard(plan, occs, state, t).map((d) => [d.device, d])) as Record<BoardDevice, DeviceStatus>;
    if (spotTimes.has(t)) boards.set(t, board);
    if (stack.length) {
      const front = stack[0];
      state =
        front.type === 'main'
          ? dayReducer(state, { type: 'done', occId: front.occ.occId, at: t })
          : dayReducer(state, { type: 'ackHeadsUp', occId: front.occ.occId, forTime: front.occ.time });
    }
  }
  const finalStack = getActiveAlerts(occs, state, thu('15:10'), true);
  return { occs, state, order, boards, steps, maxStack, kinds, finalStack };
}

function assertSimulation(r: ReturnType<typeof simulateThursday>) {
  const thursdayModal = r.occs.filter((o) => o.day === 'thu' && o.task.alert !== 'quiet');
  const mains = r.order.filter((f) => f.alert.type === 'main');
  const heads = r.order.filter((f) => f.alert.type === 'headsUp');

  expect(r.steps).toBe(1981); // (15:10 - 06:55) / 15 s + 1
  expect(thursdayModal.length).toBeGreaterThan(25);

  // Every non-quiet Thursday occurrence fired a main alert exactly once.
  const mainCount = new Map<string, number>();
  for (const f of mains) mainCount.set(f.alert.occ.occId, (mainCount.get(f.alert.occ.occId) ?? 0) + 1);
  expect([...mainCount.keys()].sort()).toEqual(thursdayModal.map((o) => o.occId).sort());
  for (const [occId, n] of mainCount) expect(n, occId).toBe(1);

  // No Wednesday leftovers (stale) and nothing quiet.
  expect(r.order.some((f) => f.alert.occ.day === 'wed')).toBe(false);
  expect(r.order.some((f) => f.alert.occ.task.alert === 'quiet')).toBe(false);

  // In time order, never early, and within one tick of due.
  for (let i = 1; i < mains.length; i++) {
    expect(mains[i].alert.occ.time).toBeGreaterThanOrEqual(mains[i - 1].alert.occ.time);
  }
  for (const f of mains) {
    expect(f.seenAt, f.alert.key).toBeGreaterThanOrEqual(f.alert.occ.time);
    expect(f.seenAt - f.alert.occ.time, f.alert.key).toBeLessThan(15_000);
    expect(f.alert.critical).toBe(f.alert.occ.task.critical === true);
  }

  // Every task with headsUpMin got exactly one heads-up, ~headsUpMin before (within one tick), never early.
  const withHeads = thursdayModal.filter((o) => (o.task.headsUpMin ?? 0) > 0);
  expect(heads.map((f) => f.alert.occ.occId).sort()).toEqual(withHeads.map((o) => o.occId).sort());
  for (const f of heads) {
    const lead = f.alert.occ.task.headsUpMin! * MIN;
    expect(f.alert.dueAt).toBe(f.alert.occ.time - lead);
    expect(f.seenAt, f.alert.key).toBeGreaterThanOrEqual(f.alert.occ.time - lead);
    expect(f.seenAt - (f.alert.occ.time - lead), f.alert.key).toBeLessThan(15_000);
    expect(lead).toBe(5 * MIN);
  }

  // All done, nothing left alarming.
  expect(r.finalStack).toEqual([]);
  for (const o of thursdayModal) expect(r.state.occ[o.occId]?.doneAt, o.occId).toBeDefined();
  expect(r.kinds.has('alarm')).toBe(true);
  expect(r.kinds.has('headsUp')).toBe(true);
  expect(r.kinds.has('off')).toBe(true);
  return { mains, heads, withHeads };
}

describe('real plan: 60x simulation through all of Thursday', () => {
  it('base plan: every alert fires once, in order, on time; heads-ups 5 min early; stack empty at the end', () => {
    const r = simulateThursday([]);
    const { mains, withHeads } = assertSimulation(r);
    expect(mains).toHaveLength(r.occs.filter((o) => o.day === 'thu' && o.task.alert !== 'quiet').length);
    // Plan rule: every Thursday task that loads or unloads a cooking device has a heads-up.
    const loadsOrUnloads = r.occs.filter(
      (o) => o.day === 'thu' && (o.task.devices ?? []).some((d) => (d.load?.length ?? 0) > 0 || d.unload !== undefined),
    );
    expect(loadsOrUnloads.length).toBeGreaterThan(0);
    for (const o of loadsOrUnloads) expect(withHeads.map((x) => x.occId), o.occId).toContain(o.occId);
    expect(r.kinds.has('gentle')).toBe(true); // non-critical stirs/bastes
    // Board spot-checks hold for a cook who did everything on time.
    expectThursdaySpotChecks((t) => r.boards.get(t)!);
  });

  it("'oven-turkey-late' variant: same guarantees with the re-timed tasks", () => {
    const r = simulateThursday(['oven-turkey-late']);
    const { mains, heads } = assertSimulation(r);
    const ids = mains.map((f) => f.alert.occ.occId);
    expect(ids).not.toContain('thu-1225');
    expect(ids).toEqual(expect.arrayContaining(['thu-1230-fb', 'thu-1250-fb', 'thu-1320-fb', 'thu-1345-fb']));
    // Heads-ups follow the resolved (variant) tasks; assertSimulation checked them generically.
    expect(heads.length).toBeGreaterThan(0);
    expect(ids.indexOf('thu-1230-fb')).toBeLessThan(ids.indexOf('thu-1245'));
    const b = r.boards.get(thu('12:10'))!;
    expect(b.oven.setting).toBe(425);
    expect(labels(b.oven)).toEqual(['15.6 lb turkey']);
    const b13 = r.boards.get(thu('13:00'))!;
    expect(b13.traeger.setting).toBe(350);
    expect(labels(b13.traeger)).toEqual(['Stuffing pan 1', 'Stuffing pan 2']);
    expect(b13.oven.setting).toBe(350);
    expect(labels(b13.oven)).toEqual(['Sweet potato casserole', 'Green bean casserole']);
  });
});

/** Sanity: occurrences of the real plan are well-formed (guards hand edits). */
describe('real plan: occurrences', () => {
  it('every occurrence has a finite time on its plan date and a unique id', () => {
    const occs: Occurrence[] = occsFor(initialDayState());
    const ids = new Set<string>();
    for (const o of occs) {
      expect(Number.isFinite(o.time)).toBe(true);
      expect(ids.has(o.occId), o.occId).toBe(false);
      ids.add(o.occId);
    }
    const expected = plan.tasks.reduce((n, t) => {
      if (!isRepeating(t)) return n + 1;
      return n + Math.floor((parseHHMM(t.repeatUntil!) - parseHHMM(t.time)) / t.repeatEveryMin!) + 1;
    }, 0);
    expect(occs.length).toBe(expected);
  });
});
