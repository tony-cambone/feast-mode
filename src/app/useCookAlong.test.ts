// @vitest-environment jsdom
import { StrictMode, act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plan as realPlan } from '../data/plan';
import type { Plan } from '../data/types';
import { STORAGE_KEYS, createKV, zonedToEpoch } from '../engine';
import type { DayState, KV } from '../engine';
import { fixturePlan, roastPlan, sun, thu, wed } from '../engine/testFixture';

/** Real-clock instants for the auto-exit tests (same zone math as the plan). */
const wedReal = (hhmm: string) => zonedToEpoch('2026-11-25', hhmm);
const thuReal = (hhmm: string) => zonedToEpoch('2026-11-26', hhmm);
import type { AlarmPlayer, AudioState } from '../audio';
import type { NotifPermission, Ticker, WakeLockController, WakeLockState } from '../platform';
import type { CookAlongApi } from './api';
import { idleTitle, useCookAlong } from './useCookAlong';
import type { Deps } from './useCookAlong';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MemStorage implements Storage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(k: string) { return this.data.get(k) ?? null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(k: string) { this.data.delete(k); }
  setItem(k: string, v: string) { this.data.set(k, String(v)); }
}
class ThrowingStorage extends MemStorage {
  override getItem(): string | null { throw new Error('blocked'); }
  override setItem(): void { throw new Error('blocked'); }
}

function makeFakes(kv: KV = createKV(new MemStorage()), opts: { perm?: NotifPermission; real?: number } = {}) {
  const log: string[] = [];
  const clock = { real: opts.real ?? 1_000_000 };
  const notif = { perm: opts.perm ?? ('default' as NotifPermission) };
  const tickers: { ms: number; onTick: () => void; stopped: boolean; intervals: number[] }[] = [];
  const resumeCbs = new Set<() => void>();
  const shown: { tag: string; title: string; body: string }[] = [];
  const closed: string[] = [];
  const titles: string[] = [];

  const player = {
    state: 'locked' as AudioState,
    unlock: vi.fn(async () => {
      log.push('unlock');
      player.state = 'running';
      return true;
    }),
    start: vi.fn((kind: string, sound: string, volume: number) => log.push(`start:${kind}:${sound}:${volume}`)),
    stop: vi.fn(() => log.push('stop')),
    preview: vi.fn(),
    setVolume: vi.fn(),
    onStateChange: () => () => {},
  } satisfies AlarmPlayer;

  const wakeLock = {
    state: 'released' as WakeLockState,
    request: vi.fn(async () => {
      log.push('wakeLock');
      wakeLock.state = 'active';
      return 'active' as WakeLockState;
    }),
    release: async () => {},
    onChange: () => () => {},
  } satisfies WakeLockController;

  const deps: Deps = {
    kv,
    player,
    wakeLock,
    notificationPermission: () => notif.perm,
    requestNotificationPermission: vi.fn(async () => {
      log.push('notifPermission');
      notif.perm = 'granted';
      return 'granted' as NotifPermission;
    }),
    showNotification: (o) => void shown.push(o),
    closeNotification: (tag) => void closed.push(tag),
    createTicker: (ms, onTick): Ticker => {
      const t = { ms, onTick, stopped: false, intervals: [ms] };
      tickers.push(t);
      return {
        setIntervalMs: (next) => {
          t.ms = next;
          t.intervals.push(next);
        },
        stop: () => {
          t.stopped = true;
        },
      };
    },
    onResume: (cb) => {
      resumeCbs.add(cb);
      return () => resumeCbs.delete(cb);
    },
    realNow: () => clock.real,
    setTitle: (t) => void titles.push(t),
  };

  const ticker = () => {
    const live = tickers.filter((t) => !t.stopped);
    expect(live).toHaveLength(1); // StrictMode's extra mount/unmount must not leak tickers
    return live[0];
  };
  /** Advance the real clock and fire one tick. */
  const advance = (realMs: number) => {
    clock.real += realMs;
    act(() => ticker().onTick());
  };
  return { deps, log, clock, notif, ticker, advance, player, wakeLock, shown, closed, titles, resumeCbs };
}

const mounted: (() => void)[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!();
});

