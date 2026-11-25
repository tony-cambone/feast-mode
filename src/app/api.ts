/**
 * STORE API (contract). The single object the UI consumes, returned by
 * `useCookAlong()` in src/app/useCookAlong.ts. Owner of the hook: engine agent.
 * Owner of everything that renders it: UI agent. Shapes are fixed.
 */
import type { Day, Plan } from '../data/types';
import type {
  ActiveAlert,
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
} from '../engine/types';
import type { AudioState } from '../audio';
import type { NotifPermission, WakeLockState } from '../platform';

export interface CookAlongApi {
  plan: Plan;
  /** App-clock now (fake clock in test mode). Updates every tick. */
  now: number;
  clock: ClockConfig;
  isTestMode: boolean;
  /** Real time at which test mode hands back to the real clock (30 min before a plan day's first task), or null. */
  testAutoExitAt: number | null;
  /** Day shown by default (date of `now`, or nearest plan day). */
  boardDay: Day;

  occurrences: Occurrence[]; // all days, sorted
  statusOf(occId: string): OccStatus;
  alerts: ActiveAlert[]; // front first; empty = no modal
  quietNotices: Occurrence[];
  nowNext: NowNext;
  board: DeviceStatus[];
  /** Planned device timeline per day for the Schedule (Gantt) view (shifts/variants applied; independent of now). */
  spans: Record<Day, DeviceSpan[]>;
  day: DayState;
  prefs: Prefs;

  /** Environment health, for banners. */
  storageOk: boolean;
  audio: AudioState;
  notifications: NotifPermission;
  wakeLock: WakeLockState;
  /** True after "Start my day" was pressed in this page load. */
  started: boolean;

  /* actions */
  /** "Start my day" click handler: unlock audio (plays test chirp), request notification permission, request wake lock. */
  start(): Promise<void>;
  /** Re-unlock audio from a gesture (banner button). */
  unlockAudio(): Promise<void>;
  done(occId: string): void;
  undone(occId: string): void;
  snooze(occId: string, minutes: 5 | 10): void;
  ackHeadsUp(occId: string): void;
  /** Running late. Returns the number of occurrences shifted. */
  shift(minutes: number, scope?: ShiftScope, label?: string): number;
  undoShift(): void;
  resetShifts(): void;
  toggleVariant(variantId: string): void;
  isVariantActive(variantId: string): boolean;
  toggleCheck(key: string): void;
  updateSettings(patch: Partial<Settings>): void;
  dismissChecklist(): void;
  previewSound(kind: 'alarm' | 'gentle' | 'headsUp'): void;
  /**
   * Enter/update test mode at `appTime` (epoch ms) and `speed`; pass null to return to the real clock.
   * `fresh`: wipe test progress, then mark every occurrence before `appTime` done, so a rehearsal
   * started mid-day doesn't stack (and sound) every earlier alert.
   */
  setTestClock(appTime: number | null, speed?: number, opts?: { fresh?: boolean }): void;
  setTestSpeed(speed: number): void;
  /** Wipe test-mode progress (never touches real progress). */
  resetTestState(): void;
  /** Wipe the current mode's progress. UI must confirm first. */
  resetDay(): void;
}


// Lanes offered in "Running late" are the plan's devices: plan.devices.map(d => d.id).

/**
 * PLAN SOURCE (contract). Which plan is active, and importing your own. Returned by
 * `usePlanSource()` in src/app/usePlanSource.ts (engine agent). The UI remounts the
 * cook-along with `key={plan.id}` when the active plan changes.
 */
export interface PlanSummary {
  id: string;
  title: string;
  emoji?: string;
  source: 'bundled' | 'imported';
}
export interface PlanSourceApi {
  plan: Plan; // active, validated
  available: PlanSummary[];
  activate(id: string): void;
  /** Validate JSON text; on success store it (replacing an imported plan with the same id) and activate it. */
  importPlan(text: string): { ok: true; plan: Plan; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };
  removeImported(id: string): void;
  /** Pretty-printed JSON of the active plan (for download / sharing). */
  exportActive(): string;
}

