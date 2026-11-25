import { describe, expect, it } from 'vitest';
import type { Plan, Task } from '../data/types';
import { buildOccurrences } from './plan';
import { dayReducer, initialDayState } from './reducer';
import { planShift } from './shift';
import { getDaySpans, settingLabel } from './spans';
import { fixturePlan, occsFor, thu } from './testFixture';
import type { DeviceSpan } from './types';

const s0 = initialDayState();
const brief = (spans: DeviceSpan[]) => spans.map((s) => [s.device, s.kind, s.label, s.start, s.end]);

describe('getDaySpans (fixture)', () => {
  const spans = getDaySpans(fixturePlan, occsFor(s0), 'thu');

  it('settings run set -> next set; OFF ends without creating a span', () => {
    expect(brief(spans.filter((s) => s.device === 'oven' && s.kind === 'setting'))).toEqual([
      ['oven', 'setting', '425°F', thu('10:00'), thu('12:00')],
      ['oven', 'setting', '375°F', thu('12:00'), thu('12:55')],
      ['oven', 'setting', '350°F', thu('12:55'), thu('13:35')],
    ]);
    const s375 = spans.find((s) => s.label === '375°F' && s.device === 'oven')!;
    expect(s375).toMatchObject({ setting: 375, occId: 't-1200', endOccId: 't-1255' });
    expect(spans.some((s) => s.label === 'OFF')).toBe(false);
  });

  it('items run load -> removing unload/OFF', () => {
    expect(brief(spans.filter((s) => s.device === 'oven' && s.kind === 'item'))).toEqual([
      ['oven', 'item', '15.6 lb turkey', thu('10:15'), thu('12:00')],
      ['oven', 'item', 'Stuffing pan 1', thu('12:00'), thu('12:55')],
      ['oven', 'item', 'Stuffing pan 2', thu('12:00'), thu('12:55')],
      ['oven', 'item', 'Sweet potato casserole', thu('12:55'), thu('13:35')],
      ['oven', 'item', 'Green bean casserole', thu('12:55'), thu('13:35')],
    ]);
    expect(spans.find((s) => s.label === 'Stuffed mushrooms')).toMatchObject({
      device: 'grill', start: thu('12:35'), end: thu('12:55'), occId: 't-1235', endOccId: 't-1255',
    });
  });

  it('open settings/items end at the device\'s last event + 30 min', () => {
    // Fixture slow cooker: LOW + potatoes at 11:00, never turned off.
    expect(brief(spans.filter((s) => s.device === 'slowcooker'))).toEqual([
      ['slowcooker', 'setting', 'LOW', thu('11:00'), thu('11:30')],
      ['slowcooker', 'item', 'Mashed potatoes', thu('11:00'), thu('11:30')],
    ]);
    expect(spans.find((s) => s.device === 'slowcooker')!.endOccId).toBeUndefined();
  });

  it('output is grouped in board-device order; devices without actions have no spans', () => {
    const order = spans.map((s) => s.device);
    expect([...new Set(order)]).toEqual(['oven', 'traeger', 'grill', 'slowcooker']);
    expect(getDaySpans(fixturePlan, occsFor(s0), 'wed').map((s) => s.label)).toEqual(['400°F', 'Sweet potatoes']);
  });

  it('is independent of progress, and follows shifts and variants', () => {
    // Cook has done everything through 11:05; the oven runs 15 min late from 11:50.
    const doneSoFar = ['t-0845', 't-0915', 't-1000', 't-1015', 't-1100', 't-1105'].reduce(
      (s, occId) => dayReducer(s, { type: 'done', occId, at: thu('11:40') }),
      s0,
    );
    const rec = planShift(occsFor(doneSoFar), doneSoFar, thu('11:50'), 15, { kind: 'lane', lane: 'oven' }, 'Oven +15');
    const shifted = dayReducer(doneSoFar, { type: 'applyShift', record: rec });
    // Done-ness never changes the planned spans.
    expect(getDaySpans(fixturePlan, occsFor(doneSoFar), 'thu')).toEqual(spans);
    const ov = getDaySpans(fixturePlan, occsFor(shifted), 'thu').filter((s) => s.device === 'oven' && s.kind === 'setting');
    expect(brief(ov)).toEqual([
      ['oven', 'setting', '425°F', thu('10:00'), thu('12:15')],
      ['oven', 'setting', '375°F', thu('12:15'), thu('13:10')],
      ['oven', 'setting', '350°F', thu('13:10'), thu('13:50')],
    ]);
    // Traeger untouched by an oven-lane shift.
    expect(getDaySpans(fixturePlan, occsFor(shifted), 'thu').filter((s) => s.device === 'traeger')).toEqual(
      spans.filter((s) => s.device === 'traeger'),
    );
    const late = dayReducer(s0, { type: 'toggleVariant', variantId: 'late' });
    const lateOven = getDaySpans(fixturePlan, occsFor(late), 'thu').filter((s) => s.device === 'oven');
    expect(brief(lateOven)).toEqual([
      ['oven', 'setting', '425°F', thu('10:00'), thu('12:30')],
      ['oven', 'item', '15.6 lb turkey', thu('10:15'), thu('12:30')],
      ['oven', 'setting', '350°F', thu('12:30'), thu('13:35')], // 12:55 re-sets 350: same span continues
      ['oven', 'item', 'Sweet potato casserole', thu('12:55'), thu('13:35')],
      ['oven', 'item', 'Green bean casserole', thu('12:55'), thu('13:35')],
    ]);
  });

  it('forMin caps items with no remover; reloading the same id ends the earlier span', () => {
    const tasks: Task[] = [
      { id: 'a', day: 'thu', time: '10:00', title: 'a', devices: [{ device: 'stove', set: 'MED', load: [{ id: 'p', label: 'Pot', forMin: 20 }] }] },
      { id: 'b', day: 'thu', time: '10:30', title: 'b', devices: [{ device: 'stove', load: [{ id: 'q', label: 'Pan', forMin: 10 }] }] },
      { id: 'c', day: 'thu', time: '10:35', title: 'c', devices: [{ device: 'stove', load: [{ id: 'q', label: 'Pan again' }] }] },
      { id: 'd', day: 'thu', time: '11:00', title: 'd', devices: [{ device: 'stove', set: 'MED' }] },
    ];
    const mini: Plan = { ...fixturePlan, tasks, variants: [] };
    expect(brief(getDaySpans(mini, buildOccurrences(mini, tasks, {}), 'thu'))).toEqual([
      ['stove', 'setting', 'MED', thu('10:00'), thu('11:30')], // same-value set at 11:00 continues; open -> 11:00 + 30
      ['stove', 'item', 'Pot', thu('10:00'), thu('10:20')],
      ['stove', 'item', 'Pan', thu('10:30'), thu('10:35')],
      ['stove', 'item', 'Pan again', thu('10:35'), thu('11:30')],
    ]);
  });

  it('settingLabel', () => {
    expect(settingLabel(425)).toBe('425°F');
    expect(settingLabel('LOW')).toBe('LOW');
    expect(settingLabel('MED-LOW')).toBe('MED-LOW');
  });
});
