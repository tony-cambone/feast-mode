/** Day-progress and prefs reducers + defensive migration of stored JSON. Reducers never mutate. */
import type { DayAction, DayState, OccState, Prefs, PrefsAction, Settings, ShiftRecord, SoundId } from './types';

export const SOUND_IDS: readonly SoundId[] = ['klaxon', 'triple-beep', 'bell'];

export const DEFAULT_SETTINGS: Settings = { sound: 'klaxon', volume: 0.9, headsUpEnabled: true };

export function initialDayState(): DayState {
  return { version: 1, occ: {}, shifts: {}, shiftLog: [], activeVariants: [] };
}

export function initialPrefs(): Prefs {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, checks: {}, setupChecklistDismissed: false };
}

function setOcc(state: DayState, occId: string, next: OccState): DayState {
  const occ = { ...state.occ };
  if (Object.keys(next).length === 0) delete occ[occId];
  else occ[occId] = next;
  return { ...state, occ };
}

function addDeltas(shifts: Record<string, number>, deltas: Record<string, number>, sign: 1 | -1): Record<string, number> {
  const out = { ...shifts };
  for (const [occId, d] of Object.entries(deltas)) {
    if (!Number.isFinite(d)) continue;
    const total = (out[occId] ?? 0) + sign * d;
    if (total === 0) delete out[occId];
    else out[occId] = total;
  }
  return out;
}

export function dayReducer(state: DayState, action: DayAction): DayState {
  switch (action.type) {
    case 'done': {
      const { snoozedUntil: _drop, ...rest } = state.occ[action.occId] ?? {};
      return setOcc(state, action.occId, { ...rest, doneAt: action.at });
    }
    case 'undone': {
      const prev = state.occ[action.occId];
      if (!prev || prev.doneAt === undefined) return state;
      const { doneAt: _drop, ...rest } = prev;
      return setOcc(state, action.occId, rest);
    }
    case 'snooze': {
      const prev = state.occ[action.occId] ?? {};
      return setOcc(state, action.occId, { ...prev, snoozedUntil: action.until });
    }
    case 'ackHeadsUp': {
      const prev = state.occ[action.occId] ?? {};
      if (prev.headsUpAckFor === action.forTime) return state;
      return setOcc(state, action.occId, { ...prev, headsUpAckFor: action.forTime });
    }
    case 'applyShift': {
      const { record } = action;
      const ids = Object.keys(record.deltas);
      if (ids.length === 0) return state;
      // A shifted occurrence's new time replaces any pending snooze (else a snooze past the new time hides it).
      let occ = state.occ;
      for (const id of ids) {
        const prev = occ[id];
        if (prev?.snoozedUntil === undefined) continue;
        if (occ === state.occ) occ = { ...state.occ };
        const { snoozedUntil: _drop, ...rest } = prev;
        if (Object.keys(rest).length) occ[id] = rest;
        else delete occ[id];
      }
      return { ...state, occ, shifts: addDeltas(state.shifts, record.deltas, 1), shiftLog: [...state.shiftLog, record] };
    }
    case 'undoShift': {
      const last = state.shiftLog[state.shiftLog.length - 1];
      if (!last) return state;
      return { ...state, shifts: addDeltas(state.shifts, last.deltas, -1), shiftLog: state.shiftLog.slice(0, -1) };
    }
    case 'resetShifts':
      if (Object.keys(state.shifts).length === 0 && state.shiftLog.length === 0) return state;
      return { ...state, shifts: {}, shiftLog: [] };
    case 'toggleVariant': {
      const on = state.activeVariants.includes(action.variantId);
      return {
        ...state,
        activeVariants: on
          ? state.activeVariants.filter((v) => v !== action.variantId)
          : [...state.activeVariants, action.variantId],
      };
    }
    case 'reset':
      return initialDayState();
    default:
      return state;
  }
}

function sanitizeSettings(base: Settings, patch: Partial<Settings>): Settings {
  const out = { ...base };
  if (patch.sound !== undefined && SOUND_IDS.includes(patch.sound)) out.sound = patch.sound;
  if (typeof patch.volume === 'number' && Number.isFinite(patch.volume)) out.volume = Math.min(1, Math.max(0, patch.volume));
  if (typeof patch.headsUpEnabled === 'boolean') out.headsUpEnabled = patch.headsUpEnabled;
  return out;
}

