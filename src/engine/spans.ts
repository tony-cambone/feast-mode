/**
 * Planned device timeline for the Schedule (Gantt) view. Unlike the board this ignores
 * `now` and progress: it replays the day's device actions at effective (shifted) times.
 */
import type { Day, DeviceSetting, Plan } from '../data/types';
import { OFF } from '../data/types';
import { byTimeThenOrder, deviceIds } from './plan';
import { MINUTE_MS } from './time';
import type { DeviceSpan, Occurrence } from './types';

/** How long a setting/item with no planned end stays drawn past the device's last event. */
export const OPEN_SPAN_TAIL_MIN = 30;

/** '425°F' / '220°C' / 'LOW'. Same output as formatSetting(plan, s) in data/types. */
export function settingLabel(s: DeviceSetting, unit: 'F' | 'C' = 'F'): string {
  return typeof s === 'number' ? `${s}°${unit}` : s;
}

interface OpenSetting {
  setting: DeviceSetting;
  start: number;
  occId: string;
}
interface OpenItem {
  id: string;
  label: string;
  start: number;
  occId: string;
  forMin?: number;
}

/**
 * getDaySpans(plan, occs, day): replay `day`'s device actions in (time, order) order,
 * unload -> set -> load within an action.
 *  - Setting spans run from a set to the next set with a DIFFERENT value on that device
 *    (re-setting the same value continues the span). OFF ends the span and creates none.
 *    A setting still open after the last event ends at (last event time for that device + 30 min).
 *  - Item spans run from load to the later unload / OFF that removes it (re-loading the same id
 *    also ends it) — same precedence as the board's `until` — else since + forMin, else the same
 *    end-of-day cap as settings.
 * Labels use the plan's temperature unit. Output: plan.devices order, then start, settings before items.
 */
export function getDaySpans(plan: Plan, occs: Occurrence[], day: Day): DeviceSpan[] {
  const dayOccs = occs.filter((o) => o.day === day).sort(byTimeThenOrder);
  const out: DeviceSpan[] = [];
  const unit = plan.tempUnit ?? 'F';

  for (const device of deviceIds(plan)) {
    const events: { occ: Occurrence; action: NonNullable<Occurrence['task']['devices']>[number] }[] = [];
    for (const occ of dayOccs) for (const action of occ.task.devices ?? []) if (action.device === device) events.push({ occ, action });
    if (events.length === 0) continue;

    const spans: DeviceSpan[] = [];
    let setting: OpenSetting | null = null;
    let items: OpenItem[] = [];

    const closeItem = (it: OpenItem, end: number, endOccId: string) => {
      spans.push({ device, kind: 'item', label: it.label, start: it.start, end, occId: it.occId, endOccId });
    };
    const closeSetting = (end: number, endOccId: string) => {
      if (!setting) return;
      spans.push({
        device,
        kind: 'setting',
        label: settingLabel(setting.setting, unit),
        setting: setting.setting,
        start: setting.start,
        end,
        occId: setting.occId,
        endOccId,
      });
      setting = null;
    };
    for (const { occ, action } of events) {
      const t = occ.time;
      const id = occ.occId;
      // unload
      if (action.unload === 'all') {
        for (const it of items) closeItem(it, t, id);
        items = [];
      } else if (Array.isArray(action.unload) && action.unload.length) {
        const rm = new Set(action.unload);
        for (const it of items) if (rm.has(it.id)) closeItem(it, t, id);
        items = items.filter((it) => !rm.has(it.id));
      }
      // set
      if (action.set !== undefined) {
        if (action.set === OFF) {
          for (const it of items) closeItem(it, t, id);
          items = [];
          closeSetting(t, id);
        } else {
          const current = setting as OpenSetting | null;
          if (!current || current.setting !== action.set) {
            closeSetting(t, id);
            setting = { setting: action.set, start: t, occId: id };
          }
        }
      }
      // load
      for (const load of action.load ?? []) {
        const prev = items.find((it) => it.id === load.id);
        if (prev) {
          closeItem(prev, t, id);
          items = items.filter((it) => it !== prev);
        }
        items.push({ id: load.id, label: load.label, start: t, occId: id, forMin: load.forMin });
      }
    }

    // End of day: close whatever is still open.
    const lastEvent = events[events.length - 1].occ.time;
    const cap = lastEvent + OPEN_SPAN_TAIL_MIN * MINUTE_MS;
    for (const it of items) {
      const end = typeof it.forMin === 'number' && it.forMin > 0 ? it.start + it.forMin * MINUTE_MS : Math.max(cap, it.start);
      spans.push({ device, kind: 'item', label: it.label, start: it.start, end, occId: it.occId });
    }
    const open = setting as OpenSetting | null;
    if (open) {
      spans.push({
        device,
        kind: 'setting',
        label: settingLabel(open.setting, unit),
        setting: open.setting,
        start: open.start,
        end: Math.max(cap, open.start),
        occId: open.occId,
      });
    }

    spans.sort((a, b) => a.start - b.start || (a.kind === b.kind ? 0 : a.kind === 'setting' ? -1 : 1));
    out.push(...spans);
  }
  return out;
}

/** Planned spans for every plan day: { [day.id]: DeviceSpan[] } (an entry for each day, possibly empty). */
export function getAllSpans(plan: Plan, occs: Occurrence[]): Record<Day, DeviceSpan[]> {
  const out: Record<Day, DeviceSpan[]> = {};
  for (const d of plan.days ?? []) out[d.id] = getDaySpans(plan, occs, d.id);
  return out;
}
