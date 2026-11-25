import { afterEach, describe, expect, it } from 'vitest';
import { getActiveAlerts } from './alerts';
import { dayReducer, initialDayState, migrateDayState } from './reducer';
import { LEGACY_PLAN_ID, STORAGE_KEYS, createKV, migrateLegacyStorage } from './storage';
import { initialPrefs, joinPrefs, prefsReducer, splitPrefs } from './reducer';
import { occsFor, thu } from './testFixture';
import type { DayState } from './types';

class MemStorage implements Storage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
}

class ThrowingStorage extends MemStorage {
  override getItem(): string | null {
    throw new DOMException('blocked', 'SecurityError');
  }
  override setItem(): void {
    throw new DOMException('blocked', 'SecurityError');
  }
  override removeItem(): void {
    throw new DOMException('blocked', 'SecurityError');
  }
}

/** Accepts reads but any write throws QuotaExceededError (after an optional number of successes). */
class QuotaStorage extends MemStorage {
  constructor(private allowed: number) {
    super();
  }
  override setItem(k: string, v: string) {
    if (this.allowed-- <= 0) throw new DOMException('full', 'QuotaExceededError');
    super.setItem(k, v);
  }
}

/** App logic on top of a KV: load, mark done, persist, reload. */
function doneRoundTrip(kv: ReturnType<typeof createKV>): DayState {
  const key = STORAGE_KEYS.day('fixture', 'real');
  let s = migrateDayState(kv.get(key));
  s = dayReducer(s, { type: 'done', occId: 't-0845', at: thu('08:46') });
  kv.set(key, s);
  return migrateDayState(kv.get(key));
}

describe('createKV with a working Storage', () => {
  it('round-trips JSON values and persists to the backing store', () => {
    const backing = new MemStorage();
    const kv = createKV(backing);
    expect(kv.ok).toBe(true);
    expect(kv.set('k', { a: 1, b: [true] })).toBe(true);
    expect(kv.get('k')).toEqual({ a: 1, b: [true] });
    expect(JSON.parse(backing.getItem('k')!)).toEqual({ a: 1, b: [true] });
    expect(backing.getItem('tg:v1:__probe__')).toBeNull(); // probe cleans up
    // A second KV over the same storage sees it (i.e. survives a reload).
    expect(createKV(backing).get('k')).toEqual({ a: 1, b: [true] });
    kv.remove('k');
    expect(kv.get('k')).toBeUndefined();
    expect(backing.getItem('k')).toBeNull();
  });

  it('corrupt JSON reads as undefined (migrate then fills defaults)', () => {
    const backing = new MemStorage();
    backing.setItem(STORAGE_KEYS.day('fixture', 'real'), '{not json');
    const kv = createKV(backing);
    expect(kv.get(STORAGE_KEYS.day('fixture', 'real'))).toBeUndefined();
    expect(migrateDayState(kv.get(STORAGE_KEYS.day('fixture', 'real')))).toEqual(initialDayState());
  });

  it('Done persists across a simulated reload', () => {
    const backing = new MemStorage();
    doneRoundTrip(createKV(backing));
    const reloaded = migrateDayState(createKV(backing).get(STORAGE_KEYS.day('fixture', 'real')));
    expect(reloaded.occ['t-0845'].doneAt).toBe(thu('08:46'));
    expect(getActiveAlerts(occsFor(reloaded), reloaded, thu('08:50'), true).map((a) => a.key)).not.toContain('t-0845#main');
  });
});

describe('createKV when storage is unusable', () => {
  const realDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (realDescriptor) Object.defineProperty(globalThis, 'localStorage', realDescriptor);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('getItem/setItem throwing -> ok=false, app logic still works in memory', () => {
    const kv = createKV(new ThrowingStorage());
    expect(kv.ok).toBe(false);
    expect(kv.set('x', 1)).toBe(false);
    expect(kv.get('x')).toBe(1);
    expect(() => kv.remove('x')).not.toThrow();
    expect(kv.get('x')).toBeUndefined();
    expect(doneRoundTrip(kv).occ['t-0845'].doneAt).toBe(thu('08:46'));
  });

  it('the localStorage getter itself throwing -> ok=false, memory fallback', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    let kv!: ReturnType<typeof createKV>;
    expect(() => (kv = createKV())).not.toThrow();
    expect(kv.ok).toBe(false);
    expect(doneRoundTrip(kv).occ['t-0845'].doneAt).toBe(thu('08:46'));
  });

  it('no localStorage at all (undefined) or explicit null -> memory only', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    const kv = createKV();
    expect(kv.ok).toBe(false);
    kv.set('a', [1]);
    expect(kv.get('a')).toEqual([1]);
    const mem = createKV(null);
    expect(mem.ok).toBe(false);
    expect(doneRoundTrip(mem).occ['t-0845'].doneAt).toBe(thu('08:46'));
  });

  it('quota exceeded mid-session flips ok to false but keeps the latest value in memory', () => {
    const backing = new QuotaStorage(2); // probe + one real write succeed
    const kv = createKV(backing);
    expect(kv.ok).toBe(true);
    expect(kv.set('a', 1)).toBe(true);
    expect(kv.set('a', 2)).toBe(false);
    expect(kv.ok).toBe(false);
    expect(kv.get('a')).toBe(2); // memory wins over the stale stored value
  });

  it('unserializable values do not throw', () => {
    const kv = createKV(new MemStorage());
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(kv.set('c', cyclic)).toBe(false);
  });
});