export function prefsReducer(prefs: Prefs, action: PrefsAction): Prefs {
  switch (action.type) {
    case 'settings':
      return { ...prefs, settings: sanitizeSettings(prefs.settings, action.patch ?? {}) };
    case 'toggleCheck': {
      const checks = { ...prefs.checks };
      if (checks[action.key]) delete checks[action.key];
      else checks[action.key] = true;
      return { ...prefs, checks };
    }
    case 'dismissChecklist':
      return prefs.setupChecklistDismissed ? prefs : { ...prefs, setupChecklistDismissed: true };
    default:
      return prefs;
  }
}

/* ---------------- migration (never throws) ---------------- */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function numberRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, n] of Object.entries(v)) if (isNum(n) && n !== 0) out[k] = n;
  return out;
}

function occRecord(v: unknown): Record<string, OccState> {
  const out: Record<string, OccState> = {};
  if (!isObj(v)) return out;
  for (const [k, raw] of Object.entries(v)) {
    if (!isObj(raw)) continue;
    const s: OccState = {};
    if (isNum(raw.doneAt)) s.doneAt = raw.doneAt;
    if (isNum(raw.snoozedUntil)) s.snoozedUntil = raw.snoozedUntil;
    if (isNum(raw.headsUpAckFor)) s.headsUpAckFor = raw.headsUpAckFor;
    if (Object.keys(s).length) out[k] = s;
  }
  return out;
}

function shiftLog(v: unknown): ShiftRecord[] {
  if (!Array.isArray(v)) return [];
  const out: ShiftRecord[] = [];
  for (const r of v) {
    if (!isObj(r)) continue;
    out.push({ at: isNum(r.at) ? r.at : 0, label: typeof r.label === 'string' ? r.label : '', deltas: numberRecord(r.deltas) });
  }
  return out;
}

/** Validate unknown JSON from storage; fill defaults; never throw. */
export function migrateDayState(raw: unknown): DayState {
  try {
    if (!isObj(raw)) return initialDayState();
    if (raw.version !== undefined && raw.version !== 1) return initialDayState();
    return {
      version: 1,
      occ: occRecord(raw.occ),
      shifts: numberRecord(raw.shifts),
      shiftLog: shiftLog(raw.shiftLog),
      activeVariants: Array.isArray(raw.activeVariants)
        ? [...new Set(raw.activeVariants.filter((x): x is string => typeof x === 'string'))]
        : [],
    };
  } catch {
    return initialDayState();
  }
}

export function migratePrefs(raw: unknown): Prefs {
  try {
    if (!isObj(raw)) return initialPrefs();
    if (raw.version !== undefined && raw.version !== 1) return initialPrefs();
    const settings = sanitizeSettings(DEFAULT_SETTINGS, isObj(raw.settings) ? (raw.settings as Partial<Settings>) : {});
    const checks: Record<string, boolean> = {};
    if (isObj(raw.checks)) for (const [k, v] of Object.entries(raw.checks)) if (v === true) checks[k] = true;
    return { version: 1, settings, checks, setupChecklistDismissed: raw.setupChecklistDismissed === true };
  } catch {
    return initialPrefs();
  }
}

/* ---------------- prefs storage split (settings global, checks per plan) ---------------- */

export interface StoredSettings {
  version: 1;
  settings: Settings;
}
export interface StoredPlanPrefs {
  version: 1;
  checks: Record<string, boolean>;
  setupChecklistDismissed: boolean;
}

/** Prefs -> what goes under the global key and what goes under the plan's key. */
export function splitPrefs(p: Prefs): { global: StoredSettings; plan: StoredPlanPrefs } {
  return {
    global: { version: 1, settings: p.settings },
    plan: { version: 1, checks: p.checks, setupChecklistDismissed: p.setupChecklistDismissed },
  };
}

/** Stored global settings + stored per-plan prefs (both unknown JSON) -> Prefs. Never throws. */
export function joinPrefs(globalRaw: unknown, planRaw: unknown): Prefs {
  const g = migratePrefs(globalRaw);
  const p = migratePrefs(planRaw);
  return { version: 1, settings: g.settings, checks: p.checks, setupChecklistDismissed: p.setupChecklistDismissed };
}
