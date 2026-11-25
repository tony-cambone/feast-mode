/**
 * UI formatting helpers. Nothing here knows about a particular plan: times are formatted with
 * the engine helpers in the plan's time zone, temperatures with the plan's unit, and device
 * names come from plan.devices.
 */
import { OFF, dayById, deviceById, equipmentLabel, formatSetting, isDevice } from '../data/types';
import type { Day, DeviceSetting, Equipment, Plan, Task } from '../data/types';
import { epochToZoned, formatCountdown, formatHHMM, zonedToEpoch } from '../engine';
import type { BoardItem, DeviceStatus, Occurrence } from '../engine/types';

export const MIN = 60_000;

/** 'HH:MM' (24h) in the plan's zone. */
export const fmtHHMM = (epoch: number, tz: string): string => formatHHMM(epoch, tz);

/** Header clock: hours:minutes plus a separate seconds part. */
export function fmtClock(epoch: number, tz: string): { hm: string; ss: string } {
  if (!Number.isFinite(epoch)) return { hm: '--:--', ss: '--' };
  const z = epochToZoned(epoch, tz);
  return { hm: z.hhmm, ss: String(z.ss).padStart(2, '0') };
}

export const fmtCountdown = formatCountdown;
export const dateISOOf = (epoch: number, tz: string): string => epochToZoned(epoch, tz).dateISO;
export const toEpoch = (dateISO: string, hhmm: string, tz: string): number => zonedToEpoch(dateISO, hhmm, tz);

const dayFmts = new Map<string, Intl.DateTimeFormat>();
/** Short calendar date in the plan's zone and the browser's locale, e.g. 'Thu, Nov 26'. */
export function fmtDay(epoch: number, tz: string): string {
  if (!Number.isFinite(epoch)) return '';
  let f = dayFmts.get(tz);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
    try {
      f = new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz });
    } catch {
      f = new Intl.DateTimeFormat(undefined, opts);
    }
    dayFmts.set(tz, f);
  }
  return f.format(epoch);
}

export const dayLabel = (plan: Plan, day: Day): string => dayById(plan, day)?.label ?? day;
/** 'Wed 11/25 · Prep' -> 'Wed 11/25' (for compact buttons). */
export const dayShort = (plan: Plan, day: Day): string => dayLabel(plan, day).split(' · ')[0];

export const isOff = (s: DeviceSetting): boolean => s === OFF;
export const settingText = (plan: Plan, s: DeviceSetting): string => formatSetting(plan, s);
export const deviceName = (plan: Plan, id: Equipment, short = false): string => equipmentLabel(plan, id, short);
export const deviceIcon = (plan: Plan, id: Equipment): string | undefined => deviceById(plan, id)?.icon;

/**
 * 0..1 "how hot is this" for the board glow. Numbers scale between a warm hold and a hard
 * roast; dial labels are read loosely (LOW / MED / HIGH).
 */
export function heatOf(plan: Plan, s: DeviceSetting): number {
  if (s === OFF) return 0;
  if (typeof s === 'number') {
    const f = (plan.tempUnit ?? 'F') === 'C' ? (s * 9) / 5 + 32 : s;
    return Math.min(1, Math.max(0.2, (f - 140) / 360));
  }
  const t = s.toUpperCase();
  if (/MED/.test(t)) return /HIGH/.test(t) ? 0.75 : /LOW/.test(t) ? 0.45 : 0.6;
  if (/WARM|KEEP|LOW|SIMMER/.test(t)) return 0.3;
  if (/HIGH|MAX|SEAR|BROIL|BOIL|GRILL/.test(t)) return 0.9;
  return 0.6;
}

export interface Chip {
  key: string;
  device: Equipment;
  label: string;
  isDevice: boolean;
}
/** Equipment chips for a task: devices[] (with settings) first, then plain equipment tags. */
export function chipsFor(plan: Plan, task: Task): Chip[] {
  const out: Chip[] = [];
  const seen = new Set<string>();
  for (const a of task.devices ?? []) {
    if (seen.has(a.device)) continue;
    seen.add(a.device);
    const name = deviceName(plan, a.device);
    out.push({ key: a.device, device: a.device, isDevice: true, label: a.set !== undefined ? `${name} · ${settingText(plan, a.set)}` : name });
  }
  for (const e of task.equipment ?? []) {
    if (!e || e === 'none' || seen.has(e)) continue;
    seen.add(e);
    out.push({ key: e, device: e, isDevice: isDevice(plan, e), label: deviceName(plan, e) });
  }
  return out;
}

