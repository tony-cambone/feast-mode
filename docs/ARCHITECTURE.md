# Feast Mode architecture

A single-page React + TypeScript app (Vite, no backend) that runs a big meal from a JSON plan:
timeline, full-screen alarms, equipment board, Gantt, recipes. It runs from `localhost` in a
Chromium browser on a laptop on the counter. Plan authors start with [PLAN_FORMAT.md](PLAN_FORMAT.md).

## Module map

| Dir | What lives there |
|---|---|
| `plans/` | Bundled plans (`*.json`) and `plan.schema.json` |
| `src/data/` | `types.ts` (the plan format + helpers), `validate.ts` (`validatePlan`, dependency-free so `scripts/check-plan.ts` runs it under plain Node), `plan.ts` (loads and validates the bundled plans) |
| `src/engine/` | Pure logic, no DOM, no `Date.now()` (time is always passed in): `time`, `clock`, `plan`, `alerts`, `board`, `spans`, `shift`, `reducer`, and `storage` (the only DOM-touching module). `index.ts` is the public API |
| `src/app/` | `api.ts` (the contracts the UI renders: `CookAlongApi`, `PlanSourceApi`), `useCookAlong` (the store: clock, progress, ticker, every side effect), `usePlanSource` (bundled and imported plans) |
| `src/audio/` | Web Audio synth + alarm player |
| `src/platform/` | Notifications, wake lock, ticker, resume events, fullscreen. Each call is safe when the API is missing |
| `src/ui/` | React components. `PlanHost` owns the active plan and remounts the cook-along (`key` = plan id) on a switch |

## Data flow

```
plans/*.json | imported text ─► validatePlan ─► Plan
Plan ─► resolveTasks(plan, activeVariants)        variants: remove → add → override (null removes a field)
     ─► buildOccurrences(plan, tasks, shifts)     repeats expanded (`id@HH:MM`), shifts applied, sorted by (time, order)
     ─► getActiveAlerts · getQuietNotices · getNowNext · getBoard · getAllSpans   (pure: occurrences + DayState + now)
     ─► useCookAlong ─► CookAlongApi ─► ui
ui actions ─► dayReducer / prefsReducer ─► DayState / Prefs ─► kv (localStorage)
now = appNow(clock, realNow)   real clock, or test clock: baseApp + (realNow − baseReal) × speed
```

## Key decisions (and why)

- **Alerts are derived, not scheduled.** Each tick recomputes the whole stack from occurrences, state and
  `now`. Nothing is queued on timers, so catch-up after a hidden tab, sleep or reload comes for free, and
  several due alerts stack (front first: main before heads-up, critical first, then by time). Each firing has
  `firingId = key@dueAt`; a snooze expiry is a new firing. That id dedupes system notifications.
- **Stale cutoff** (`STALE_AFTER_MIN` = 360): a modal alert more than 6 h overdue stops alarming and shows as
  `missed`, so yesterday's prep never blasts at breakfast.
- **Alert levels.** A critical main alert → loud `alarm` (the chosen sound). A non-critical main alert → soft
  `gentle` chime. A heads-up (`[time − headsUpMin, time)`) → `headsUp` ding. `alert: "quiet"` → toast only.
  The loudest alert up decides the sound (`pickAlarmKind`). A heads-up ack stores the effective time, so
  shifting a task re-arms its heads-up.
- **Looped AudioBuffer.** Each pattern is rendered once into an `AudioBuffer` and looped by an
  `AudioBufferSourceNode`, so it keeps sounding when background timers are throttled. "Start my day"
  unlocks the `AudioContext` inside the click (autoplay policy). It also requests notification permission
  and the wake lock.
- **Worker ticker.** 1 s ticks (250 ms when the test clock runs faster than 1×) come from a Blob `Worker`,
  which escapes Chromium's intensive timer throttling, with a `setInterval` fallback. Becoming visible,
  gaining focus or `pageshow` re-ticks at once.
- **Backup notifications.** One per firing (`requireInteraction`). A firing counts as notified only if
  permission was granted at that moment, so a later grant still notifies what is up. Notifications close
  when the alert leaves the stack.
- **Test mode is isolated.** It keeps its own day state (`…:test`), so a rehearsal never touches real
  progress. **Auto-exit:** there is a cutoff 30 min before each plan day's first task. If a test clock was
  started before a cutoff, it hands back to the real clock once that cutoff passes. This is checked on load
  and on every tick, so a forgotten rehearsal can't swallow the real day. `fresh` rehearsals mark earlier
  tasks done.
- **Per-plan storage.** Progress and recipe checks are keyed by `plan.id`; settings and the clock are
  global. Pre-multi-plan keys are copied once into `thanksgiving-2026`. The copy never overwrites, and the
  old keys are kept.
- **Storage never throws.** `createKV` wraps every `localStorage` access, including the getter, and falls
  back to memory. `storageOk` drives a banner.
- **Lane membership** ("running late"): a task's device actions decide its lanes. Without actions, its
  equipment tags that are device ids decide. A "turkey in · baste the smoker bird" task with an oven action
  stays out of the smoker lane.