function mount(plan: Plan, deps: Partial<Deps>) {
  const ref: { api: CookAlongApi | null; renders: number } = { api: null, renders: 0 };
  function Probe() {
    ref.api = useCookAlong(plan, deps);
    ref.renders++;
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(StrictMode, null, createElement(Probe))));
  const unmount = () => act(() => root.unmount());
  mounted.push(unmount);
  return {
    get api() {
      return ref.api!;
    },
    unmount: () => {
      mounted.splice(mounted.indexOf(unmount), 1);
      unmount();
    },
  };
}

describe('useCookAlong (jsdom, injected fakes)', () => {
  it('test-mode flow: start, alarm, settings, snooze re-fire, done, heads-up, shift, mode isolation', async () => {
    const f = makeFakes();
    const h = mount(fixturePlan, f.deps);
    expect(h.api.isTestMode).toBe(false);
    expect(h.api.started).toBe(false);
    expect(f.ticker().ms).toBe(1000);

    act(() => h.api.setTestClock(thu('08:40'), 60));
    expect(h.api.isTestMode).toBe(true);
    expect(h.api.now).toBe(thu('08:40'));
    expect(h.api.boardDay).toBe('thu');
    expect(f.ticker().ms).toBe(250);
    expect(h.api.alerts).toEqual([]);

    // start(): unlock is invoked synchronously (inside the gesture), before the other two.
    let p!: Promise<void>;
    act(() => {
      p = h.api.start();
      expect(f.player.unlock).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await p;
    });
    expect(f.log.filter((l) => !l.startsWith('st'))).toEqual(['unlock', 'notifPermission', 'wakeLock']);
    expect(h.api.started).toBe(true);
    expect(h.api.audio).toBe('running');
    expect(h.api.notifications).toBe('granted');
    expect(h.api.wakeLock).toBe('active');

    // 5 s real at 60x = 5 app-min -> 08:45 critical main.
    f.advance(5000);
    expect(h.api.now).toBe(thu('08:45'));
    expect(h.api.alerts.map((a) => a.key)).toEqual(['t-0845#main']);
    expect(f.player.start).toHaveBeenLastCalledWith('alarm', 'klaxon', 0.9);
    expect(f.shown).toEqual([{ tag: 't-0845#main', title: '⏰ 08:45 Traeger on 325', body: 'Traeger on 325' }]);
    expect(f.titles.at(-1)).toBe('⏰ (1) Traeger on 325');
    expect(h.api.statusOf('t-0845')).toBe('alerting');

    // Settings change applies to the playing alarm.
    act(() => h.api.updateSettings({ sound: 'bell', volume: 0.5 }));
    expect(f.player.start).toHaveBeenLastCalledWith('alarm', 'bell', 0.5);
    expect(f.player.setVolume).toHaveBeenLastCalledWith(0.5);

    // Snooze 5: gone (notification closed, sound stops), back exactly 5 app-min later as a new firing.
    act(() => h.api.snooze('t-0845', 5));
    expect(h.api.alerts).toEqual([]);
    expect(f.closed).toEqual(['t-0845#main']);
    expect(f.log.at(-1)).toBe('stop');
    expect(f.titles.at(-1)).toBe(idleTitle(fixturePlan)) // 'Fixture';
    expect(h.api.statusOf('t-0845')).toBe('snoozed');
    f.advance(4750); // 08:49:45
    expect(h.api.alerts).toEqual([]);
    f.advance(250); // 08:50:00
    expect(h.api.alerts.map((a) => a.firingId)).toEqual([`t-0845#main@${thu('08:50')}`]);
    expect(f.shown).toHaveLength(2);
    expect(f.player.start).toHaveBeenLastCalledWith('alarm', 'bell', 0.5);

    // Done persists to the TEST key only.
    act(() => h.api.done('t-0845'));
    expect(h.api.alerts).toEqual([]);
    expect(h.api.day.occ['t-0845'].doneAt).toBe(thu('08:50'));
    expect(f.deps.kv.get<DayState>(STORAGE_KEYS.day('fixture', 'test'))!.occ['t-0845'].doneAt).toBe(thu('08:50'));
    expect(f.deps.kv.get<DayState>(STORAGE_KEYS.day('fixture', 'real'))!.occ['t-0845']).toBeUndefined();

    // Hidden tab: no ticks; onResume catches up immediately.
    f.clock.real += 20_000; // 20 app-min -> 09:10
    act(() => f.resumeCbs.forEach((cb) => cb()));
    expect(h.api.now).toBe(thu('09:10'));
    expect(h.api.alerts.map((a) => a.key)).toEqual(['t-0915#heads']);
    expect(f.player.start).toHaveBeenLastCalledWith('headsUp', 'bell', 0.5);
    act(() => h.api.ackHeadsUp('t-0915'));
    expect(h.api.alerts).toEqual([]);

    // Running late on the Traeger lane: count + label; heads-up re-arms at the new time; undo.
    let n = 0;
    act(() => {
      n = h.api.shift(15, { kind: 'lane', lane: 'traeger' });
    });
    expect(n).toBe(2); // 09:15 turkey on, 12:45 off (10:15 oven turkey is tagged traeger but is not in the lane)
    expect(h.api.day.shiftLog.map((r) => r.label)).toEqual(['Traeger +15']);
    expect(h.api.occurrences.find((o) => o.occId === 't-0915')!.time).toBe(thu('09:30'));
    expect(h.api.nowNext.next?.occId).toBe('t-0915');
    expect(h.api.nowNext.nextInMs).toBe(20 * 60_000);
    f.advance(15_000); // 09:25
    expect(h.api.alerts.map((a) => a.key)).toEqual(['t-0915#heads']);
    act(() => h.api.undoShift());
    expect(h.api.day.shifts).toEqual({});
    expect(h.api.alerts.map((a) => a.key)).toEqual(['t-0915#main']); // 09:15 is due again at 09:25

    // Variant toggle.
    act(() => h.api.toggleVariant('late'));
    expect(h.api.isVariantActive('late')).toBe(true);
    expect(h.api.occurrences.some((o) => o.occId === 't-1230-fb')).toBe(true);
    act(() => h.api.toggleVariant('late'));

    // Speed change keeps the app clock continuous.
    const before = h.api.now;
    act(() => h.api.setTestSpeed(10));
    expect(h.api.now).toBe(before);
    f.advance(6000); // 6 s at 10x = 1 min
    expect(h.api.now).toBe(before + 60_000);

    // Back to the real clock: the real day state is untouched, ticker back to 1 s.
    act(() => h.api.setTestClock(null));
    expect(h.api.isTestMode).toBe(false);
    expect(h.api.day.occ).toEqual({});
    expect(f.ticker().ms).toBe(1000);
    act(() => h.api.resetTestState());
    expect(f.deps.kv.get<DayState>(STORAGE_KEYS.day('fixture', 'test'))!.occ).toEqual({});

    // Schedule spans are exposed per day.
    expect(h.api.spans.thu.some((s) => s.device === 'oven' && s.label === '425°F')).toBe(true);
    expect(Array.isArray(h.api.spans.wed)).toBe(true);
  });

  it('progress, clock and prefs survive a remount (reload)', () => {
    const backing = new MemStorage();
    const f1 = makeFakes(createKV(backing));
    const h1 = mount(fixturePlan, f1.deps);
    act(() => h1.api.setTestClock(thu('08:45'), 60));
    act(() => h1.api.done('t-0845'));
    act(() => h1.api.toggleCheck('quiche:ing:0'));
    h1.unmount();

    const f2 = makeFakes(createKV(backing));
    f2.clock.real = f1.clock.real; // reload happens "instantly"
    const h2 = mount(fixturePlan, f2.deps);
    expect(h2.api.isTestMode).toBe(true);
    expect(h2.api.now).toBe(thu('08:45'));
    expect(h2.api.day.occ['t-0845'].doneAt).toBe(thu('08:45'));
    expect(h2.api.statusOf('t-0845')).toBe('done');
    expect(h2.api.prefs.checks['quiche:ing:0']).toBe(true);
    expect(h2.api.storageOk).toBe(true);
  });

  it('works from memory when localStorage throws', () => {
    const f = makeFakes(createKV(new ThrowingStorage()));
    const h = mount(fixturePlan, f.deps);
    expect(h.api.storageOk).toBe(false);
    act(() => h.api.setTestClock(thu('08:45'), 60));
    expect(h.api.alerts.map((a) => a.key)).toEqual(['t-0845#main']);
    act(() => h.api.done('t-0845'));
    expect(h.api.alerts).toEqual([]);
    expect(h.api.day.occ['t-0845'].doneAt).toBe(thu('08:45'));
  });

  it('permission granted from the start: notifies before Start, once per firing, no re-notify on start()', async () => {
    const f = makeFakes(undefined, { perm: 'granted' });
    const h = mount(fixturePlan, f.deps);
    act(() => h.api.setTestClock(thu('08:45'), 60));
    expect(f.shown.map((s) => s.tag)).toEqual(['t-0845#main']); // backup notification even before Start
    expect(f.player.start).not.toHaveBeenCalled(); // sound waits for the gesture
    f.advance(250);
    f.advance(250);
    await act(async () => {
      await h.api.start();
    });
    expect(f.shown).toHaveLength(1);
    expect(f.player.start).toHaveBeenLastCalledWith('alarm', 'klaxon', 0.9);
  });

  it('late permission grant still notifies alerts that are already up', async () => {
    const f = makeFakes(); // permission 'default'
    const h = mount(fixturePlan, f.deps);
    act(() => h.api.setTestClock(thu('08:45'), 60));
    f.advance(250);
    expect(h.api.alerts.map((a) => a.key)).toEqual(['t-0845#main']);
    expect(f.shown).toEqual([]);
    await act(async () => {
      await h.api.start(); // grants permission
    });
    expect(f.shown.map((s) => s.tag)).toEqual(['t-0845#main']);
    f.advance(250);
    expect(f.shown).toHaveLength(1);
    // Granted via site settings while the tab was away: resume picks it up too.
    const g = makeFakes();
    const h2 = mount(fixturePlan, g.deps);
    act(() => h2.api.setTestClock(thu('08:45'), 60));
    expect(g.shown).toEqual([]);
    g.notif.perm = 'granted';
    act(() => g.resumeCbs.forEach((cb) => cb()));
    expect(g.shown.map((s) => s.tag)).toEqual(['t-0845#main']);
  });

  it("running late: 'all'/'lane' stay within today; 'tasks' can reach tomorrow", () => {
    const f = makeFakes();
    const h = mount(fixturePlan, f.deps);
    act(() => h.api.setTestClock(wed('10:30'), 60));
    let n = 0;
    act(() => {
      n = h.api.shift(15);
    });
    expect(n).toBe(5); // w-0900 (still up), w-1000, w-1100, w-1315, w-2100
    expect(Object.keys(h.api.day.shifts).every((id) => id.startsWith('w-'))).toBe(true);
    expect(h.api.day.shiftLog.at(-1)!.label).toBe('All +15');
    act(() => {
      n = h.api.shift(15, { kind: 'lane', lane: 'traeger' });
    });
    expect(n).toBe(0); // no Wednesday Traeger tasks; Thursday's are untouched
    expect(h.api.occurrences.filter((o) => o.day === 'thu').every((o) => o.shiftMin === 0)).toBe(true);
    act(() => {
      n = h.api.shift(-45, { kind: 'tasks', taskIds: ['t-0845', 't-0915'] }, 'Shift Traeger start −45 min');
    });
    expect(n).toBe(2);
    expect(h.api.occurrences.find((o) => o.occId === 't-0915')!.time).toBe(thu('08:30'));
  });

  it('turning a variant on aligns its added tasks with their anchors (one undoable record)', () => {
    const f = makeFakes();
    const h = mount(fixturePlan, f.deps);
    act(() => h.api.setTestClock(thu('09:00'), 60));
    act(() => void h.api.shift(15)); // 'All +15'
    act(() => h.api.setTestClock(thu('12:00'), 60));
    act(() => h.api.toggleVariant('late'));
    expect(h.api.isVariantActive('late')).toBe(true);
    expect(h.api.day.shiftLog.map((r) => r.label)).toEqual(['All +15', 'Fallback aligned to earlier shifts']);
    expect(h.api.occurrences.find((o) => o.occId === 't-1230-fb')!.time).toBe(thu('12:45'));
    // Turning it off and on again does not double-shift.
    act(() => h.api.toggleVariant('late'));
    act(() => h.api.toggleVariant('late'));
    expect(h.api.occurrences.find((o) => o.occId === 't-1230-fb')!.time).toBe(thu('12:45'));
    expect(h.api.day.shiftLog).toHaveLength(2);
  });

  it('test mode auto-exits at the cutoff: load path', () => {
    // Rehearsal started Wed 08:00 (real), page reopened at 08:31 (real): back on the real clock.
    const backing = new MemStorage();
    const kv = createKV(backing);
    kv.set(STORAGE_KEYS.clock, { mode: 'test', baseReal: wedReal('08:00'), baseApp: thu('06:55'), speed: 60 });
    kv.set(STORAGE_KEYS.day('thanksgiving-2026', 'test'), { version: 1, occ: { 'thu-0700': { doneAt: thu('07:00') } } });
    const f = makeFakes(kv, { real: wedReal('08:31') });
    const h = mount(realPlan, f.deps);
    expect(h.api.isTestMode).toBe(false);
    expect(h.api.testAutoExitAt).toBeNull();
    expect(h.api.now).toBe(wedReal('08:31'));
    expect(kv.get<{ mode: string }>(STORAGE_KEYS.clock)).toEqual({ mode: 'real' });
    expect(kv.get<DayState>(STORAGE_KEYS.day('thanksgiving-2026', 'test'))!.occ['thu-0700']).toBeDefined(); // rehearsal progress kept
    // Before the cutoff the same config stays in test mode.
    const kv2 = createKV(new MemStorage());
    kv2.set(STORAGE_KEYS.clock, { mode: 'test', baseReal: wedReal('08:00'), baseApp: thu('06:55'), speed: 60 });
    const h2 = mount(realPlan, makeFakes(kv2, { real: wedReal('08:29') }).deps);
    expect(h2.api.isTestMode).toBe(true);
    expect(h2.api.testAutoExitAt).toBe(wedReal('08:30'));
  });

  it('test mode auto-exits at the cutoff: tick path', () => {
    const f = makeFakes(undefined, { real: wedReal('08:00') });
    const h = mount(realPlan, f.deps);
    act(() => h.api.setTestClock(thu('06:55'), 60));
    expect(h.api.isTestMode).toBe(true);
    expect(h.api.testAutoExitAt).toBe(wedReal('08:30'));
    f.advance(29 * 60_000 + 59_000); // real 08:29:59
    expect(h.api.isTestMode).toBe(true);
    f.advance(1000); // real 08:30:00
    expect(h.api.isTestMode).toBe(false);
    expect(h.api.now).toBe(wedReal('08:30'));
    expect(f.ticker().ms).toBe(1000);
    // A rehearsal started after Wednesday's cutoff runs until Thursday's (06:30).
    act(() => h.api.setTestClock(thu('06:55'), 60));
    expect(h.api.testAutoExitAt).toBe(thuReal('06:30'));
  });

  it('60x through all of Thursday (real plan) via the hook: one notification per firing, empty at the end', () => {
    const f = makeFakes();
    const h = mount(realPlan, f.deps);
    act(() => void h.api.start());
    act(() => h.api.setTestClock(zonedToEpoch('2026-11-26', '06:55'), 60));
    const end = zonedToEpoch('2026-11-26', '15:10');
    const kinds = new Set<string>();
    let maxStack = 0;
    while (h.api.now < end) {
      f.advance(250); // 15 app-seconds
      maxStack = Math.max(maxStack, h.api.alerts.length);
      const front = h.api.alerts[0];
      if (front) {
        kinds.add(front.type);
        act(() => (front.type === 'main' ? h.api.done(front.occ.occId) : h.api.ackHeadsUp(front.occ.occId)));
      }
    }
    expect(h.api.now).toBe(end);
    expect(h.api.alerts).toEqual([]);
    const thursday = h.api.occurrences.filter((o) => o.day === 'thu');
    const withHeads = thursday.filter((o) => (o.task.headsUpMin ?? 0) > 0);
    const tags = f.shown.map((s) => s.tag);
    expect(new Set(tags).size).toBe(tags.length); // never twice for the same firing
    expect(tags.filter((t) => t.endsWith('#main'))).toHaveLength(thursday.length);
    expect(tags.filter((t) => t.endsWith('#heads'))).toHaveLength(withHeads.length);
    expect(thursday.every((o) => h.api.statusOf(o.occId) === 'done')).toBe(true);
    expect(f.closed.sort()).toEqual([...tags].sort()); // every notification closed again
    expect(f.titles.at(-1)).toBe(idleTitle(realPlan)) // '🦃 Thanksgiving 2026';
    expect(f.log.at(-1)).toBe('stop');
    expect(maxStack).toBeGreaterThan(1);
    expect(f.player.start.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['alarm', 'gentle', 'headsUp']));
  });
});

