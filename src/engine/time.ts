/**
 * Wall-clock <-> epoch conversion for the plan's time zone (any IANA zone), done with Intl so
 * DST is handled by the platform's tz database (never a fixed offset). Every engine/store caller
 * passes `plan.timeZone` explicitly; the default exists only for back-compat.
 */
import type { Day, Plan, PlanDay } from '../data/types';

/** Back-compat default only. Pass `plan.timeZone`. */
export const DEFAULT_TZ = 'America/New_York';
export const MINUTE_MS = 60_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
}

function zonedParts(epoch: number, timeZone: string): ZonedParts {
  const out: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, weekday: '' };
  for (const p of formatterFor(timeZone).formatToParts(new Date(epoch))) {
    switch (p.type) {
      case 'year': out.year = Number(p.value); break;
      case 'month': out.month = Number(p.value); break;
      case 'day': out.day = Number(p.value); break;
      case 'hour': out.hour = Number(p.value) % 24; break; // some engines emit '24' for midnight
      case 'minute': out.minute = Number(p.value); break;
      case 'second': out.second = Number(p.value); break;
      case 'weekday': out.weekday = p.value; break;
      default: break;
    }
  }
  return out;
}

/** Offset of `timeZone` from UTC at instant `epoch`, in ms (NY winter = -5h). */
function tzOffsetMs(epoch: number, timeZone: string): number {
  const p = zonedParts(epoch, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const wholeSecond = Math.floor(epoch / 1000) * 1000;
  return asUTC - wholeSecond;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'HH:MM' or 'H:MM' -> minutes since midnight; NaN when malformed. */
export function parseHHMM(hhmm: string): number {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(hhmm ?? '');
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
}

/** minutes since midnight -> 'HH:MM' */
export function minutesToHHMM(mins: number): string {
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

/**
 * 'YYYY-MM-DD' + 'HH:MM' local to `timeZone` -> epoch ms. DST-correct.
 * Ambiguous fall-back times (01:30 on the fall-back day) resolve to the FIRST instance
 * (daylight time); skipped spring-forward times resolve forward by the gap.
 * Returns NaN for malformed input.
 */
export function zonedToEpoch(dateISO: string, hhmm: string, timeZone: string = DEFAULT_TZ): number {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO ?? '');
  const mins = parseHHMM(hhmm);
  if (!dm || Number.isNaN(mins)) return NaN;
  const guess = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Math.floor(mins / 60), mins % 60);
  const off1 = tzOffsetMs(guess, timeZone);
  let result = guess - off1;
  const off2 = tzOffsetMs(result, timeZone);
  if (off2 !== off1) {
    const alt = guess - off2;
    // Use whichever candidate actually renders as the requested wall time; for a skipped
    // (spring-forward) time neither does, so keep the later reading.
    const altOff = tzOffsetMs(alt, timeZone);
    result = altOff === off2 ? alt : Math.max(result, alt);
  }
  return result;
}

/** epoch -> parts in `timeZone`. */
export function epochToZoned(
  epoch: number,
  timeZone: string = DEFAULT_TZ,
): { dateISO: string; hhmm: string; hh: number; mm: number; ss: number; weekday: string } {
  const p = zonedParts(epoch, timeZone);
  return {
    dateISO: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`,
    hhmm: `${pad2(p.hour)}:${pad2(p.minute)}`,
    hh: p.hour,
    mm: p.minute,
    ss: p.second,
    weekday: p.weekday,
  };
}

/** epoch -> 'HH:MM' (24h) in `timeZone` (pass plan.timeZone). */
export function formatHHMM(epoch: number, timeZone: string = DEFAULT_TZ): string {
  if (!Number.isFinite(epoch)) return '--:--';
  return epochToZoned(epoch, timeZone).hhmm;
}

/**
 * ms -> 'H:MM:SS' when >= 1h, else 'MM:SS'. Negative -> '-MM:SS' (overdue).
 * Positive values round UP to the second (a countdown never shows 00:00 while time remains);
 * overdue values round down.
 */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--';
  const overdue = ms < 0;
  const total = overdue ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  return overdue && total > 0 ? `-${body}` : body;
}

function dayIndex(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** plan.days sorted by date (the contract says they are; don't rely on it). */
export function sortedDays(plan: Plan): PlanDay[] {
  return (plan.days ?? []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The plan day whose date is `now`'s date in the plan's zone, else null. */
export function currentPlanDay(plan: Plan, now: number): Day | null {
  const { dateISO } = epochToZoned(now, plan.timeZone);
  return (plan.days ?? []).find((d) => d.date === dateISO)?.id ?? null;
}

/**
 * The plan day for an app time: exact date match, else the nearest day (before the first day ->
 * first, after the last -> last, in a gap -> the closer one, ties to the earlier). '' if the plan has no days.
 */
export function boardDay(plan: Plan, now: number): Day {
  const exact = currentPlanDay(plan, now);
  if (exact) return exact;
  const days = sortedDays(plan);
  if (days.length === 0) return '';
  const today = dayIndex(epochToZoned(now, plan.timeZone).dateISO);
  let best = days[0];
  let bestDist = Infinity;
  for (const d of days) {
    const dist = Math.abs(dayIndex(d.date) - today);
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best.id;
}
