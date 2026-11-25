/**
 * The store hook: owns clock, day progress (per clock mode), prefs, the ticker and every
 * side effect (sound, notifications, document title, persistence). The UI only renders
 * the returned CookAlongApi.
 *
 *   const api = useCookAlong(plan);            // production
 *   const api = useCookAlong(plan, fakeDeps);  // tests: inject kv, player, ticker, clock...
 *
 * Deps and the plan are read once on mount: mount it with `key={plan.id}` so switching plans
 * remounts it. Progress is stored per plan (day state per clock mode, recipe checks); the clock
 * and settings are global.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Plan } from '../data/types';
import {
  DEFAULT_TEST_SPEED,
  MINUTE_MS,
  STORAGE_KEYS,
  appNow,
  boardDay,
  buildOccurrences,
  createKV,
  dayReducer,
  formatHHMM,
  getActiveAlerts,
  getBoard,
  getAllSpans,
  getNowNext,
  getQuietNotices,
  indexOccurrences,
  alignVariantAnchors,
  shiftCandidates,
  shouldExitTestMode,
  testAutoExitAt,
  testModeCutoffs,
  initialDayState,
  joinPrefs,
  makeTestClock,
  migrateClock,
  migrateDayState,
  migrateLegacyStorage,
  splitPrefs,
  pickAlarmKind,
  planShift,
  prefsReducer,
  resolveTasks,
  shiftLabel,
  statusOf as engineStatusOf,
  stripMarkdown,
  tickIntervalMs,
  withSpeed,
} from '../engine';
import type {
  ActiveAlert,
  ClockConfig,
  DayAction,
  DayState,
  OccStatus,
  Prefs,
  PrefsAction,
  Settings,
  ShiftScope,
  KV,
} from '../engine';
import { createAlarmPlayer } from '../audio';
import type { AlarmKind, AlarmPlayer, AudioState } from '../audio';
import {
  closeNotification,
  createTicker,
  createWakeLock,
  notificationPermission,
  onResume,
  requestNotificationPermission,
  showNotification,
} from '../platform';
import type { NotifPermission, Ticker, WakeLockController, WakeLockState } from '../platform';
import type { CookAlongApi } from './api';

export { pickAlarmKind };

export const DEFAULT_TITLE = 'Feast Mode';

/** Tab title when no alert is up: '🦃 Thanksgiving 2026', else DEFAULT_TITLE. */
export function idleTitle(plan: Pick<Plan, 'title' | 'emoji'>): string {
  const t = `${plan.emoji ?? ''} ${plan.title ?? ''}`.trim();
  return t || DEFAULT_TITLE;
}

/* ------------------------------------------------------------------ deps */

export interface Deps {
  kv: KV;
  player: AlarmPlayer;
  wakeLock: WakeLockController;
  notificationPermission: () => NotifPermission;
  requestNotificationPermission: () => Promise<NotifPermission>;
  showNotification: (opts: { tag: string; title: string; body: string }) => void;
  closeNotification: (tag: string) => void;
  createTicker: (intervalMs: number, onTick: () => void) => Ticker;
  onResume: (cb: () => void) => () => void;
  /** Real wall clock (epoch ms). */
  realNow: () => number;
  setTitle: (title: string) => void;
}

function silentPlayer(): AlarmPlayer {
  return {
    state: 'unsupported',
    unlock: async () => false,
    start: () => {},
    stop: () => {},
    preview: () => {},
    setVolume: () => {},
    onStateChange: () => () => {},
  };
}

function noWakeLock(): WakeLockController {
  return {
    state: 'unsupported',
    request: async () => 'unsupported',
    release: async () => {},
    onChange: () => () => {},
  };
}

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

let defaultSingletons: Pick<Deps, 'kv' | 'player' | 'wakeLock'> | null = null;
let sharedKV: KV | null = null;

/** The app-wide localStorage KV (one instance, so its in-memory cache is shared by every hook). */
export function getDefaultKV(): KV {
  if (!sharedKV) sharedKV = attempt(() => createKV(), createKV(null));
  return sharedKV;
}

/** Module-level singletons so React StrictMode's double render never creates two players. */
function defaultDeps(): Deps {
  if (!defaultSingletons) {
    defaultSingletons = {
      kv: getDefaultKV(),
      player: attempt(() => createAlarmPlayer(), silentPlayer()),
      wakeLock: attempt(() => createWakeLock(), noWakeLock()),
    };
  }
  return {
    ...defaultSingletons,
    notificationPermission,
    requestNotificationPermission,
    showNotification,
    closeNotification,
    createTicker,
    onResume,
    realNow: () => Date.now(),
    setTitle: (t) => {
      if (typeof document !== 'undefined') document.title = t;
    },
  };
}

