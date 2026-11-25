# Plan your holiday feast with an AI

For busy home chefs cooking a big meal for a crowd: Thanksgiving, Christmas, Easter,
Passover, Hanukkah, Friendsgiving, Lunar New Year, a big family birthday. A plan is
**make-ahead days plus the big day**, worked backwards from the moment you serve.

Copy everything below the line into ChatGPT, Claude or any AI chat. Fill in the
"MY EVENT" block first. Save the JSON the AI gives you as `my-plan.json`, check it
with `npm run check-plan -- my-plan.json`, then load it in the app.

---

## MY EVENT (fill this in)

- Holiday / event name:
- Date(s) (YYYY-MM-DD): the big day, plus any make-ahead days you want (e.g. the day before)
- Time zone (e.g. America/Chicago, Europe/London):
- Serving time on the big day (24-hour, e.g. 16:00):
- Number of guests:
- Temperature unit (F or C):
- Equipment I own, and how many ovens (oven, stove/hob, grill, smoker, slow cooker, air fryer, ...):
- Menu (paste the recipes or links; say which dishes are bought, not cooked):
- Already done ahead (so you can skip it):
- Anything else (dietary rules, the earliest I can start, who helps, ...):

---

## INSTRUCTIONS FOR THE AI

You are building a minute-by-minute holiday cooking plan for a cook-along web app.
The plan is ONE JSON file. Work backwards from the serving time so everything is
hot and ready together. **The oven is the bottleneck:** lay out its schedule first
(one temperature at a time, with step-downs between dishes), then fit the stove,
slow cooker, grill and fridge around it. Move anything that can be made ahead to
an earlier day, and use the slow cooker or a cooler to hold finished dishes. If something essential is missing (serving time, equipment,
menu), ask at most 3 short clarifying questions first. Otherwise reply with ONE
```json code block containing the full plan, then at most 5 bullet points of
assumptions. No other text.

### Top-level fields

- `id` (required): short slug, e.g. `"friendsgiving-2026"`.
- `title` (required), `subtitle`, `emoji` (optional).
- `timeZone` (required): IANA name, e.g. `"America/New_York"`.
- `tempUnit`: `"F"` (default) or `"C"`. Every numeric temperature uses it.
- `days` (required): `[{ "id": "sat", "date": "2026-11-28", "label": "Sat 11/28 · Prep" }]`.
  `id` is a short slug with no spaces. List days in date order.
- `devices` (required): the equipment that gets a temperature or a dial, in
  display order: `[{ "id": "oven", "label": "Oven" }, { "id": "air-fryer", "label": "Air fryer", "short": "Air fryer" }]`.
- `tasks` (required): every timed step (see below).
- `recipes` (required): recipe cards (see below).
- `fallbacks`, `variants`, `probeTargets`, `setupChecklist`: optional.

### Tasks

```
{ "id": "sat-1100", "day": "sat", "time": "11:00", "title": "Short title (about 40 chars)",
  "details": "Full instruction. **Bold** the key action.",
  "equipment": ["oven"], "recipeIds": ["gravy"], "fallbackIds": ["problem-1"],
  "devices": [ ...device actions... ],
  "headsUpMin": 5, "critical": true, "alert": "modal",
  "repeatEveryMin": 30, "repeatUntil": "13:30" }
```

- `id` is unique: day plus time, e.g. `"sat-1100"`. `time` is 24-hour `"HH:MM"`.
- Keep tasks in time order within each day. Write clock times in text as `HH:MM`.
- `critical: true` for anything that can burn, overcook or undercook, or that
  must not be missed (loading and unloading hot devices, resting, serving).
  `critical: false` for easy reminders.
- `alert: "quiet"` only for a low-priority reminder with no sound.
- `headsUpMin: 5` on EVERY task that loads or unloads a device, and on preheats.
- Stirring, basting or any repeat: ONE task with `repeatEveryMin` and `repeatUntil`.
- Put make-ahead work (desserts, sauces, mashed potatoes, assembling casseroles,
  dry-brining) on earlier days: one `days` entry per make-ahead day plus the big day.
- `recipeIds` link a task to its recipe cards.

### Device actions (what a task does to a device)

```
"devices": [{ "device": "oven", "unload": "all", "set": 350,
              "load": [{ "id": "sat-oven-pie", "label": "Apple pie", "forMin": 55 }] }]
