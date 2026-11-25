/**
 * Hand-made CookAlongApi + PlanSourceApi for previewing UI states without the real clock,
 * storage or sound. Works with any bundled plan (plans/*.json):
 *
 *   ?mock=dash|alert|calm|headsup|stack|quiet|test
 *     &plan=<plan id>          which bundled plan (default: christmas-dinner, else the first)
 *     &start                   show the Start screen
 *     &devices=<1..8>          trim or pad the device list, to check the board at any size
 *     &theme=dark|light|auto &text=s|m|l|xl      display options for this load only
 *
 * Deliberately simple: it derives occurrences, the board and the Gantt spans itself rather
 * than calling the engine, so a preview never depends on engine state.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CookAlongApi, PlanSourceApi, PlanSummary } from '../../app/api';
import { OFF, dayById, formatSetting } from '../../data/types';
import type { Day, DeviceSetting, Plan } from '../../data/types';
import { validatePlan } from '../../data/validate';
import type {
  ActiveAlert,
  BoardItem,
  ClockConfig,
  DayState,
  DeviceSpan,
  DeviceStatus,
  NowNext,
  Occurrence,
  OccStatus,
  Prefs,
  Settings,
  ShiftScope,
} from '../../engine/types';
import { MIN, busiestStart, lanesOfTask, toEpoch } from '../format';

export type Scenario = 'dash' | 'alert' | 'calm' | 'headsup' | 'stack' | 'quiet' | 'test';
export const SCENARIOS: Scenario[] = ['dash', 'alert', 'calm', 'headsup', 'stack', 'quiet', 'test'];

/* ------------------------------------------------------------------ bundled plans */
const files = import.meta.glob(['../../../plans/*.json', '!../../../plans/*.schema.json'], { eager: true, import: 'default' }) as Record<string, unknown>;
const looksLikePlan = (v: unknown): v is Plan =>
  typeof v === 'object' && v !== null && Array.isArray((v as Plan).tasks) && Array.isArray((v as Plan).days) && Array.isArray((v as Plan).devices);
const BUNDLED: Plan[] = Object.entries(files)
  .map(([, v]) => v)
  .filter(looksLikePlan)
  .sort((a, b) => Number(b.id === 'christmas-dinner') - Number(a.id === 'christmas-dinner'));

const EXTRA_DEVICES = [
  { id: 'x-airfryer', label: 'Air fryer' },
  { id: 'x-instantpot', label: 'Instant Pot' },
  { id: 'x-warmer', label: 'Warming drawer' },
  { id: 'x-smoker', label: 'Smoker' },
  { id: 'x-griddle', label: 'Griddle' },
  { id: 'x-roaster', label: 'Roaster oven' },
  { id: 'x-ricecooker', label: 'Rice cooker' },
];

function withDeviceCount(plan: Plan, n: number | null): Plan {
  if (!n || n === plan.devices.length) return plan;
  const devices = plan.devices.slice(0, n);
  for (let i = 0; devices.length < n && i < EXTRA_DEVICES.length; i++) devices.push(EXTRA_DEVICES[i]);
  return { ...plan, devices };
}

/** In-memory plan source: bundled plans plus anything imported during this page load. */
export function useMockPlanSource(): PlanSourceApi {
  const q = new URLSearchParams(location.search);
  const deviceCount = Number(q.get('devices')) || null;
  const [imported, setImported] = useState<Plan[]>([]);
  const [activeId, setActiveId] = useState(() => q.get('plan') ?? BUNDLED[0]?.id ?? '');
  const all = useMemo(() => [...imported, ...BUNDLED.filter((b) => !imported.some((p) => p.id === b.id))], [imported]);
  const raw = all.find((p) => p.id === activeId) ?? all[0];
  if (!raw) throw new Error('Mock mode needs at least one plan in plans/*.json');
  const plan = useMemo(() => withDeviceCount(raw, deviceCount), [raw, deviceCount]);
  const available: PlanSummary[] = all.map((p) => ({ id: p.id, title: p.title, emoji: p.emoji, source: imported.includes(p) ? 'imported' : 'bundled' }));

  return {
    plan,
    available,
    activate: setActiveId,
    importPlan: (text) => {
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (e) {
        return { ok: false, errors: [`This isn't valid JSON: ${e instanceof Error ? e.message : String(e)}.`], warnings: [] };
      }
      const r = validatePlan(value);
      if (!r.ok) return r;
      setImported((list) => [r.plan, ...list.filter((p) => p.id !== r.plan.id)]);
      setActiveId(r.plan.id);
      return r;
    },
    removeImported: (id) => setImported((list) => list.filter((p) => p.id !== id)),
    exportActive: () => `${JSON.stringify(raw, null, 2)}\n`,
  };
}