- **Shifts.** Only *remaining* occurrences move: not done, and either in the future or alerting/snoozed.
  The `all` and `lane` scopes stay within today's plan day; `tasks` is unrestricted. Each shift is one
  undoable `ShiftRecord`, and shifts are keyed by occurrence id. A shift clears `snoozedUntil` on what it
  moves, so an old snooze can't hide the new time.
- **Variant anchors.** Turning a variant on aligns each added task to its anchor's current shift (one
  undoable record), so a fallback stays in step with earlier "running late" taps.
- **Board vs. spans.** The board replays the current plan day's device actions up to `now`, in order
  unload → set → load. A task marked done early acts at `doneAt`. Spans replay the same actions as a
  planned timeline, independent of `now`.
- **Time** comes from `Intl` in `plan.timeZone` (DST-correct, never a fixed offset). Callers always pass
  the zone.

## Storage keys

| Key | Scope | Value |
|---|---|---|
| `tg:v1:clock` | global | `ClockConfig` (real, or test with base times + speed) |
| `tg:v1:prefs` | global | `{ version, settings }` (sound, volume, heads-up on/off) |
| `tg:v1:prefs:<planId>` | plan | `{ version, checks, setupChecklistDismissed }` |
| `tg:v1:day:<planId>:real` / `:test` | plan | `DayState`: done/snooze/ack per occurrence, shifts, shift log, active variants |
| `tg:v1:plans` | global | Imported plans `Record<planId, raw JSON>`, re-validated on load (invalid ones skipped) |
| `tg:v1:activePlan` | global | Active plan id. `?plan=<id>` overrides it for one load |
| `tg:v1:migrated:plans` | global | Marker: legacy `tg:v1:day:real\|test` + checks copied into `thanksgiving-2026` |
| `tg:ui:display` | global | Text size and theme (UI-owned) |

## Tests

```
npx vitest run                 # unit + simulations (jsdom where a file says so)
npx tsc --noEmit -p tsconfig.json
npm run e2e                    # Playwright, real Chrome, production build (~8.5 min at 60×; E2E_SPEED=300 is faster)
```

- **Unit tests** cover every engine module against two fixtures (`src/engine/testFixture.ts`): a two-day
  New York / °F plan, and a one-day Europe/London / °C plan with an `air-fryer`. That keeps the generic
  paths honest. `realPlan.test.ts` checks board spot-checks and planned spans against the bundled
  Thanksgiving plan. The hooks are tested in jsdom under `StrictMode` with injected fakes (kv, player,
  ticker, clock).
- **60× simulation.** The app clock steps 15 app-seconds per tick through a whole cook day, acknowledging
  the front alert each tick. It asserts:
  - every modal occurrence fires exactly once, in time order, never early;
  - every heads-up comes 5 min early;
  - the stack is empty at the end.

  It runs on the engine (base plan and a variant) and through the hook.
- **e2e** (`e2e/thursday.spec.ts`) seeds the clock config in localStorage, replaces `Notification` with a
  recorder, and reads `<html data-alarm>`. It covers the 60× day, snooze/Done/reload/keyboard,
  "running late" on a lane, and blocked storage.

## Adding a plan

1. Write `plans/<id>.json` (format: [PLAN_FORMAT.md](PLAN_FORMAT.md); AI prompt: [MENU_PROMPT.md](MENU_PROMPT.md)).
   Use a new `id`, because the id namespaces saved progress.
2. `npm run check-plan -- plans/<id>.json` until it has no errors. Read the warnings too: a device left on,
   or a load without a heads-up.
3. Bundle it: import it in `src/data/plan.ts` and add it to `RAW`. Or import it in the app (Plans drawer),
   which saves it in `tg:v1:plans`. An imported plan with a bundled id replaces that plan until removed.
4. Rehearse it in test mode at 60×.

## e2e test ids (contract)

| Test id / attribute | Element |
|---|---|
| `start-button` | "Start my day" |
| `alert-modal` + `data-alert-type="main\|headsUp"`, `data-occ-id` | Front alert |
| `alert-title`, `btn-done`, `btn-snooze-5`, `btn-snooze-10`, `btn-got-it` | Alert content and buttons |
| `now-panel`, `next-countdown` | Now / Next |
| `board-<device>` + `data-setting`, `data-device` | Equipment board card |
| `timeline`, `timeline-row-<occId>` + `data-status` (an `OccStatus`) | Day timeline |
| `test-mode-banner` | Shown while the test clock runs |
| `shift-all-15`, `shift-more`, `lane-<device>`, `shift-<lane>-<minutes>` | Running late bar and sheet |
| `plan-pick-<id>`, `plan-import-text`, `plan-import-submit`, `plan-import-errors` | Plans drawer |
| `<html data-alarm="alarm\|gentle\|headsUp\|off">` | Sound currently looping (set by the player) |

Keyboard: Space = Done (Got it on a heads-up), S / Shift+S = snooze 5 / 10, F = fullscreen, Esc = close.
