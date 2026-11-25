/**
 * Equipment board: derived per device by replaying the board day's device actions.
 * Never hand-maintained; everything comes from `task.devices`.
 */
import type { BoardDevice, DeviceAction, DeviceSetting, Plan } from '../data/types';
import { OFF } from '../data/types';
import { byTimeThenOrder, deviceIds, touchedEquipment } from './plan';
import { MINUTE_MS, boardDay } from './time';
import type { BoardItem, DayState, DeviceStatus, Occurrence } from './types';

interface DeviceEvent {
  occ: Occurrence;
  action: DeviceAction;
  /** occ.time, or doneAt when the occurrence was marked done before its time. */
  at: number;
  seq: number;
}

interface LiveItem extends BoardItem {
  forMin?: number;
}

/** When an occurrence's device actions take effect: its time, or earlier if marked done early. */
export function eventTimeOf(occ: Occurrence, state: DayState): number {
  const doneAt = state.occ[occ.occId]?.doneAt;
  return typeof doneAt === 'number' && doneAt < occ.time ? doneAt : occ.time;
}

function removes(action: DeviceAction, itemId: string): boolean {
  if (action.set === OFF) return true;
  if (action.unload === 'all') return true;
  return Array.isArray(action.unload) && action.unload.includes(itemId);
}

function touches(occ: Occurrence, device: BoardDevice): boolean {
  return touchedEquipment(occ.task).includes(device);
}

export function getBoard(plan: Plan, occs: Occurrence[], state: DayState, now: number): DeviceStatus[] {
  const day = boardDay(plan, now);

  // Labels for every load item in the plan, so `next.unload` can show names.
  const labelOf = new Map<string, string>();
  for (const o of occs) for (const a of o.task.devices ?? []) for (const it of a.load ?? []) labelOf.set(it.id, it.label);

  // All of today's device events, in replay order.
  const events: DeviceEvent[] = [];
  let seq = 0;
  const dayOccs = occs.filter((o) => o.day === day).sort(byTimeThenOrder);
  for (const occ of dayOccs) {
    const at = eventTimeOf(occ, state);
    for (const action of occ.task.devices ?? []) events.push({ occ, action, at, seq: seq++ });
  }
  events.sort((a, b) => a.at - b.at || a.occ.time - b.occ.time || a.occ.order - b.occ.order || a.seq - b.seq);

  const sortedAll = occs.slice().sort(byTimeThenOrder);

  return deviceIds(plan).map((device): DeviceStatus => {
    const devEvents = events.filter((e) => e.action.device === device);
    let setting: DeviceSetting = OFF;
    let settingSince: number | undefined;
    let items: LiveItem[] = [];
    let cursor = 0;
    for (; cursor < devEvents.length && devEvents[cursor].at <= now; cursor++) {
      const { action, at } = devEvents[cursor];
      if (action.unload === 'all') items = [];
      else if (Array.isArray(action.unload)) {
        const rm = new Set(action.unload);
        items = items.filter((it) => !rm.has(it.id));
      }
      if (action.set !== undefined) {
        if (action.set === OFF) items = [];
        if (action.set !== setting || settingSince === undefined) settingSince = at;
        setting = action.set;
      }
      for (const load of action.load ?? []) {
        items = items.filter((it) => it.id !== load.id);
        items.push({ id: load.id, label: load.label, since: at, forMin: load.forMin });
      }
    }

    const later = devEvents.slice(cursor);
    const boardItems: BoardItem[] = items.map(({ forMin, ...it }) => {
      const remover = later.find((e) => removes(e.action, it.id));
      const until =
        remover !== undefined
          ? remover.at
          : typeof forMin === 'number' && forMin > 0
            ? it.since + forMin * MINUTE_MS
            : undefined;
      return until === undefined ? it : { ...it, until };
    });

    const status: DeviceStatus = { device, setting, items: boardItems };
    if (settingSince !== undefined) status.settingSince = settingSince;

    // Next not-done occurrence (any day) touching this device whose actions have not happened yet.
    const nextOcc = sortedAll.find(
      (o) => o.time > now && typeof state.occ[o.occId]?.doneAt !== 'number' && touches(o, device),
    );
    if (nextOcc) {
      const action = (nextOcc.task.devices ?? []).find((a) => a.device === device);
      const next: NonNullable<DeviceStatus['next']> = { occ: nextOcc };
      if (action?.set !== undefined) next.set = action.set;
      if (action?.load?.length) next.load = action.load.map((l) => l.label);
      if (action?.unload === 'all') next.unload = 'all';
      else if (action?.unload?.length) next.unload = action.unload.map((id) => labelOf.get(id) ?? id);
      status.next = next;
    }
    return status;
  });
}