/* ------------------------------------------------------------------ derivations */
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function expand(plan: Plan, shifts: Record<string, number>): Occurrence[] {
  const out: Occurrence[] = [];
  plan.tasks.forEach((task, order) => {
    const day = dayById(plan, task.day);
    if (!day) return;
    const times = [task.time];
    if (task.repeatEveryMin && task.repeatUntil) {
      for (let m = toMin(task.time) + task.repeatEveryMin; m <= toMin(task.repeatUntil); m += task.repeatEveryMin) times.push(toHHMM(m));
    }
    for (const t of times) {
      const occId = task.repeatEveryMin ? `${task.id}@${t}` : task.id;
      const baseTime = toEpoch(day.date, t, plan.timeZone);
      const shiftMin = shifts[occId] ?? 0;
      out.push({ occId, task, day: task.day, baseTime, shiftMin, time: baseTime + shiftMin * MIN, order });
    }
  });
  return out.sort((a, b) => a.time - b.time || a.order - b.order);
}

function boardAt(plan: Plan, occs: Occurrence[], day: Day, now: number, isDone: (o: Occurrence) => boolean): DeviceStatus[] {
  const dayOccs = occs.filter((o) => o.day === day);
  return plan.devices.map((dev, idx): DeviceStatus => {
    let setting: DeviceSetting = OFF;
    let settingSince: number | undefined;
    let items: BoardItem[] = [];
    const acts = dayOccs.flatMap((o) => (o.task.devices ?? []).filter((a) => a.device === dev.id).map((a) => ({ o, a })));
    acts.forEach(({ o, a }, i) => {
      if (o.time > now) return;
      if (a.unload === 'all') items = [];
      else if (a.unload) items = items.filter((it) => !a.unload!.includes(it.id));
      if (a.set !== undefined) {
        if (a.set !== setting) settingSince = o.time;
        setting = a.set;
        if (a.set === OFF) items = [];
      }
      for (const l of a.load ?? []) {
        const out = acts.slice(i + 1).find((x) => x.a.unload === 'all' || x.a.unload?.includes(l.id) || x.a.set === OFF);
        items.push({ id: l.id, label: l.label, since: o.time, until: out ? out.o.time : l.forMin ? o.time + l.forMin * MIN : undefined });
      }
    });
    const nextOcc = occs.find((o) => o.time > now && !isDone(o) && ((o.task.devices ?? []).some((a) => a.device === dev.id) || (o.task.equipment ?? []).includes(dev.id)));
    const act = nextOcc?.task.devices?.find((a) => a.device === dev.id);
    // Padded preview devices (?devices=N) have no tasks: light every other one so the board shows both states.
    if (dev.id.startsWith('x-') && idx % 2 === 0) {
      return { device: dev.id, setting: idx % 4 === 0 ? 'LOW' : 350, settingSince: now - 40 * MIN, items: [{ id: `${dev.id}-item`, label: 'Dinner rolls', since: now - 20 * MIN, until: now + 25 * MIN }] };
    }
    return {
      device: dev.id,
      setting,
      settingSince,
      items,
      next: nextOcc
        ? {
            occ: nextOcc,
            set: act?.set,
            load: act?.load?.map((l) => l.label),
            unload: act?.unload === 'all' ? 'all' : act?.unload?.map((id) => items.find((it) => it.id === id)?.label ?? id),
          }
        : undefined,
    };
  });
}