describe('per-plan namespacing', () => {
  it('key formats', () => {
    expect(STORAGE_KEYS.day('sunday-roast', 'real')).toBe('tg:v1:day:sunday-roast:real');
    expect(STORAGE_KEYS.day('thanksgiving-2026', 'test')).toBe('tg:v1:day:thanksgiving-2026:test');
    expect(STORAGE_KEYS.planPrefs('sunday-roast')).toBe('tg:v1:prefs:sunday-roast');
    expect([STORAGE_KEYS.clock, STORAGE_KEYS.prefs, STORAGE_KEYS.plans, STORAGE_KEYS.activePlan]).toEqual([
      'tg:v1:clock', 'tg:v1:prefs', 'tg:v1:plans', 'tg:v1:activePlan',
    ]);
  });

  it('prefs split: settings global, checks + checklist flag per plan', () => {
    let p = prefsReducer(initialPrefs(), { type: 'toggleCheck', key: 'gravy:ing:0' });
    p = prefsReducer(p, { type: 'settings', patch: { sound: 'bell' } });
    p = prefsReducer(p, { type: 'dismissChecklist' });
    const { global, plan } = splitPrefs(p);
    expect(global).toEqual({ version: 1, settings: p.settings });
    expect(plan).toEqual({ version: 1, checks: { 'gravy:ing:0': true }, setupChecklistDismissed: true });
    expect(joinPrefs(JSON.parse(JSON.stringify(global)), JSON.parse(JSON.stringify(plan)))).toEqual(p);
    // Another plan: same settings, its own (empty) checks.
    expect(joinPrefs(global, undefined)).toEqual({ ...initialPrefs(), settings: p.settings });
  });
});

describe('migrateLegacyStorage (single-plan keys -> thanksgiving-2026)', () => {
  const legacyDay = { version: 1, occ: { 'thu-0700': { doneAt: 123 } }, shifts: { 'thu-1200': 15 }, shiftLog: [], activeVariants: [] };
  const legacyPrefs = { version: 1, settings: { sound: 'bell', volume: 0.5, headsUpEnabled: true }, checks: { 'gravy:ing:1': true }, setupChecklistDismissed: true };

  it('copies day state (both modes) and checks once, keeps settings global, never overwrites', () => {
    const backing = new MemStorage();
    backing.setItem('tg:v1:day:real', JSON.stringify(legacyDay));
    backing.setItem('tg:v1:day:test', JSON.stringify({ ...legacyDay, occ: {} }));
    backing.setItem('tg:v1:prefs', JSON.stringify(legacyPrefs));
    const kv = createKV(backing);
    expect(LEGACY_PLAN_ID).toBe('thanksgiving-2026');
    expect(migrateLegacyStorage(kv)).toBe(true);
    expect(kv.get(STORAGE_KEYS.day(LEGACY_PLAN_ID, 'real'))).toEqual(legacyDay);
    expect(migrateDayState(kv.get(STORAGE_KEYS.day(LEGACY_PLAN_ID, 'test'))).occ).toEqual({});
    expect(kv.get(STORAGE_KEYS.planPrefs(LEGACY_PLAN_ID))).toEqual({ version: 1, checks: { 'gravy:ing:1': true }, setupChecklistDismissed: true });
    expect(joinPrefs(kv.get(STORAGE_KEYS.prefs), kv.get(STORAGE_KEYS.planPrefs(LEGACY_PLAN_ID))).settings.sound).toBe('bell');
    // Runs once: later progress is never clobbered by the stale legacy copy.
    kv.set(STORAGE_KEYS.day(LEGACY_PLAN_ID, 'real'), { ...legacyDay, occ: {} });
    expect(migrateLegacyStorage(kv)).toBe(false);
    expect(createKV(backing).get(STORAGE_KEYS.day(LEGACY_PLAN_ID, 'real'))).toEqual({ ...legacyDay, occ: {} });
    // Old keys are left in place (harmless; a rollback still finds them).
    expect(backing.getItem('tg:v1:day:real')).not.toBeNull();
  });

  it('does not overwrite namespaced data that already exists; no legacy data = nothing to do', () => {
    const backing = new MemStorage();
    backing.setItem('tg:v1:day:real', JSON.stringify(legacyDay));
    backing.setItem(STORAGE_KEYS.day(LEGACY_PLAN_ID, 'real'), JSON.stringify(initialDayState()));
    const kv = createKV(backing);
    migrateLegacyStorage(kv);
    expect(kv.get(STORAGE_KEYS.day(LEGACY_PLAN_ID, 'real'))).toEqual(initialDayState());
    const fresh = createKV(new MemStorage());
    expect(migrateLegacyStorage(fresh)).toBe(false);
    expect(fresh.get(STORAGE_KEYS.day(LEGACY_PLAN_ID, 'real'))).toBeUndefined();
  });

  it('never throws, even with a hostile KV', () => {
    const evil = { ok: false, get: () => { throw new Error('x'); }, set: () => { throw new Error('y'); }, remove: () => {} };
    expect(() => migrateLegacyStorage(evil)).not.toThrow();
    expect(migrateLegacyStorage(createKV(new ThrowingStorage()))).toBe(false);
  });
});
