/**
 * The one DOM-touching engine module: a localStorage wrapper that never throws.
 * Every access is in try/catch (in some browsers merely reading `window.localStorage`
 * throws when storage is blocked). Writes always land in an in-memory map first, so the
 * app keeps working from memory when storage is missing, blocked, full or throwing.
 */

/**
 * Storage layout. Global: clock, settings (`prefs`), imported plans, active plan id.
 * Per plan: day progress per clock mode, and recipe checks + checklist-dismissed (`planPrefs`).
 */
export const STORAGE_KEYS = {
  clock: 'tg:v1:clock',
  /** Global settings: { version: 1, settings }. (Before per-plan storage it also held checks.) */
  prefs: 'tg:v1:prefs',
  /** Per-plan prefs: { version: 1, checks, setupChecklistDismissed }. */
  planPrefs: (planId: string) => `tg:v1:prefs:${planId}`,
  day: (planId: string, mode: 'real' | 'test') => `tg:v1:day:${planId}:${mode}`,
  /** Imported plans: Record<planId, raw JSON> (re-validated on load). */
  plans: 'tg:v1:plans',
  activePlan: 'tg:v1:activePlan',
  /** Pre-multi-plan keys, migrated once into LEGACY_PLAN_ID. */
  legacyDay: (mode: 'real' | 'test') => `tg:v1:day:${mode}`,
  legacyMigrated: 'tg:v1:migrated:plans',
} as const;

/** The plan that owned all progress before storage was namespaced per plan. */
export const LEGACY_PLAN_ID = 'thanksgiving-2026';

export interface KV {
  /** false when localStorage is missing/blocked/throwing; the app then runs from memory. */
  readonly ok: boolean;
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): boolean;
  remove(key: string): void;
}

const PROBE_KEY = 'tg:v1:__probe__';

function resolveBacking(backing: Storage | null | undefined): Storage | null {
  if (backing === null) return null;
  if (backing !== undefined) return backing;
  try {
    const g = globalThis as { localStorage?: Storage };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

function probe(store: Storage | null): boolean {
  if (!store) return false;
  try {
    store.setItem(PROBE_KEY, '1');
    const ok = store.getItem(PROBE_KEY) === '1';
    store.removeItem(PROBE_KEY);
    return ok;
  } catch {
    return false;
  }
}

/** Wraps window.localStorage in try/catch with an in-memory fallback. Pass a fake Storage in tests (null = memory only). */
export function createKV(backing?: Storage | null): KV {
  const store = resolveBacking(backing);
  let ok = probe(store);
  /** JSON text written (or read) this session; authoritative over the backing store. null = removed. */
  const memory = new Map<string, string | null>();

  const parse = <T>(text: string | null | undefined): T | undefined => {
    if (text === null || text === undefined) return undefined;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  };

  return {
    get ok() {
      return ok;
    },
    get<T>(key: string): T | undefined {
      if (memory.has(key)) return parse<T>(memory.get(key));
      if (!ok || !store) return undefined;
      try {
        const text = store.getItem(key);
        if (text !== null) memory.set(key, text);
        return parse<T>(text);
      } catch {
        return undefined;
      }
    },
    set(key: string, value: unknown): boolean {
      let text: string;
      try {
        text = JSON.stringify(value) ?? 'null';
      } catch {
        return false;
      }
      memory.set(key, text);
      if (!store) return false;
      try {
        store.setItem(key, text);
        ok = true;
        return true;
      } catch {
        ok = false;
        return false;
      }
    },
    remove(key: string): void {
      memory.set(key, null);
      if (!store) return;
      try {
        store.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * One-time migration from the single-plan layout: `tg:v1:day:real|test` -> the LEGACY_PLAN_ID
 * namespace, and the recipe checks / checklist flag inside the old `tg:v1:prefs` -> that plan's
 * prefs. Never overwrites data already in the new keys; leaves the old keys in place (harmless,
 * and a rollback still finds them); marks itself done so it runs once. Never throws.
 * Returns true when it migrated something.
 */
export function migrateLegacyStorage(kv: KV): boolean {
  try {
    if (kv.get(STORAGE_KEYS.legacyMigrated) === true) return false;
    let moved = false;
    for (const mode of ['real', 'test'] as const) {
      const old = kv.get<unknown>(STORAGE_KEYS.legacyDay(mode));
      const target = STORAGE_KEYS.day(LEGACY_PLAN_ID, mode);
      if (old !== undefined && kv.get(target) === undefined) {
        kv.set(target, old);
        moved = true;
      }
    }
    const oldPrefs = kv.get<Record<string, unknown>>(STORAGE_KEYS.prefs);
    const planPrefsKey = STORAGE_KEYS.planPrefs(LEGACY_PLAN_ID);
    if (
      oldPrefs &&
      typeof oldPrefs === 'object' &&
      ('checks' in oldPrefs || 'setupChecklistDismissed' in oldPrefs) &&
      kv.get(planPrefsKey) === undefined
    ) {
      kv.set(planPrefsKey, {
        version: 1,
        checks: oldPrefs.checks ?? {},
        setupChecklistDismissed: oldPrefs.setupChecklistDismissed === true,
      });
      moved = true;
    }
    kv.set(STORAGE_KEYS.legacyMigrated, true);
    return moved;
  } catch {
    return false;
  }
}