```

- `device` must be an id from the top-level `devices`.
- `set`: a number (temperature in `tempUnit`) or a dial label (`"LOW"`, `"MED"`,
  `"HIGH"`, `"WARM"`). `"OFF"` turns the device off and clears it.
- `load`: items going in. Each needs a plan-wide unique `id` (prefix it with the
  day and device), a short `label`, and `forMin` (expected minutes inside).
- `unload`: `"all"` or a list of earlier load ids. Order inside one task is
  unload, then set, then load.
- EVERY device must end EVERY day set to `"OFF"`: add `{ "device": "...", "set": "OFF" }`
  to the last task that uses it.
- One device per step: a task that touches two cooking devices (say oven AND grill)
  is dragged along when only one lane runs late. Write one task per device, at the
  same time if needed, so "running late" moves each lane on its own. (Setting a
  pot down on the stove while starting a slow cooker is the one acceptable pair.)
- Bastes, rotations and checks that change no device need only `equipment` tags.
- An oven holds one temperature at a time: plan the step-downs (for example 425,
  then 375, then 350) and unload before lowering the heat.

### Recipes

```
{ "id": "gravy", "name": "Gravy", "yield": "Serves 8", "when": "Make ahead",
  "ingredients": [ { "heading": "Roux" }, "4 tbsp butter", "4 tbsp flour" ],
  "steps": [ "Melt the butter.", "**Whisk** in the flour." ], "notes": ["Optional notes."] }
```

One ingredient or step per string. `{ "heading": "..." }` makes a sub-heading.

### Fallbacks and probe targets

- `fallbacks`: `[{ "id": "late", "title": "Roast not at temp", "body": ["Advice."],
  "relatedTaskIds": ["sat-1100"],
  "actions": [{ "kind": "shiftLane", "lane": "oven", "minutes": 15, "label": "Oven +15 min" }] }]`.
  Action kinds: `shiftLane` (a device id), `shiftTasks` (a `taskIds` list), `variant`.
  Link tasks back with `fallbackIds`.
- `probeTargets`: safe internal temperatures as `[{ "label": "Chicken thigh", "temp": 75 }]`
  in `tempUnit` (for example poultry 165 F / 74 C; ground meat 160 F / 71 C; check
  your local food-safety guidance). Add a note telling me to verify them.

### Output checks before you answer

1. Every `recipeIds`, `fallbackIds`, `relatedTaskIds` and `device` id exists.
2. Every id is unique (tasks, recipes, load items).
3. Every device ends each day `"OFF"`; every `unload` id was loaded earlier that day.
4. Tasks are in time order; times are `"HH:MM"`; dates are `"YYYY-MM-DD"`.
5. The output is valid JSON (no comments, no trailing commas).

### Tiny valid example

```json
{
  "id": "example",
  "title": "Tiny Example",
  "timeZone": "America/Chicago",
  "tempUnit": "F",
  "days": [{ "id": "sun", "date": "2026-11-29", "label": "Sun 11/29" }],
  "devices": [{ "id": "oven", "label": "Oven" }],
  "tasks": [
    { "id": "sun-1000", "day": "sun", "time": "10:00", "title": "Oven to 350°F", "details": "Preheat the oven to **350°F**.", "equipment": ["oven"], "critical": true, "headsUpMin": 5, "devices": [{ "device": "oven", "set": 350 }] },
    { "id": "sun-1015", "day": "sun", "time": "10:15", "title": "Casserole in", "details": "Casserole into the oven, 40 min.", "recipeIds": ["casserole"], "critical": true, "headsUpMin": 5, "devices": [{ "device": "oven", "load": [{ "id": "sun-oven-casserole", "label": "Casserole", "forMin": 40 }] }] },
    { "id": "sun-1055", "day": "sun", "time": "10:55", "title": "Casserole out · oven off", "details": "Casserole out when bubbling. **Oven off.**", "critical": true, "headsUpMin": 5, "devices": [{ "device": "oven", "unload": "all", "set": "OFF" }] }
  ],
  "recipes": [
    { "id": "casserole", "name": "Casserole", "ingredients": ["1 dish of casserole"], "steps": ["Bake at 350°F for 40 min."] }
  ]
}
```
