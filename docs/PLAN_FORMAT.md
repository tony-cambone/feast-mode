# Plan format

A plan is one JSON file that lays out a big holiday meal (Thanksgiving, Christmas, Easter, Passover, Hanukkah, Friendsgiving, Lunar New Year, ...) as **make-ahead days plus the big day**, with every oven, stove and slow-cooker step timed back from serving. Examples: `plans/thanksgiving-2026.json` (two days, five devices) and `plans/christmas-dinner.json` (Christmas Eve prep plus Christmas Day).

 The JSON Schema is `plans/plan.schema.json`; add
`"$schema": "./plan.schema.json"` at the top of a file in `plans/` for editor help. Check any file with:

```
npm run check-plan -- plans/my-plan.json
```

To have an AI write one for you, use [MENU_PROMPT.md](MENU_PROMPT.md).

## Top level

| Field | Type | Required | Notes / example |
|---|---|---|---|
| `id` | string | yes | Slug that namespaces saved progress: `"thanksgiving-2026"` |
| `title` | string | yes | `"Thanksgiving 2026"` |
| `subtitle` | string | no | `"Example plan: prime rib dinner for 8"` |
| `emoji` | string | no | `"🦃"` |
| `timeZone` | string | yes | IANA zone: `"America/New_York"`, `"Europe/London"` |
| `tempUnit` | `"F"` or `"C"` | no (default `"F"`) | Unit of every numeric temperature |
| `days` | Day[] | yes, at least 1 | In date order |
| `devices` | Device[] | yes (may be empty) | Board and lane order |
| `tasks` | Task[] | yes | In time order within each day |
| `recipes` | Recipe[] | yes (may be empty) | |
| `fallbacks` | Fallback[] | no | "Problems?" panel |
| `variants` | Variant[] | no | Used by `variant` fallback actions |
| `probeTargets` | ProbeTarget[] | no | `{ "label": "Turkey breast", "temp": 160, "note": "..." }` |
| `setupChecklist` | string[] | no | One-time banner |
| `theme` | `{ "accent": "#d97706" }` | no | CSS colour |

## Day

`{ "id": "wed", "date": "2026-11-25", "label": "Wed 11/25 · Prep" }`. All three required. `id` has no spaces; `date` is `YYYY-MM-DD`.

## Device

`{ "id": "air-fryer", "label": "Air fryer", "short": "Air fryer", "icon": "🍟" }`. `id` and `label` required; `short` (chips, buttons) and `icon` (one emoji) optional.

## Task

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique, e.g. `"thu-1200"` |
| `day` | string | yes | A `days[].id` |
| `time` | string | yes | 24-hour `"HH:MM"` |
| `title` | string | yes | Short, about 40 characters |
| `details` | string | no | Shown in the alert; `**bold**` supported |
| `equipment` | string[] | no | Tags: device ids or `"fridge"`, `"counter"`. Counts as a lane only when `devices` is absent |
| `devices` | DeviceAction[] | no | What the task does to devices; these are the task's lanes |
| `recipeIds` | string[] | no | Recipe links |
| `fallbackIds` | string[] | no | "Problems?" links |
| `alert` | `"modal"` or `"quiet"` | no (default modal) | Quiet = no sound or full screen |
| `headsUpMin` | number, 0 or more | no | Pre-alert; use 5 on every load/unload. `0` means no heads-up (used by a variant override to switch off a task's heads-up) |
| `critical` | boolean | no | Red, loud |
| `repeatEveryMin` | number > 0 | no | e.g. `30` for stirring |
| `repeatUntil` | `"HH:MM"` | no | Inclusive; not before `time` |

## DeviceAction

`{ "device": "oven", "unload": "all", "set": 350, "load": [{ "id": "thu-oven-pie", "label": "Pie", "forMin": 55 }] }`

- `device` (required): a `devices[].id`.
- `set`: a number (degrees in `tempUnit`) or a dial string (`"LOW"`, `"MED-HIGH"`, `"WARM"`). `"OFF"` clears the device.
- `unload`: `"all"` or an array of load ids loaded earlier that day.
- `load`: `{ id, label, forMin? }`. `id` is unique across the whole plan.
- Applied in the order unload, set, load.

## Recipe

`{ "id", "name", "yield"?, "when"?, "ingredients": [], "steps": [], "notes"?: [] }`. `ingredients` and `steps` hold strings or `{ "heading": "Topping" }`.

## Fallback

`{ "id", "title", "body": ["paragraph"], "relatedTaskIds": [], "actions": [] }`. Action kinds:

- `{ "kind": "variant", "label": "...", "variantId": "..." }`
- `{ "kind": "shiftLane", "label": "...", "lane": "traeger", "minutes": 15 }` (lane is a device id; negative = earlier)
- `{ "kind": "shiftTasks", "label": "...", "taskIds": ["thu-0915"], "minutes": -45 }`

## Variant

`{ "id", "label", "override"?, "remove"?, "add"?, "anchors"? }`

- `override`: `{ "taskId": { ...fields to replace } }`.
- `remove`: task ids hidden while active.
- `add`: extra tasks (ids ending `-fb` by convention).
- `anchors`: `{ "addedTaskId": "taskId" }`; an added task inherits its anchor's running-late shift.
- JSON cannot express "unset a field". To switch a heads-up off in an override, set `"headsUpMin": 0`.

## Errors (block loading)

- Not an object, wrong type, or missing required field (at the path named).
- Duplicate id: day, device, task, recipe, load item, fallback, variant, or added task.
- `time` / `repeatUntil` not `HH:MM`; `date` not a real `YYYY-MM-DD`.
- `timeZone` not a valid IANA zone.
- `task.day` not in `days`; `devices[].device` or `shiftLane.lane` not a device id.
- Dangling `recipeIds`, `fallbackIds`, `relatedTaskIds`, `variantId`, `shiftTasks` ids, override keys, `remove` ids, `anchors`.
- `repeatUntil` before `time`.

## Warnings (still loads)

- A device is not `OFF` at the end of a day (checked for the base plan and each variant).
- An `unload` id that was never loaded that day.
- Tasks out of time order within a day.
- A task that loads or unloads without `headsUpMin`.
- A day with no tasks.