function spansFor(plan: Plan, occs: Occurrence[], day: Day): DeviceSpan[] {
  const out: DeviceSpan[] = [];
  const dayOccs = occs.filter((o) => o.day === day);
  for (const dev of plan.devices) {
    const acts = dayOccs.flatMap((o) => (o.task.devices ?? []).filter((a) => a.device === dev.id).map((a) => ({ o, a })));
    if (!acts.length) continue;
    const cap = acts[acts.length - 1].o.time + 30 * MIN;
    let cur: { setting: DeviceSetting; start: number; occId: string } | null = null;
    const closeSetting = (end: number, endOccId?: string) => {
      if (cur) out.push({ device: dev.id, kind: 'setting', label: formatSetting(plan, cur.setting), setting: cur.setting, start: cur.start, end, occId: cur.occId, endOccId });
      cur = null;
    };
    acts.forEach(({ o, a }, i) => {
      if (a.set !== undefined && (!cur || cur.setting !== a.set)) {
        closeSetting(o.time, o.occId);
        if (a.set !== OFF) cur = { setting: a.set, start: o.time, occId: o.occId };
      }
      for (const l of a.load ?? []) {
        const end = acts.slice(i + 1).find((x) => x.a.unload === 'all' || x.a.unload?.includes(l.id) || x.a.set === OFF);
        out.push({ device: dev.id, kind: 'item', label: l.label, start: o.time, end: end ? end.o.time : l.forMin ? o.time + l.forMin * MIN : cap, occId: o.occId, endOccId: end?.o.occId });
      }
    });
    closeSetting(cap);
  }
  return out;
}

/* ------------------------------------------------------------------ scenarios */
interface Spec {
  now: number;
  day: Day;
  alerts: { occId: string; type: 'main' | 'headsUp'; calm?: boolean }[];
  /** Occurrences before `now` that should not be auto-marked done. */
  keep?: string[];
  test?: boolean;
}

function specFor(scenario: Scenario, plan: Plan, occs: Occurrence[]): Spec {
  const days = plan.days.filter((d) => occs.some((o) => o.day === d.id));
  const day = days[days.length - 1]?.id ?? plan.days[0]?.id ?? '';
  const dayOccs = occs.filter((o) => o.day === day);
  const modal = dayOccs.filter((o) => (o.task.alert ?? 'modal') === 'modal');
  const busy = busiestStart(dayOccs) ?? dayOccs[0]?.time ?? Date.now();
  const near = (list: Occurrence[]) => list.slice().sort((a, b) => Math.abs(a.time - busy) - Math.abs(b.time - busy))[0];
  const focus =
    near(modal.filter((o) => o.task.critical && o.task.headsUpMin && o.task.devices?.length)) ?? near(modal.filter((o) => o.task.headsUpMin)) ?? near(modal) ?? dayOccs[0];
  if (!focus) return { now: Date.now(), day, alerts: [] };
  const lead = (focus.task.headsUpMin ?? 5) * MIN;
  const prev = modal.filter((o) => o.time < focus.time).pop();
  const laterHeads = modal.find((o) => o.time > focus.time && o.task.headsUpMin);
  switch (scenario) {
    case 'alert':
      return { now: focus.time + 5_000, day, alerts: [{ occId: focus.occId, type: 'main' }] };
    case 'calm': {
      const calm = near(modal.filter((o) => !o.task.critical)) ?? focus;
      return { now: calm.time + 5_000, day, alerts: [{ occId: calm.occId, type: 'main', calm: true }] };
    }
    case 'headsup':
      return { now: focus.time - lead + 10_000, day, alerts: [{ occId: focus.occId, type: 'headsUp' }] };
    case 'stack':
      return {
        now: focus.time + 30_000,
        day,
        alerts: [
          { occId: focus.occId, type: 'main' as const },
          ...(prev ? [{ occId: prev.occId, type: 'main' as const, calm: true }] : []),
          ...(laterHeads ? [{ occId: laterHeads.occId, type: 'headsUp' as const }] : []),
        ],
      };
    case 'quiet': {
      const quiet = occs.find((o) => o.task.alert === 'quiet');
      return quiet ? { now: quiet.time + 2 * MIN, day: quiet.day, alerts: [], keep: [quiet.occId] } : { now: focus.time - 40 * MIN, day, alerts: [] };
    }
    case 'test':
      return { now: focus.time - 78 * MIN, day, alerts: [], test: true };
    default:
      return { now: focus.time - 17 * MIN - 20_000, day, alerts: [] };
  }
}