/* ------------------------------------------------------------------ pure helpers (tested directly) */

/** Text for the backup system notification of one alert firing. Times in `timeZone` (plan.timeZone). */
export function alertNotification(a: ActiveAlert, timeZone: string): { tag: string; title: string; body: string } {
  const t = a.occ.task;
  const hhmm = formatHHMM(a.occ.time, timeZone);
  const title = a.type === 'main' ? `⏰ ${hhmm} ${t.title}` : `⏰ In ${t.headsUpMin ?? 0} min (${hhmm}): ${t.title}`;
  return { tag: a.key, title, body: stripMarkdown(t.details ?? t.title) };
}

/** document.title while alerts are up: '⏰ (n) <front title>'; else `idle`. */
export function documentTitle(alerts: readonly ActiveAlert[], idle: string = DEFAULT_TITLE): string {
  return alerts.length ? `⏰ (${alerts.length}) ${alerts[0].occ.task.title}` : idle;
}

export interface Store {
  clock: ClockConfig;
  days: { real: DayState; test: DayState };
  prefs: Prefs;
}

export type StoreAction =
  | { type: 'day'; action: DayAction } // applies to the CURRENT clock mode's day state
  | { type: 'resetTest' }
  | { type: 'prefs'; action: PrefsAction }
  | { type: 'clock'; clock: ClockConfig };

export function storeReducer(s: Store, a: StoreAction): Store {
  switch (a.type) {
    case 'day': {
      const mode = s.clock.mode;
      const next = dayReducer(s.days[mode], a.action);
      return next === s.days[mode] ? s : { ...s, days: { ...s.days, [mode]: next } };
    }
    case 'resetTest':
      return { ...s, days: { ...s.days, test: initialDayState() } };
    case 'prefs': {
      const next = prefsReducer(s.prefs, a.action);
      return next === s.prefs ? s : { ...s, prefs: next };
    }
    case 'clock':
      return { ...s, clock: a.clock };
    default:
      return s;
  }
}

/** Load one plan's store. Runs the one-time legacy-key migration first. Never throws. */
export function loadStore(kv: KV, planId: string): Store {
  attempt(() => migrateLegacyStorage(kv), false);
  const read = (key: string): unknown => attempt(() => kv.get<unknown>(key), undefined);
  return {
    clock: migrateClock(read(STORAGE_KEYS.clock)),
    days: {
      real: migrateDayState(read(STORAGE_KEYS.day(planId, 'real'))),
      test: migrateDayState(read(STORAGE_KEYS.day(planId, 'test'))),
    },
    prefs: joinPrefs(read(STORAGE_KEYS.prefs), read(STORAGE_KEYS.planPrefs(planId))),
  };
}

/* ------------------------------------------------------------------ hook */

