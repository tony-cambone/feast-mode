/**
 * ENGINE PUBLIC API (contract). Everything outside src/engine imports from here.
 * Implementations live in time.ts, clock.ts, plan.ts, alerts.ts, board.ts, shift.ts,
 * reducer.ts and storage.ts; this file only re-exports them. Contract signatures
 * (documented below) are unchanged; a few helpers are added at the bottom of each group.
 *
 * Rules: pure functions, no DOM, no Date.now() inside (time is always passed in),
 * all times are epoch ms on the APP clock. storage.ts is the only DOM-touching module.
 * Generic: days, devices, time zone and temperature unit all come from the Plan; nothing here
 * assumes Thanksgiving, particular devices, America/New_York or °F.
 */

export * from './types';

/* ---------------- time (any IANA zone; pass plan.timeZone) ----------------
 * zonedToEpoch(dateISO, hhmm, timeZone)   'YYYY-MM-DD' + 'HH:MM' local -> epoch ms, DST-correct via Intl.
 * epochToZoned(epoch, timeZone)           epoch -> { dateISO, hhmm, hh, mm, ss, weekday }.
 * formatHHMM(epoch, timeZone)             'HH:MM' (24h) in that zone.
 *   (timeZone defaults to DEFAULT_TZ only for back-compat; always pass plan.timeZone.)
 * formatCountdown(ms)                     'H:MM:SS' when >= 1h, else 'MM:SS'; negative -> '-MM:SS'.
 * boardDay(plan, now)                     plan.days id whose date is today (plan zone), else the nearest day.
 * currentPlanDay(plan, now)               that day id only on its date, else null.
 * Added: parseHHMM, minutesToHHMM, sortedDays(plan), DEFAULT_TZ, MINUTE_MS. */
export {
  zonedToEpoch,
  epochToZoned,
  formatHHMM,
  formatCountdown,
  boardDay,
  currentPlanDay,
  parseHHMM,
  minutesToHHMM,
  sortedDays,
  DEFAULT_TZ,
  MINUTE_MS,
} from './time';

/* ---------------- clock (real / test) ----------------
 * appNow(cfg, realNow), makeTestClock(appTime, speed, realNow), withSpeed(cfg, speed, realNow)
 * (keeps app time continuous; real mode stays real).
 * Added: tickIntervalMs(cfg) (250 ms when test speed > 1, else 1000), migrateClock(raw), DEFAULT_TEST_SPEED,
 * testAutoExitAt(cutoffs, cfg), shouldExitTestMode(cutoffs, cfg, realNow) (cutoff C with baseReal < C <= realNow). */
export {
  appNow,
  makeTestClock,
  withSpeed,
  tickIntervalMs,
  migrateClock,
  testAutoExitAt,
  shouldExitTestMode,
  DEFAULT_TEST_SPEED,
} from './clock';

/* ---------------- plan -> occurrences ----------------
 * resolveTasks(plan, activeVariants)       apply active variants (remove -> add -> override, in plan.variants order).
 * buildOccurrences(plan, tasks, shifts)    expand repeats, compute base/effective times with shifts, sort by (time, order).
 * lanesOf(task, plan | deviceIds)          "running late" lanes: the task's device actions when it has any,
 *                                          else its equipment tags that are plan device ids.
 * Added: inLane(task, lane), touchedEquipment(task) (display: equipment ∪ devices, used by the board's next),
 * testModeCutoffs(plan) (30 min before each plan day's first task), dayDates(plan), deviceIds(plan),
 * TEST_CUTOFF_LEAD_MIN, isRepeating, occIdFor, byTimeThenOrder, indexOccurrences. */
export {
  resolveTasks,
  buildOccurrences,
  lanesOf,
  inLane,
  touchedEquipment,
  testModeCutoffs,
  dayDates,
  deviceIds,
  TEST_CUTOFF_LEAD_MIN,
  isRepeating,
  occIdFor,
  byTimeThenOrder,
  indexOccurrences,
} from './plan';

/* ---------------- status, alerts, now/next ----------------
 * statusOf(occ, state, now)
 * getActiveAlerts(occs, state, now, headsUpEnabled)
 *   Active alert stack, front first. Pure derivation from state + now, so catch-up after
 *   a hidden tab / sleep is automatic: everything due and unacknowledged is returned.
 *   main: task.alert !== 'quiet', not done, now >= time, now - time < STALE_AFTER_MIN, not snoozed (snoozedUntil <= now or unset).
 *   headsUp: headsUpEnabled, task.headsUpMin, not done, time - headsUpMin <= now < time, headsUpAckFor !== time.
 *   Order: main before headsUp; critical before non-critical; then by occ.time, then order.
 * getQuietNotices(occs, state, now)        quiet tasks inside [time, time + QUIET_WINDOW_MIN) and not done.
 * getNowNext(plan, occs, state, now)
 * Added: pickAlarmKind(alerts) -> 'alarm' | 'gentle' | 'headsUp' | null, stripMarkdown, compareAlerts,
 * isQuiet, isDone, occStateOf, STALE_AFTER_MS, QUIET_WINDOW_MS. */