export function useMockApi(plan: Plan, scenario: Scenario, startOverlay: boolean): CookAlongApi {
  const baseOccs = useMemo(() => expand(plan, {}), [plan]);
  const spec = useMemo(() => specFor(scenario, plan, baseOccs), [scenario, plan, baseOccs]);
  const base = spec.now;
  const mountReal = useMemo(() => Date.now(), []);
  const [, setTick] = useState(0);
  const [clock, setClock] = useState<ClockConfig>(spec.test ? { mode: 'test', baseReal: mountReal, baseApp: base, speed: 60 } : { mode: 'real' });
  const [done, setDone] = useState<Record<string, number>>({});
  const [undoneIds, setUndoneIds] = useState<Record<string, boolean>>({});
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const [acked, setAcked] = useState<Record<string, number>>({});
  const [shifts, setShifts] = useState<Record<string, number>>({});
  const [shiftLog, setShiftLog] = useState<DayState['shiftLog']>([]);
  const [variants, setVariants] = useState<string[]>([]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<Settings>({ sound: 'klaxon', volume: 0.8, headsUpEnabled: true });
  const [dismissed, setDismissed] = useState(scenario !== 'test');
  const [started, setStarted] = useState(!startOverlay);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  const realNow = Date.now();
  const now = clock.mode === 'test' ? clock.baseApp + (realNow - clock.baseReal) * clock.speed : base + (realNow - mountReal);

  const occurrences = useMemo(() => expand(plan, shifts), [plan, shifts]);
  const byId = useMemo(() => new Map(occurrences.map((o) => [o.occId, o])), [occurrences]);

  const isDone = (o: Occurrence) =>
    done[o.occId] !== undefined || (!undoneIds[o.occId] && !spec.alerts.some((a) => a.occId === o.occId) && !spec.keep?.includes(o.occId) && o.baseTime < base && !(o.occId in shifts));

  const alerts: ActiveAlert[] = spec.alerts
    .filter((a) => {
      const o = byId.get(a.occId);
      if (!o || done[a.occId] !== undefined) return false;
      if (a.type === 'headsUp') return acked[a.occId] === undefined;
      return (snoozed[a.occId] ?? 0) <= now;
    })
    .map((a) => {
      const o = byId.get(a.occId)!;
      const dueAt = a.type === 'headsUp' ? o.time - (o.task.headsUpMin ?? 5) * MIN : o.time;
      return { key: `${a.occId}#${a.type === 'main' ? 'main' : 'heads'}`, type: a.type, occ: o, critical: a.calm ? false : !!o.task.critical, dueAt, firingId: `${a.occId}@${dueAt}` };
    });

  const statusOf = useCallback(
    (id: string): OccStatus => {
      const o = byId.get(id);
      if (!o) return 'upcoming';
      if (isDone(o)) return 'done';
      if (alerts.some((a) => a.occ.occId === id && a.type === 'main')) return 'alerting';
      if ((snoozed[id] ?? 0) > now) return 'snoozed';
      if (o.time > now) return 'upcoming';
      if (o.task.alert === 'quiet' && now - o.time < 15 * MIN) return 'quiet-now';
      return 'missed';
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byId, done, undoneIds, snoozed, now, alerts.length],
  );

  const boardDay = spec.day;
  const quietNotices = occurrences.filter((o) => statusOf(o.occId) === 'quiet-now');
  const current = occurrences.filter((o) => ['alerting', 'snoozed', 'quiet-now'].includes(statusOf(o.occId)));
  const startedOccs = occurrences.filter((o) => o.day === boardDay && o.time <= now);
  const upcomingAll = occurrences.filter((o) => o.time > now && statusOf(o.occId) !== 'done');
  const nowNext: NowNext = {
    current,
    lastStarted: startedOccs[startedOccs.length - 1],
    next: upcomingAll[0],
    nextInMs: upcomingAll[0] ? upcomingAll[0].time - now : undefined,
    upcoming: upcomingAll.slice(1, 5),
  };

  const dayState: DayState = {
    version: 1,
    occ: Object.fromEntries(occurrences.map((o) => [o.occId, { doneAt: done[o.occId], snoozedUntil: (snoozed[o.occId] ?? 0) > now ? snoozed[o.occId] : undefined }])),
    shifts,
    shiftLog,
    activeVariants: variants,
  };
  const prefs: Prefs = { version: 1, settings, checks, setupChecklistDismissed: dismissed };
  const spans = useMemo(() => Object.fromEntries(plan.days.map((d) => [d.id, spansFor(plan, occurrences, d.id)])), [plan, occurrences]);

  const shift = (minutes: number, scope: ShiftScope = { kind: 'all' }, label?: string): number => {
    const hit = occurrences.filter((o) => {
      if (statusOf(o.occId) === 'done' || o.time < now - 5 * MIN) return false;
      if (scope.kind === 'all') return o.day === boardDay;
      if (scope.kind === 'lane') return o.day === boardDay && lanesOfTask(plan, o.task).includes(scope.lane);
      return scope.taskIds.includes(o.task.id);
    });
    const deltas = Object.fromEntries(hit.map((o) => [o.occId, minutes]));
    setShifts((s) => {
      const n = { ...s };
      for (const o of hit) n[o.occId] = (n[o.occId] ?? 0) + minutes;
      return n;
    });
    if (hit.length) setShiftLog((l) => [...l, { at: now, label: label ?? `+${minutes}`, deltas }]);
    return hit.length;
  };

  const wipe = () => {
    setDone({});
    setUndoneIds({});
    setSnoozed({});
    setAcked({});
  };

  return {
    plan,
    spans,
    now,
    clock,
    isTestMode: clock.mode === 'test',
    testAutoExitAt: clock.mode === 'test' ? Date.now() + 9 * 3_600_000 : null,
    boardDay,
    occurrences,
    statusOf,
    alerts,
    quietNotices,
    nowNext,
    board: boardAt(plan, occurrences, boardDay, now, isDone),
    day: dayState,
    prefs,
    storageOk: scenario !== 'test',
    audio: scenario === 'quiet' ? 'suspended' : 'running',
    notifications: scenario === 'test' ? 'denied' : 'granted',
    wakeLock: scenario === 'test' ? 'unsupported' : 'active',
    started,
    start: async () => setStarted(true),
    unlockAudio: async () => undefined,
    done: (id) => setDone((d) => ({ ...d, [id]: now })),
    undone: (id) => {
      setUndoneIds((u) => ({ ...u, [id]: true }));
      setDone((d) => {
        const n = { ...d };
        delete n[id];
        return n;
      });
    },
    snooze: (id, m) => setSnoozed((s) => ({ ...s, [id]: now + m * MIN })),
    ackHeadsUp: (id) => setAcked((s) => ({ ...s, [id]: now })),
    shift,
    undoShift: () => {
      const last = shiftLog[shiftLog.length - 1];
      if (!last) return;
      setShifts((s) => {
        const n = { ...s };
        for (const [k, v] of Object.entries(last.deltas)) {
          n[k] = (n[k] ?? 0) - v;
          if (n[k] === 0) delete n[k];
        }
        return n;
      });
      setShiftLog((l) => l.slice(0, -1));
    },
    resetShifts: () => {
      setShifts({});
      setShiftLog([]);
    },
    toggleVariant: (id) => setVariants((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id])),
    isVariantActive: (id) => variants.includes(id),
    toggleCheck: (k) => setChecks((c) => ({ ...c, [k]: !c[k] })),
    updateSettings: (p) => setSettings((s) => ({ ...s, ...p })),
    dismissChecklist: () => setDismissed(true),
    previewSound: () => undefined,
    setTestClock: (t, speed = 60) => setClock(t === null ? { mode: 'real' } : { mode: 'test', baseReal: Date.now(), baseApp: t, speed }),
    setTestSpeed: (speed) => setClock((c) => (c.mode === 'test' ? { mode: 'test', baseReal: Date.now(), baseApp: c.baseApp + (Date.now() - c.baseReal) * c.speed, speed } : c)),
    resetTestState: wipe,
    resetDay: () => {
      wipe();
      setShifts({});
      setShiftLog([]);
    },
  };
}
