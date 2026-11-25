/**
 * Small hand-written plan for engine unit tests (independent of src/data/plan.ts).
 * Test-only; never imported by app code.
 */
import type { Plan, Task } from '../data/types';
import { buildOccurrences, resolveTasks } from './plan';
import { zonedToEpoch } from './time';
import type { DayState, Occurrence } from './types';

const tasks: Task[] = [
  // ---- Wednesday
  { id: 'w-0900', day: 'wed', time: '09:00', title: 'Morning check', critical: true },
  {
    id: 'w-1000', day: 'wed', time: '10:00', title: 'Oven 400 · sweet potatoes in',
    equipment: ['oven'],
    devices: [{ device: 'oven', set: 400, load: [{ id: 'w-sp', label: 'Sweet potatoes', forMin: 60 }] }],
  },
  {
    id: 'w-1100', day: 'wed', time: '11:00', title: 'Sweet potatoes out · oven off',
    equipment: ['oven'],
    devices: [{ device: 'oven', unload: ['w-sp'], set: 'OFF' }],
  },
  { id: 'w-1315', day: 'wed', time: '13:15', title: 'Quiche to fridge', alert: 'quiet', equipment: ['fridge'] },
  { id: 'w-2100', day: 'wed', time: '21:00', title: 'Bedtime fridge check', critical: true },
  // ---- Thursday
  {
    id: 't-0845', day: 'thu', time: '08:45', title: 'Traeger on 325', critical: true,
    equipment: ['traeger'], devices: [{ device: 'traeger', set: 325 }],
  },
  {
    id: 't-0915', day: 'thu', time: '09:15', title: 'Turkey on the Traeger', critical: true, headsUpMin: 5,
    equipment: ['traeger'],
    devices: [{ device: 'traeger', load: [{ id: 't-trturkey', label: '19.4 lb turkey', forMin: 210 }] }],
  },
  {
    id: 't-1000', day: 'thu', time: '10:00', title: 'Oven to 425', critical: true, headsUpMin: 5,
    equipment: ['oven'], devices: [{ device: 'oven', set: 425 }],
  },
  {
    id: 't-1015', day: 'thu', time: '10:15', title: 'Turkey into oven', critical: true, headsUpMin: 5,
    equipment: ['oven', 'traeger'],
    devices: [{ device: 'oven', load: [{ id: 't-ovturkey', label: '15.6 lb turkey', forMin: 105 }] }],
  },
  {
    id: 't-1100', day: 'thu', time: '11:00', title: 'Potatoes into slow cooker', critical: true,
    devices: [{ device: 'slowcooker', set: 'LOW', load: [{ id: 't-mash', label: 'Mashed potatoes' }] }],
  },
  { id: 't-1105', day: 'thu', time: '11:05', title: 'Rotate oven turkey', equipment: ['oven'], critical: false },
  {
    id: 't-stir', day: 'thu', time: '11:30', title: 'Stir potatoes', equipment: ['slowcooker'], critical: false,
    repeatEveryMin: 30, repeatUntil: '12:30',
  },
  {
    id: 't-1200', day: 'thu', time: '12:00', title: 'Turkey out · 375 · stuffing in', critical: true, headsUpMin: 5,
    equipment: ['oven'],
    devices: [
      {
        device: 'oven', unload: 'all', set: 375,
        load: [
          { id: 't-stuff1', label: 'Stuffing pan 1', forMin: 55 },
          { id: 't-stuff2', label: 'Stuffing pan 2', forMin: 55 },
        ],
      },
    ],
  },
  { id: 't-1215', day: 'thu', time: '12:15', title: 'Mushrooms out', alert: 'quiet', equipment: ['counter'] },
  {
    id: 't-1220', day: 'thu', time: '12:20', title: 'Light the grill', critical: true, headsUpMin: 5,
    equipment: ['grill'], devices: [{ device: 'grill', set: 375 }],
  },
  {
    id: 't-1235', day: 'thu', time: '12:35', title: 'Mushrooms on grill', critical: true, headsUpMin: 5,
    equipment: ['grill'],
    devices: [{ device: 'grill', load: [{ id: 't-mush', label: 'Stuffed mushrooms', forMin: 20 }] }],
  },
  {
    id: 't-1245', day: 'thu', time: '12:45', title: 'Traeger turkey off', critical: true, headsUpMin: 5,
    equipment: ['traeger'], devices: [{ device: 'traeger', unload: 'all', set: 'OFF' }],
  },
  {
    id: 't-1255', day: 'thu', time: '12:55', title: 'Stuffing out · casseroles in · grill off', critical: true, headsUpMin: 5,
    equipment: ['oven', 'grill'],
    devices: [
      {
        device: 'oven', unload: 'all', set: 350,
        load: [
          { id: 't-sweet', label: 'Sweet potato casserole', forMin: 40 },
          { id: 't-green', label: 'Green bean casserole', forMin: 30 },
        ],
      },
      { device: 'grill', unload: 'all', set: 'OFF' },
    ],
  },
  {
    id: 't-1335', day: 'thu', time: '13:35', title: 'Casseroles out · oven off', critical: true,
    equipment: ['oven'], devices: [{ device: 'oven', unload: 'all', set: 'OFF' }],
  },
];