/** One compact equipment line for a task, e.g. 'Oven · 375°F'. */
export function equipLine(plan: Plan, task: Task): string | null {
  const acts = task.devices ?? [];
  const withSet = acts.find((a) => a.set !== undefined);
  if (withSet) return `${deviceName(plan, withSet.device)} · ${settingText(plan, withSet.set as DeviceSetting)}`;
  if (acts[0]) return deviceName(plan, acts[0].device);
  const e = (task.equipment ?? []).find((x) => x && x !== 'none');
  return e ? deviceName(plan, e) : null;
}

/** How long a loaded item has left: '38 min left', 'until 13:45', 'due out 12:00'. */
export function itemTiming(item: BoardItem, now: number, tz: string): { text: string; over: boolean } {
  if (item.until === undefined) return { text: `since ${fmtHHMM(item.since, tz)}`, over: false };
  const left = Math.ceil((item.until - now) / MIN);
  if (left <= 0) return { text: `due out ${fmtHHMM(item.until, tz)}`, over: true };
  if (left <= 90) return { text: `${left} min left`, over: false };
  return { text: `until ${fmtHHMM(item.until, tz)}`, over: false };
}

/** What happens next on a device: { time: '12:00', text: '375°F, Stuffing ×2 in' }. */
export function nextOn(plan: Plan, d: DeviceStatus): { time: string; text: string } | null {
  const n = d.next;
  if (!n) return null;
  const parts: string[] = [];
  if (n.set !== undefined) parts.push(settingText(plan, n.set));
  if (n.unload === 'all') parts.push('all out');
  else if (n.unload?.length) parts.push(`${n.unload.join(', ')} out`);
  if (n.load?.length) parts.push(`${n.load.join(', ')} in`);
  if (!parts.length) parts.push(n.occ.task.title);
  return { time: fmtHHMM(n.occ.time, plan.timeZone), text: parts.join(' · ') };
}

/** First line of details with ** stripped, for one-line previews. */
export function previewOf(details?: string): string {
  return (details ?? '').split('\n')[0].replace(/\*\*/g, '');
}

/** Same rule as the engine's lanesOf: device actions decide the lane, else device-tagged equipment. */
export function lanesOfTask(plan: Plan, task: Task): Equipment[] {
  const src = task.devices && task.devices.length > 0 ? task.devices.map((a) => a.device) : (task.equipment ?? []);
  return [...new Set(src)].filter((e) => isDevice(plan, e));
}

/** Start of the 30-minute window with the most tasks (earliest wins ties). `occs` sorted by time. */
export function busiestStart(occs: Occurrence[]): number | undefined {
  let best: number | undefined;
  let bestN = 0;
  for (let i = 0; i < occs.length; i++) {
    const t0 = occs[i].time;
    let n = 0;
    for (let j = i; j < occs.length && occs[j].time < t0 + 30 * MIN; j++) n++;
    if (n > bestN) {
      bestN = n;
      best = t0;
    }
  }
  return best;
}

export interface Jump {
  key: string;
  label: string;
  at: number;
}
/** Rehearsal quick-jumps: 5 min before each day's first task and before its busiest half hour. */
export function quickJumps(plan: Plan, occs: Occurrence[]): Jump[] {
  const out: Jump[] = [];
  for (const d of plan.days) {
    const dayOccs = occs.filter((o) => o.day === d.id);
    if (!dayOccs.length) continue;
    const name = dayShort(plan, d.id);
    const start = dayOccs[0].time - 5 * MIN;
    out.push({ key: `${d.id}-start`, label: `${name} start`, at: start });
    const busy = busiestStart(dayOccs);
    if (busy !== undefined && busy - 5 * MIN !== start) out.push({ key: `${d.id}-busy`, label: `${name} busiest`, at: busy - 5 * MIN });
  }
  return out;
}
