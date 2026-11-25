/**
 * Engine contract. Pure data shapes shared by the engine, the store hook and the UI.
 * Owner: engine. Do not change shapes without telling the supervisor.
 */
import type { BoardDevice, Day, DeviceSetting, Task } from '../data/types';

/** One firing of a task. Repeating tasks expand into several occurrences. */
export interface Occurrence {
  /** task.id for single tasks; `${task.id}@HH:MM` (base HH:MM of that repetition) for repeats. */
  occId: string;
  task: Task; // variant overrides already applied
  day: Day;
  baseTime: number; // epoch ms from the plan (before shifts)
  shiftMin: number; // total shift applied to this occurrence
  time: number; // effective epoch ms = baseTime + shiftMin * 60_000
  order: number; // stable tiebreak (plan order)
}

/** Per-occurrence progress. All timestamps are APP-clock epoch ms (fake clock in test mode). */
export interface OccState {
  doneAt?: number;
  snoozedUntil?: number;
  /** Effective `time` of the occurrence when its heads-up was acknowledged. If the task is shifted later, the heads-up fires again. */
  headsUpAckFor?: number;
}

export interface ShiftRecord {
  at: number; // app time
  label: string; // 'Oven +15'
  deltas: Record<string, number>; // occId -> minutes added
}

/** Progress for one clock mode. Real and test mode are stored under separate keys so a rehearsal never touches the real day. */
export interface DayState {
  version: 1;
  occ: Record<string, OccState>;
  shifts: Record<string, number>; // occId -> total minutes
  shiftLog: ShiftRecord[]; // newest last; used for undo
  activeVariants: string[];
}

export type SoundId = 'klaxon' | 'triple-beep' | 'bell';

export interface Settings {
  sound: SoundId; // alarm for critical alerts
  volume: number; // 0..1
  headsUpEnabled: boolean;
}

/**
 * Shared across clock modes. Stored split: `settings` are global (tg:v1:prefs); `checks` and
 * `setupChecklistDismissed` belong to one plan (tg:v1:prefs:<planId>).
 */
export interface Prefs {
  version: 1;
  settings: Settings;
  checks: Record<string, boolean>; // `${recipeId}:ing:${i}` / `${recipeId}:step:${i}`
  setupChecklistDismissed: boolean;
}

export type ClockConfig =
  | { mode: 'real' }
  | { mode: 'test'; baseReal: number; baseApp: number; speed: number };

export type OccStatus =
  | 'done'
  | 'alerting' // main alert is up right now
  | 'snoozed'
  | 'upcoming'
  | 'quiet-now' // quiet task inside its notice window
  | 'missed'; // past, not done, no longer alerting (stale modal, or quiet task past its window)

export type AlertType = 'main' | 'headsUp';

export interface ActiveAlert {
  key: string; // `${occId}#main` | `${occId}#heads`
  type: AlertType;
  occ: Occurrence;
  critical: boolean;
  dueAt: number; // when this firing started (occ.time, snooze expiry, or time - headsUpMin)
  /** Unique per firing (`${key}@${dueAt}`); changes after a snooze expires. Dedupes notifications. */
  firingId: string;
}

export interface NowNext {
  /** Due, not done, not stale (alerting + snoozed + quiet-now), sorted by time. */
  current: Occurrence[];
  /** Latest occurrence with time <= now on the board day (any status), for "last started" context. */
  lastStarted?: Occurrence;
  /** Earliest not-done occurrence with time > now. */
  next?: Occurrence;
  nextInMs?: number;
  /** Up to 4 not-done occurrences after `next`. */
  upcoming: Occurrence[];
}

export interface BoardItem {
  id: string;
  label: string;
  since: number; // when it went in
  until?: number; // planned out time: a later unload/OFF on this device, else since + forMin
}

export interface DeviceStatus {
  device: BoardDevice;
  setting: DeviceSetting; // 'OFF' if never set today
  settingSince?: number;
  items: BoardItem[];
  /** Next not-done occurrence touching this device (devices[] or equipment[]), any day. */
  next?: {
    occ: Occurrence;
    set?: DeviceSetting;
    load?: string[]; // labels
    unload?: string[] | 'all'; // labels or 'all'
  };
}

/**
 * One bar on the planned Schedule (Gantt) view: a device setting or an item in a device,
 * from getDaySpans(). Planned timeline only (effective/shifted times, independent of now/progress).
 */
export interface DeviceSpan {
  device: BoardDevice;
  kind: 'setting' | 'item';
  label: string; // settings: '425°F' | 'LOW'; items: the item label
  setting?: DeviceSetting; // kind 'setting' only
  start: number;
  end: number;
  occId: string; // occurrence that started it
  endOccId?: string; // occurrence that ended it (absent when capped by forMin / end of day)
}

export type DayAction =
  | { type: 'done'; occId: string; at: number }
  | { type: 'undone'; occId: string }
  | { type: 'snooze'; occId: string; until: number }
  | { type: 'ackHeadsUp'; occId: string; forTime: number }
  | { type: 'applyShift'; record: ShiftRecord }
  | { type: 'undoShift' }
  | { type: 'resetShifts' }
  | { type: 'toggleVariant'; variantId: string }
  | { type: 'reset' };

export type PrefsAction =
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'toggleCheck'; key: string }
  | { type: 'dismissChecklist' };

/** Shift scope for "running late". */
export type ShiftScope = { kind: 'all' } | { kind: 'lane'; lane: BoardDevice } | { kind: 'tasks'; taskIds: string[] };

/** Tunables. */
export const STALE_AFTER_MIN = 360; // a modal alert older than this stops alarming and shows as 'missed'
export const QUIET_WINDOW_MIN = 15; // quiet tasks show a toast for this long