export {
  statusOf,
  getActiveAlerts,
  getQuietNotices,
  getNowNext,
  pickAlarmKind,
  stripMarkdown,
  compareAlerts,
  isQuiet,
  isDone,
  occStateOf,
  STALE_AFTER_MS,
  QUIET_WINDOW_MS,
} from './alerts';
export type { AlarmLevel } from './alerts';

/* ---------------- equipment board ----------------
 * getBoard(plan, occs, state, now)
 *   One entry per plan.devices (in order), derived from occurrences of boardDay(now): replay device actions whose
 *   event time <= now in (event time, time, order) order. Event time = occ.time, or doneAt if the
 *   occurrence was marked done before its time. Within a task: unload -> set -> load.
 *   set 'OFF' clears items. Devices start each day 'OFF' and empty.
 *   item.until = event time of the next later action on that device that unloads it (or 'all') or sets OFF,
 *   else since + forMin. next = first not-done occurrence (any day) with time > now touching the device.
 * Added: eventTimeOf(occ, state). */
export { getBoard, eventTimeOf } from './board';

/* ---------------- schedule (Gantt) spans ----------------
 * getDaySpans(plan, occs, day): DeviceSpan[]
 *   PLANNED timeline for that day, independent of now/progress. Replays the day's device actions at
 *   effective (shifted) occ.time in (time, order) order, unload -> set -> load.
 *   Setting spans: from a set until the next set with a different value (same value continues);
 *   OFF ends a span and creates none; still open at day end -> last event for that device + 30 min.
 *   Item spans: load -> the unload/OFF that removes it, else since + forMin, else that same day-end cap.
 *   label: '425°F' / '220°C' (plan.tempUnit) | 'LOW' for settings, the item label for items.
 * Added: getAllSpans(plan, occs) -> Record<dayId, DeviceSpan[]> for every plan day,
 * settingLabel(setting, unit), OPEN_SPAN_TAIL_MIN. */
export { getDaySpans, getAllSpans, settingLabel, OPEN_SPAN_TAIL_MIN } from './spans';

/* ---------------- running late ----------------
 * planShift(occs, state, now, minutes, scope, label)
 *   Build a ShiftRecord for every REMAINING occurrence in scope. Remaining = not done AND
 *   (time >= now OR status is 'alerting' | 'snoozed'). Returns deltas only (no mutation).
 * dayReducer's applyShift also clears snoozedUntil for every shifted occId.
 * Added: isRemaining, inScope, shiftLabel(minutes, scope, plan?) -> 'Oven +15' | 'All +15' | '4 tasks -45',
 * shiftCandidates(plan, occs, now, scope) ('all'/'lane' limited to boardDay(now); 'tasks' unrestricted),
 * alignVariantAnchors(plan, state, variantId, now) (added tasks inherit their anchor's shift). */
export {
  planShift,
  isRemaining,
  inScope,
  shiftLabel,
  shiftCandidates,
  alignVariantAnchors,
  ANCHOR_ALIGN_LABEL,
} from './shift';

/* ---------------- state ----------------
 * initialDayState(), initialPrefs(), dayReducer(state, action), prefsReducer(prefs, action),
 * migrateDayState(raw), migratePrefs(raw) (validate unknown JSON, fill defaults, never throw).
 * Added: DEFAULT_SETTINGS, SOUND_IDS, splitPrefs(prefs) / joinPrefs(globalRaw, planRaw)
 * (settings stored globally, recipe checks + checklist flag per plan). */
export {
  initialDayState,
  initialPrefs,
  dayReducer,
  prefsReducer,
  migrateDayState,
  migratePrefs,
  DEFAULT_SETTINGS,
  SOUND_IDS,
  splitPrefs,
  joinPrefs,
} from './reducer';
export type { StoredSettings, StoredPlanPrefs } from './reducer';

/* ---------------- storage (the one DOM-touching engine module) ----------------
 * STORAGE_KEYS, KV, createKV(backing?)   wraps window.localStorage in try/catch with an in-memory
 * fallback; pass a fake Storage in tests (null = memory only). Keys are namespaced per plan:
 * day(planId, mode), planPrefs(planId); clock, prefs (settings), plans, activePlan are global.
 * migrateLegacyStorage(kv): one-time copy of the single-plan keys into LEGACY_PLAN_ID. */
export { STORAGE_KEYS, LEGACY_PLAN_ID, createKV, migrateLegacyStorage } from './storage';
export type { KV } from './storage';
