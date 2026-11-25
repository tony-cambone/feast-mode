import { describe, expect, it } from 'vitest';
import type { BoardDevice, Plan } from '../data/types';
import { getBoard } from './board';
import { buildOccurrences } from './plan';
import { dayReducer, initialDayState } from './reducer';
import { planShift } from './shift';
import { fixturePlan, occsFor, thu, wed } from './testFixture';
import { zonedToEpoch } from './time';
import type { DayState, DeviceStatus } from './types';

const s0 = initialDayState();
function boardAt(now: number, state: DayState = s0, plan: Plan = fixturePlan): Record<BoardDevice, DeviceStatus> {
  const b = getBoard(plan, occsFor(state, plan), state, now);
  return Object.fromEntries(b.map((d) => [d.device, d])) as Record<BoardDevice, DeviceStatus>;
}
const labels = (d: DeviceStatus) => d.items.map((i) => i.label);

describe('getBoard', () => {
  it('returns every board device in display order, starting the day OFF and empty', () => {
    const b = getBoard(fixturePlan, occsFor(s0), s0, thu('06:00'));
    expect(b.map((d) => d.device)).toEqual(['oven', 'traeger', 'grill', 'slowcooker', 'stove']);
    for (const d of b) {
      expect(d.setting).toBe('OFF');
      expect(d.items).toEqual([]);
      expect(d.settingSince).toBeUndefined();
    }
    expect(boardAt(thu('06:00')).traeger.next?.occ.occId).toBe('t-0845');
    expect(boardAt(thu('06:00')).traeger.next?.set).toBe(325);
  });

  it('10:10 — oven 425 empty (next 10:15 turkey in), Traeger 325 turkey, grill OFF, slow cooker OFF (next 11:00)', () => {
    const b = boardAt(thu('10:10'));
    expect(b.oven).toMatchObject({ setting: 425, settingSince: thu('10:00'), items: [] });
    expect(b.oven.next?.occ.occId).toBe('t-1015');
    expect(b.oven.next?.load).toEqual(['15.6 lb turkey']);
    expect(b.traeger.setting).toBe(325);
    expect(b.traeger.items).toEqual([{ id: 't-trturkey', label: '19.4 lb turkey', since: thu('09:15'), until: thu('12:45') }]);
    expect(b.grill.setting).toBe('OFF');
    expect(b.grill.next?.occ.occId).toBe('t-1220');
    expect(b.slowcooker.setting).toBe('OFF');
    expect(b.slowcooker.next).toMatchObject({ set: 'LOW', load: ['Mashed potatoes'] });
    expect(b.slowcooker.next?.occ.occId).toBe('t-1100');
    expect(b.stove.next).toBeUndefined();
  });

  it('item until = time of the later unload / OFF on that device', () => {
    const b = boardAt(thu('10:15'));
    expect(b.oven.items).toEqual([{ id: 't-ovturkey', label: '15.6 lb turkey', since: thu('10:15'), until: thu('12:00') }]);
    // next for the oven is the equipment-only 11:05 rotate (no device action).
    expect(b.oven.next?.occ.occId).toBe('t-1105');
    expect(b.oven.next?.set).toBeUndefined();
    expect(b.oven.next?.load).toBeUndefined();
  });

  it('12:10 / 12:40 / 13:00 transitions', () => {
    const b1 = boardAt(thu('12:10'));
    expect(b1.oven.setting).toBe(375);
    expect(labels(b1.oven)).toEqual(['Stuffing pan 1', 'Stuffing pan 2']);
    expect(b1.oven.items.every((i) => i.until === thu('12:55'))).toBe(true);
    expect(b1.oven.next).toMatchObject({ set: 350, unload: 'all', load: ['Sweet potato casserole', 'Green bean casserole'] });
    expect(b1.slowcooker).toMatchObject({ setting: 'LOW', items: [{ id: 't-mash', label: 'Mashed potatoes', since: thu('11:00') }] });
    expect(b1.slowcooker.items[0].until).toBeUndefined(); // no remover, no forMin
    expect(b1.grill.setting).toBe('OFF');

    const b2 = boardAt(thu('12:40'));
    expect(b2.grill.setting).toBe(375);
    expect(b2.grill.items).toEqual([{ id: 't-mush', label: 'Stuffed mushrooms', since: thu('12:35'), until: thu('12:55') }]);
    expect(b2.traeger.setting).toBe(325);

    const b3 = boardAt(thu('13:00'));
    expect(b3.oven.setting).toBe(350);
    expect(labels(b3.oven)).toEqual(['Sweet potato casserole', 'Green bean casserole']);
    expect(b3.oven.items.every((i) => i.until === thu('13:35'))).toBe(true);
    expect(b3.traeger).toMatchObject({ setting: 'OFF', items: [] });
    expect(b3.grill).toMatchObject({ setting: 'OFF', items: [], settingSince: thu('12:55') });
  });

  it('falls back to since + forMin when nothing later removes the item', () => {
    const mini: Plan = {
      ...fixturePlan,
      variants: [],
      tasks: [{ id: 'g', day: 'thu', time: '12:00', title: 'g', devices: [{ device: 'grill', set: 400, load: [{ id: 'x', label: 'Corn', forMin: 25 }] }] }],
    };
    const b = getBoard(mini, buildOccurrences(mini, mini.tasks, {}), s0, thu('12:05'));
    expect(b[2].items).toEqual([{ id: 'x', label: 'Corn', since: thu('12:00'), until: thu('12:25') }]);
  });

  it('a task marked done early applies its device actions at doneAt', () => {
    const s = dayReducer(s0, { type: 'done', occId: 't-1015', at: thu('10:12') });
    expect(boardAt(thu('10:11'), s).oven.items).toEqual([]);
    expect(boardAt(thu('10:13'), s).oven.items).toEqual([
      { id: 't-ovturkey', label: '15.6 lb turkey', since: thu('10:12'), until: thu('12:00') },
    ]);
    // Done tasks are never "next".
    expect(boardAt(thu('10:05'), s).oven.next?.occ.occId).toBe('t-1105');
  });

  it('uses the board day: Wednesday replay, then a fresh OFF Thursday', () => {
    expect(boardAt(wed('10:30')).oven).toMatchObject({
      setting: 400,
      items: [{ id: 'w-sp', label: 'Sweet potatoes', since: wed('10:00'), until: wed('11:00') }],
    });
    expect(boardAt(wed('11:30')).oven).toMatchObject({ setting: 'OFF', items: [] });
    expect(boardAt(wed('23:59')).oven.next?.occ.occId).toBe('t-1000'); // next crosses days
    expect(boardAt(thu('00:01')).oven).toMatchObject({ setting: 'OFF', items: [] });
    // Before the plan: Wednesday board, nothing on.
    const tue = boardAt(zonedToEpoch('2026-11-24', '20:00'));
    expect(tue.oven.setting).toBe('OFF');
    expect(tue.oven.next?.occ.occId).toBe('w-1000');
  });

  it('reflects variants', () => {
    const s = dayReducer(s0, { type: 'toggleVariant', variantId: 'late' });
    const b = boardAt(thu('12:10'), s);
    expect(b.oven.setting).toBe(425);
    expect(b.oven.items).toEqual([{ id: 't-ovturkey', label: '15.6 lb turkey', since: thu('10:15'), until: thu('12:30') }]);
    expect(boardAt(thu('12:31'), s).oven).toMatchObject({ setting: 350, items: [] });
  });

  it('reflects shifts (effective times)', () => {
    const rec = planShift(occsFor(s0), s0, thu('11:50'), 15, { kind: 'lane', lane: 'oven' }, 'Oven +15');
    const s = dayReducer(s0, { type: 'applyShift', record: rec });
    const b = boardAt(thu('12:10'), s);
    expect(b.oven.setting).toBe(425);
    expect(b.oven.items[0]).toMatchObject({ label: '15.6 lb turkey', until: thu('12:15') });
    expect(b.oven.next?.occ.occId).toBe('t-1200');
    expect(boardAt(thu('12:15'), s).oven.setting).toBe(375);
  });
});