describe('useCookAlong: several plans side by side', () => {
  it('progress and recipe checks are per plan; settings and the clock are global', () => {
    const backing = new MemStorage();
    const f1 = makeFakes(createKV(backing));
    const h1 = mount(fixturePlan, f1.deps);
    act(() => h1.api.setTestClock(thu('08:45'), 60));
    act(() => h1.api.done('t-0845'));
    act(() => h1.api.toggleCheck('quiche:ing:0'));
    act(() => h1.api.updateSettings({ sound: 'bell' }));
    h1.unmount();
    expect(JSON.parse(backing.getItem('tg:v1:day:fixture:test')!).occ['t-0845']).toBeDefined();
    expect(JSON.parse(backing.getItem('tg:v1:prefs:fixture')!).checks).toEqual({ 'quiche:ing:0': true });
    expect(JSON.parse(backing.getItem('tg:v1:prefs')!)).toEqual({ version: 1, settings: { sound: 'bell', volume: 0.9, headsUpEnabled: true } });

    const f2 = makeFakes(createKV(backing));
    f2.clock.real = f1.clock.real;
    const h2 = mount(roastPlan, f2.deps);
    expect(h2.api.isTestMode).toBe(true); // clock is global
    expect(h2.api.day.occ).toEqual({}); // progress is not
    expect(h2.api.prefs.checks).toEqual({});
    expect(h2.api.prefs.settings.sound).toBe('bell');
    act(() => h2.api.setTestClock(sun('11:00'), 60));
    act(() => h2.api.done('r-1100'));
    expect(JSON.parse(backing.getItem('tg:v1:day:roast:test')!).occ['r-1100']).toBeDefined();
    expect(JSON.parse(backing.getItem('tg:v1:day:fixture:test')!).occ['r-1100']).toBeUndefined();
  });

  it('uses the plan zone, unit and days (Europe/London, °C, one day)', () => {
    const f = makeFakes(undefined, { perm: 'granted' });
    const h = mount(roastPlan, f.deps);
    act(() => h.api.setTestClock(sun('11:00'), 60));
    expect(h.api.boardDay).toBe('sun');
    expect(f.shown.map((n) => n.title)).toEqual(['⏰ 11:00 Oven to 200°C']);
    expect(Object.keys(h.api.spans)).toEqual(['sun']);
    expect(h.api.spans.sun.find((x) => x.device === 'oven' && x.kind === 'setting')!.label).toBe('200°C');
    expect(h.api.board.map((b) => b.device)).toEqual(['oven', 'air-fryer']);
    expect(h.api.testAutoExitAt).toBe(sun('10:30')); // cutoff from this plan's only day
    let n = 0;
    act(() => {
      n = h.api.shift(10, { kind: 'lane', lane: 'air-fryer' });
    });
    expect(n).toBe(4);
    expect(h.api.day.shiftLog.at(-1)!.label).toBe('Fryer +10');
    expect(f.titles.at(-1)).toBe('⏰ (1) Oven to 200°C');
  });

  it('old single-plan progress shows up under the Thanksgiving plan', () => {
    const backing = new MemStorage();
    backing.setItem('tg:v1:day:real', JSON.stringify({ version: 1, occ: { 'thu-0700': { doneAt: 1 } }, shifts: {}, shiftLog: [], activeVariants: [] }));
    backing.setItem('tg:v1:prefs', JSON.stringify({ version: 1, settings: { sound: 'triple-beep', volume: 0.7, headsUpEnabled: true }, checks: { 'gravy:ing:0': true }, setupChecklistDismissed: true }));
    const h = mount(realPlan, makeFakes(createKV(backing)).deps);
    expect(realPlan.id).toBe('thanksgiving-2026');
    expect(h.api.day.occ['thu-0700']).toEqual({ doneAt: 1 });
    expect(h.api.prefs.checks).toEqual({ 'gravy:ing:0': true });
    expect(h.api.prefs.setupChecklistDismissed).toBe(true);
    expect(h.api.prefs.settings.sound).toBe('triple-beep');
    // Another plan does not inherit it.
    const h2 = mount(roastPlan, makeFakes(createKV(backing)).deps);
    expect(h2.api.day.occ).toEqual({});
    expect(h2.api.prefs.checks).toEqual({});
  });
});