export const fixturePlan: Plan = {
  id: 'fixture',
  title: 'Fixture',
  timeZone: 'America/New_York',
  tempUnit: 'F',
  days: [
    { id: 'wed', date: '2026-11-25', label: 'Wed' },
    { id: 'thu', date: '2026-11-26', label: 'Thu' },
  ],
  devices: [
    { id: 'oven', label: 'Oven' },
    { id: 'traeger', label: 'Traeger' },
    { id: 'grill', label: 'Propane grill', short: 'Grill' },
    { id: 'slowcooker', label: 'Slow cooker' },
    { id: 'stove', label: 'Stove' },
  ],
  tasks,
  recipes: [],
  fallbacks: [],
  variants: [
    {
      id: 'late',
      label: 'Oven turkey late',
      remove: ['t-1105'],
      anchors: { 't-1230-fb': 't-1200' },
      override: { 't-1200': { title: 'Turkey stays in', devices: [], headsUpMin: undefined } },
      add: [
        {
          id: 't-1230-fb', day: 'thu', time: '12:30', title: 'Turkey out (late)', critical: true,
          equipment: ['oven'], devices: [{ device: 'oven', unload: 'all', set: 350 }],
        },
      ],
    },
  ],
  probeTargets: [],
  setupChecklist: [],
};

/** Thursday (or Wednesday) local time in the fixture's zone -> epoch. */
export const NY = 'America/New_York';
export const thu = (hhmm: string) => zonedToEpoch('2026-11-26', hhmm, NY);
export const wed = (hhmm: string) => zonedToEpoch('2026-11-25', hhmm, NY);

/**
 * Second, minimal fixture for the generic paths: one day, °C, Europe/London (BST, UTC+1 in July),
 * devices ['oven', 'air-fryer'], a repeat, a quiet task, an equipment-only lane task, and none of
 * the optional arrays (fallbacks / variants / probeTargets / setupChecklist).
 */
export const LONDON = 'Europe/London';
export const roastPlan: Plan = {
  id: 'roast',
  title: 'Sunday roast',
  emoji: '🍗',
  timeZone: LONDON,
  tempUnit: 'C',
  days: [{ id: 'sun', date: '2026-07-12', label: 'Sun 12 Jul' }],
  devices: [
    { id: 'oven', label: 'Oven' },
    { id: 'air-fryer', label: 'Air fryer', short: 'Fryer' },
  ],
  tasks: [
    {
      id: 'r-1100', day: 'sun', time: '11:00', title: 'Oven to 200°C', critical: true, headsUpMin: 5,
      devices: [{ device: 'oven', set: 200 }],
    },
    {
      id: 'r-1115', day: 'sun', time: '11:15', title: 'Chicken in', critical: true, headsUpMin: 5,
      devices: [{ device: 'oven', load: [{ id: 'chicken', label: 'Chicken', forMin: 90 }] }],
    },
    {
      id: 'r-1200', day: 'sun', time: '12:00', title: 'Potatoes in the air fryer', critical: true, headsUpMin: 5,
      devices: [{ device: 'air-fryer', set: 180, load: [{ id: 'potatoes', label: 'Potatoes', forMin: 25 }] }],
    },
    {
      id: 'r-shake', day: 'sun', time: '12:15', title: 'Shake the basket', equipment: ['air-fryer', 'counter'],
      repeatEveryMin: 5, repeatUntil: '12:20',
    },
    {
      id: 'r-1245', day: 'sun', time: '12:45', title: 'Chicken out · fryer off', critical: true, headsUpMin: 5,
      devices: [
        { device: 'oven', unload: 'all', set: 'OFF' },
        { device: 'air-fryer', unload: 'all', set: 'OFF' },
      ],
    },
    { id: 'r-1250', day: 'sun', time: '12:50', title: 'Rest the chicken', alert: 'quiet', equipment: ['counter'] },
    { id: 'r-1300', day: 'sun', time: '13:00', title: 'Serve', critical: true },
  ],
  recipes: [],
};
export const sun = (hhmm: string) => zonedToEpoch('2026-07-12', hhmm, LONDON);
export const MIN = 60_000;

export function occsFor(state: DayState, plan: Plan = fixturePlan): Occurrence[] {
  return buildOccurrences(plan, resolveTasks(plan, state.activeVariants), state.shifts);
}

export function occById(occs: Occurrence[], occId: string): Occurrence {
  const o = occs.find((x) => x.occId === occId);
  if (!o) throw new Error(`no occurrence ${occId}`);
  return o;
}