export function useCookAlong(plan: Plan, deps?: Partial<Deps>): CookAlongApi {
  const depsRef = useRef<Deps | null>(null);
  if (!depsRef.current) depsRef.current = { ...defaultDeps(), ...(deps ?? {}) };
  const d = depsRef.current;

  // Store state lives in a ref (so action callbacks always see the latest, even twice in one tick)
  // mirrored into React state for rendering. Every update goes through `apply`.
  const storeRef = useRef<Store | null>(null);
  if (!storeRef.current) {
    const loaded = loadStore(d.kv, plan.id);
    // Load path: a rehearsal left running past a day's cutoff must not swallow the real day.
    storeRef.current = shouldExitTestMode(testModeCutoffs(plan), loaded.clock, d.realNow())
      ? { ...loaded, clock: { mode: 'real' } }
      : loaded;
  }
  const [store, setStore] = useState<Store>(storeRef.current);
  const apply = useCallback((a: StoreAction) => {
    const prev = storeRef.current!;
    const next = storeReducer(prev, a);
    if (next !== prev) {
      storeRef.current = next;
      setStore(next);
    }
  }, []);

  const [realTick, setRealTick] = useState<number>(() => d.realNow());
  const [started, setStarted] = useState(false);
  const [audio, setAudio] = useState<AudioState>(() => attempt(() => d.player.state, 'unsupported'));
  const [notifications, setNotifications] = useState<NotifPermission>(() =>
    attempt(() => d.notificationPermission(), 'unsupported'),
  );
  const [wakeLock, setWakeLock] = useState<WakeLockState>(() => attempt(() => d.wakeLock.state, 'unsupported'));

  const { clock, prefs } = store;
  const day = store.days[clock.mode];
  const now = appNow(clock, realTick);
  const settings = prefs.settings;

  /* ---- derived ---- */
  const tasks = useMemo(() => resolveTasks(plan, day.activeVariants), [plan, day.activeVariants]);
  const occurrences = useMemo(() => buildOccurrences(plan, tasks, day.shifts), [plan, tasks, day.shifts]);
  const occIndex = useMemo(() => indexOccurrences(occurrences), [occurrences]);
  const rawAlerts = useMemo(
    () => getActiveAlerts(occurrences, day, now, settings.headsUpEnabled),
    [occurrences, day, now, settings.headsUpEnabled],
  );
  // Keep the alerts array identity stable while its content is unchanged (fewer UI re-renders/effects).
  const alertsRef = useRef<{ sig: string; occs: unknown; alerts: ActiveAlert[] }>({ sig: '', occs: null, alerts: [] });
  const sig = rawAlerts.map((a) => a.firingId).join('|');
  if (alertsRef.current.sig !== sig || alertsRef.current.occs !== occurrences) {
    alertsRef.current = { sig, occs: occurrences, alerts: rawAlerts };
  }
  const alerts = alertsRef.current.alerts;
  const quietNotices = useMemo(() => getQuietNotices(occurrences, day, now), [occurrences, day, now]);
  const nowNext = useMemo(() => getNowNext(plan, occurrences, day, now), [plan, occurrences, day, now]);
  const board = useMemo(() => getBoard(plan, occurrences, day, now), [plan, occurrences, day, now]);
  const currentBoardDay = useMemo(() => boardDay(plan, now), [plan, now]);
  const spans = useMemo(() => getAllSpans(plan, occurrences), [plan, occurrences]);

  const liveRef = useRef({ occIndex, day, now, settings });
  liveRef.current = { occIndex, day, now, settings };

  /* ---- ticker + resume ---- */
  const interval = tickIntervalMs(clock);
  const intervalRef = useRef(interval);
  const tickerRef = useRef<Ticker | null>(null);
  const cutoffs = useMemo(() => testModeCutoffs(plan), [plan]);
  const cutoffsRef = useRef(cutoffs);
  cutoffsRef.current = cutoffs;
  const tick = useCallback(() => {
    const r = depsRef.current!.realNow();
    setRealTick(r);
    // Tick path: hand back to the real clock once a cutoff passes while in test mode.
    if (shouldExitTestMode(cutoffsRef.current, storeRef.current!.clock, r)) apply({ type: 'clock', clock: { mode: 'real' } });
  }, [apply]);

  useEffect(() => {
    const t = attempt<Ticker | null>(() => d.createTicker(intervalRef.current, tick), null);
    tickerRef.current = t;
    const offResume = attempt<() => void>(
      () =>
        d.onResume(() => {
          tick();
          setNotifications(attempt(() => d.notificationPermission(), 'unsupported'));
        }),
      () => {},
    );
    return () => {
      attempt(() => t?.stop(), undefined);
      attempt(() => offResume(), undefined);
      tickerRef.current = null;
    };
  }, [d, tick]);

  useEffect(() => {
    intervalRef.current = interval;
    attempt(() => tickerRef.current?.setIntervalMs(interval), undefined);
  }, [interval]);

  /* ---- environment subscriptions ---- */
  useEffect(() => {
    const offAudio = attempt<() => void>(() => d.player.onStateChange(setAudio), () => {});
    const offWake = attempt<() => void>(() => d.wakeLock.onChange(setWakeLock), () => {});
    setAudio(attempt(() => d.player.state, 'unsupported'));
    setWakeLock(attempt(() => d.wakeLock.state, 'unsupported'));
    return () => {
      attempt(() => offAudio(), undefined);
      attempt(() => offWake(), undefined);
    };
  }, [d]);

  /* ---- persistence (tolerates kv failure; kv itself never throws) ---- */
  const planId = plan.id;
  useEffect(() => void attempt(() => d.kv.set(STORAGE_KEYS.clock, store.clock), false), [d, store.clock]);
  useEffect(
    () => void attempt(() => d.kv.set(STORAGE_KEYS.day(planId, 'real'), store.days.real), false),
    [d, planId, store.days.real],
  );
  useEffect(
    () => void attempt(() => d.kv.set(STORAGE_KEYS.day(planId, 'test'), store.days.test), false),
    [d, planId, store.days.test],
  );
  useEffect(() => {
    const { global, plan: perPlan } = splitPrefs(store.prefs);
    attempt(() => d.kv.set(STORAGE_KEYS.prefs, global), false);
    attempt(() => d.kv.set(STORAGE_KEYS.planPrefs(planId), perPlan), false);
  }, [d, planId, store.prefs]);

  /* ---- sound: the loudest active alert decides ---- */
  const alarmKind: AlarmKind | null = pickAlarmKind(alerts);
  useEffect(() => {
    attempt(() => {
      if (started && alarmKind) {
        d.player.setVolume(settings.volume);
        d.player.start(alarmKind, settings.sound, settings.volume);
      } else {
        d.player.stop();
      }
    }, undefined);
  }, [d, started, alarmKind, settings.sound, settings.volume]);

  useEffect(
    () => () => {
      attempt(() => d.player.stop(), undefined);
    },
    [d],
  );

  /* ---- backup notifications: one per firingId; closed when the alert leaves the stack ----
   * A firing counts as notified only if permission was granted at that moment, so a later grant
   * (Start my day, or site settings + resume) still notifies alerts that are already up. */
  const notifiedRef = useRef(new Map<string, string>()); // alert key -> firingId shown
  useEffect(() => {
    const shown = notifiedRef.current;
    const live = new Set<string>();
    const granted = attempt(() => d.notificationPermission(), 'unsupported') === 'granted';
    for (const a of alerts) {
      live.add(a.key);
      if (granted && shown.get(a.key) !== a.firingId) {
        shown.set(a.key, a.firingId);
        attempt(() => d.showNotification(alertNotification(a, plan.timeZone)), undefined);
      }
    }
    for (const key of [...shown.keys()]) {
      if (!live.has(key)) {
        shown.delete(key);
        attempt(() => d.closeNotification(key), undefined);
      }
    }
  }, [d, alerts, notifications, plan.timeZone]);

  /* ---- document title ---- */
  const title = documentTitle(alerts, idleTitle(plan));
  useEffect(() => void attempt(() => d.setTitle(title), undefined), [d, title]);

  /* ---- actions ---- */
  /** Fresh app time for an action; also re-ticks so the render that follows uses it. */
  const actionNow = useCallback((): number => {
    const r = depsRef.current!.realNow();
    setRealTick(r);
    return appNow(storeRef.current!.clock, r);
  }, []);

  const start = useCallback(async () => {
    const dd = depsRef.current!;
    // All three are INVOKED synchronously inside the click handler (unlock first) so the
    // user gesture counts for each; then we await them together.
    const unlockP = attempt<Promise<unknown>>(() => dd.player.unlock(), Promise.resolve(false));
    const notifP = attempt<Promise<NotifPermission>>(() => dd.requestNotificationPermission(), Promise.resolve('unsupported'));
    const wakeP = attempt<Promise<WakeLockState>>(() => dd.wakeLock.request(), Promise.resolve('unsupported'));
    setStarted(true);
    const [, n, w] = await Promise.allSettled([unlockP, notifP, wakeP]);
    setAudio(attempt(() => dd.player.state, 'unsupported'));
    if (n.status === 'fulfilled') setNotifications(n.value);
    if (w.status === 'fulfilled') setWakeLock(w.value);
  }, []);

  const unlockAudio = useCallback(async () => {
    const dd = depsRef.current!;
    const p = attempt<Promise<unknown>>(() => dd.player.unlock(), Promise.resolve(false));
    try {
      await p;
    } catch {
      /* state below tells the truth */
    }
    setAudio(attempt(() => dd.player.state, 'unsupported'));
  }, []);

  const done = useCallback((occId: string) => apply({ type: 'day', action: { type: 'done', occId, at: actionNow() } }), [apply, actionNow]);
  const undone = useCallback((occId: string) => apply({ type: 'day', action: { type: 'undone', occId } }), [apply]);
  const snooze = useCallback(
    (occId: string, minutes: 5 | 10) =>
      apply({ type: 'day', action: { type: 'snooze', occId, until: actionNow() + minutes * MINUTE_MS } }),
    [apply, actionNow],
  );
  const ackHeadsUp = useCallback(
    (occId: string) => {
      const occ = liveRef.current.occIndex.get(occId);
      if (occ) apply({ type: 'day', action: { type: 'ackHeadsUp', occId, forTime: occ.time } });
    },
    [apply],
  );

  const shift = useCallback(
    (minutes: number, scope: ShiftScope = { kind: 'all' }, label?: string): number => {
      const at = actionNow();
      const s = storeRef.current!;
      const dayState = s.days[s.clock.mode];
      // Rebuild from the store ref (not the last render) so back-to-back calls stay correct.
      // 'all' / 'lane' stay within today's plan day; 'tasks' is unrestricted.
      const occs = shiftCandidates(
        plan,
        buildOccurrences(plan, resolveTasks(plan, dayState.activeVariants), dayState.shifts),
        at,
        scope,
      );
      const record = planShift(occs, dayState, at, minutes, scope, label ?? shiftLabel(minutes, scope, plan));
      const count = Object.keys(record.deltas).length;
      if (count > 0) apply({ type: 'day', action: { type: 'applyShift', record } });
      return count;
    },
    [apply, actionNow, plan],
  );
  const undoShift = useCallback(() => apply({ type: 'day', action: { type: 'undoShift' } }), [apply]);
  const resetShifts = useCallback(() => apply({ type: 'day', action: { type: 'resetShifts' } }), [apply]);
  const toggleVariant = useCallback(
    (variantId: string) => {
      const before = storeRef.current!;
      const turningOn = !before.days[before.clock.mode].activeVariants.includes(variantId);
      apply({ type: 'day', action: { type: 'toggleVariant', variantId } });
      if (!turningOn) return;
      // Added tasks inherit their anchors' current running-late shift (one undoable record).
      const s = storeRef.current!;
      const record = alignVariantAnchors(plan, s.days[s.clock.mode], variantId, actionNow());
      if (Object.keys(record.deltas).length > 0) apply({ type: 'day', action: { type: 'applyShift', record } });
    },
    [apply, actionNow, plan],
  );
  const isVariantActive = useCallback((variantId: string) => day.activeVariants.includes(variantId), [day.activeVariants]);
  const toggleCheck = useCallback((key: string) => apply({ type: 'prefs', action: { type: 'toggleCheck', key } }), [apply]);
  const updateSettings = useCallback(
    (patch: Partial<Settings>) => apply({ type: 'prefs', action: { type: 'settings', patch } }),
    [apply],
  );
  const dismissChecklist = useCallback(() => apply({ type: 'prefs', action: { type: 'dismissChecklist' } }), [apply]);
  const previewSound = useCallback((kind: AlarmKind) => {
    const s = storeRef.current!.prefs.settings;
    attempt(() => depsRef.current!.player.preview(kind, s.sound, s.volume), undefined);
  }, []);

  const setTestClock = useCallback((appTime: number | null, speed?: number, opts?: { fresh?: boolean }) => {
    const r = depsRef.current!.realNow();
    const cur = storeRef.current!.clock;
    const next: ClockConfig =
      appTime === null || !Number.isFinite(appTime)
        ? { mode: 'real' }
        : makeTestClock(appTime, speed ?? (cur.mode === 'test' ? cur.speed : DEFAULT_TEST_SPEED), r);
    setRealTick(r);
    apply({ type: 'clock', clock: next });
    if (next.mode === 'test' && opts?.fresh && appTime !== null) {
      // `apply` reads/writes storeRef synchronously, so these land on the TEST day state in order.
      apply({ type: 'resetTest' });
      const s = storeRef.current!.days.test;
      const occs = buildOccurrences(plan, resolveTasks(plan, s.activeVariants), s.shifts);
      for (const o of occs) {
        if (o.time < appTime) apply({ type: 'day', action: { type: 'done', occId: o.occId, at: o.time } });
      }
    }
  }, [apply, plan]);

  const setTestSpeed = useCallback((speed: number) => {
    const r = depsRef.current!.realNow();
    const cur = storeRef.current!.clock;
    if (cur.mode !== 'test') return;
    setRealTick(r);
    apply({ type: 'clock', clock: withSpeed(cur, speed, r) });
  }, [apply]);

  const resetTestState = useCallback(() => apply({ type: 'resetTest' }), [apply]);
  const resetDay = useCallback(() => apply({ type: 'day', action: { type: 'reset' } }), [apply]);

  const statusOf = useCallback(
    (occId: string): OccStatus => {
      const occ = occIndex.get(occId);
      return occ ? engineStatusOf(occ, day, now) : 'upcoming';
    },
    [occIndex, day, now],
  );

  return {
    plan,
    now,
    clock,
    isTestMode: clock.mode === 'test',
    testAutoExitAt: testAutoExitAt(cutoffs, clock),
    boardDay: currentBoardDay,
    occurrences,
    statusOf,
    alerts,
    quietNotices,
    nowNext,
    board,
    spans,
    day,
    prefs,
    storageOk: attempt(() => d.kv.ok, false),
    audio,
    notifications,
    wakeLock,
    started,
    start,
    unlockAudio,
    done,
    undone,
    snooze,
    ackHeadsUp,
    shift,
    undoShift,
    resetShifts,
    toggleVariant,
    isVariantActive,
    toggleCheck,
    updateSettings,
    dismissChecklist,
    previewSound,
    setTestClock,
    setTestSpeed,
    resetTestState,
    resetDay,
  };
}
