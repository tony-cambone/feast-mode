import { describe, expect, it } from 'vitest';
import { fixturePlan } from './testFixture';
import {
  boardDay,
  currentPlanDay,
  epochToZoned,
  formatCountdown,
  formatHHMM,
  minutesToHHMM,
  parseHHMM,
  zonedToEpoch,
} from './time';

const H = 3_600_000;

describe('zonedToEpoch (America/New_York via Intl)', () => {
  it('Thanksgiving 2026 is EST (UTC-5)', () => {
    expect(zonedToEpoch('2026-11-26', '12:00')).toBe(Date.UTC(2026, 10, 26, 17, 0));
    expect(zonedToEpoch('2026-11-25', '09:00')).toBe(Date.UTC(2026, 10, 25, 14, 0));
    expect(zonedToEpoch('2026-11-26', '00:00')).toBe(Date.UTC(2026, 10, 26, 5, 0));
    expect(zonedToEpoch('2026-11-26', '23:59')).toBe(Date.UTC(2026, 10, 27, 4, 59));
  });

  it('a July date is EDT (UTC-4)', () => {
    expect(zonedToEpoch('2026-07-04', '12:00')).toBe(Date.UTC(2026, 6, 4, 16, 0));
  });

  it('handles the Nov 1 2026 fall-back day', () => {
    expect(zonedToEpoch('2026-11-01', '00:30')).toBe(Date.UTC(2026, 10, 1, 4, 30)); // EDT
    // 01:30 happens twice; we take the first (EDT) instance.
    expect(zonedToEpoch('2026-11-01', '01:30')).toBe(Date.UTC(2026, 10, 1, 5, 30));
    expect(zonedToEpoch('2026-11-01', '02:00')).toBe(Date.UTC(2026, 10, 1, 7, 0)); // EST
    expect(zonedToEpoch('2026-11-01', '03:00')).toBe(Date.UTC(2026, 10, 1, 8, 0)); // EST
    // Wall clock 00:00 -> 03:00 spans 4 real hours that day.
    expect(zonedToEpoch('2026-11-01', '03:00') - zonedToEpoch('2026-11-01', '00:00')).toBe(4 * H);
  });

  it('handles the spring-forward gap (Mar 8 2026)', () => {
    expect(zonedToEpoch('2026-03-08', '01:30')).toBe(Date.UTC(2026, 2, 8, 6, 30)); // EST
    expect(zonedToEpoch('2026-03-08', '03:00')).toBe(Date.UTC(2026, 2, 8, 7, 0)); // EDT
    // 02:30 does not exist; it resolves forward to 03:30 EDT.
    expect(zonedToEpoch('2026-03-08', '02:30')).toBe(Date.UTC(2026, 2, 8, 7, 30));
  });

  it('accepts H:MM and rejects malformed input with NaN', () => {
    expect(zonedToEpoch('2026-11-26', '9:05')).toBe(zonedToEpoch('2026-11-26', '09:05'));
    expect(zonedToEpoch('2026-11-26', '25:00')).toBeNaN();
    expect(zonedToEpoch('2026-11-26', 'noon')).toBeNaN();
    expect(zonedToEpoch('11/26/2026', '12:00')).toBeNaN();
  });

  it('supports other zones', () => {
    expect(zonedToEpoch('2026-11-26', '12:00', 'UTC')).toBe(Date.UTC(2026, 10, 26, 12, 0));
    expect(zonedToEpoch('2026-11-26', '12:00', 'America/Los_Angeles')).toBe(Date.UTC(2026, 10, 26, 20, 0));
  });
});

describe('epochToZoned / formatHHMM', () => {
  it('round-trips with zonedToEpoch', () => {
    const t = zonedToEpoch('2026-11-26', '13:35');
    const z = epochToZoned(t);
    expect(z).toEqual({ dateISO: '2026-11-26', hhmm: '13:35', hh: 13, mm: 35, ss: 0, weekday: 'Thu' });
    expect(epochToZoned(t + 42_000).ss).toBe(42);
  });

  it('renders midnight as 00:00 (never 24:00) and uses the NY date, not UTC', () => {
    const midnight = zonedToEpoch('2026-11-26', '00:00');
    expect(epochToZoned(midnight).hhmm).toBe('00:00');
    expect(epochToZoned(midnight).dateISO).toBe('2026-11-26');
    // 23:30 Wed NY is already Thursday in UTC.
    expect(epochToZoned(zonedToEpoch('2026-11-25', '23:30')).dateISO).toBe('2026-11-25');
  });

  it('formatHHMM is 24h NY time', () => {
    expect(formatHHMM(Date.UTC(2026, 10, 26, 17, 0))).toBe('12:00');
    expect(formatHHMM(Date.UTC(2026, 10, 26, 18, 35, 59))).toBe('13:35');
    expect(formatHHMM(Date.UTC(2026, 6, 4, 16, 0))).toBe('12:00');
    expect(formatHHMM(NaN)).toBe('--:--');
  });

  it('parseHHMM / minutesToHHMM', () => {
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('13:30')).toBe(810);
    expect(parseHHMM('24:00')).toBeNaN();
    expect(parseHHMM('12:60')).toBeNaN();
    expect(minutesToHHMM(810)).toBe('13:30');
    expect(minutesToHHMM(5)).toBe('00:05');
  });
});

describe('formatCountdown', () => {
  it('MM:SS under an hour, H:MM:SS at or above', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(61_000)).toBe('01:01');
    expect(formatCountdown(59 * 60_000 + 59_000)).toBe('59:59');
    expect(formatCountdown(H)).toBe('1:00:00');
    expect(formatCountdown(2 * H + 5 * 60_000 + 7_000)).toBe('2:05:07');
  });

  it('rounds remaining time up so it never shows 00:00 early', () => {
    expect(formatCountdown(1)).toBe('00:01');
    expect(formatCountdown(59_001)).toBe('01:00');
    expect(formatCountdown(H - 500)).toBe('1:00:00');
  });

  it('negative = overdue with a leading minus', () => {
    expect(formatCountdown(-61_000)).toBe('-01:01');
    expect(formatCountdown(-H)).toBe('-1:00:00');
    expect(formatCountdown(-300)).toBe('00:00');
    expect(formatCountdown(NaN)).toBe('--:--');
  });
});

describe('boardDay / currentPlanDay', () => {
  const p = fixturePlan;
  it('exact dates', () => {
    expect(boardDay(p, zonedToEpoch('2026-11-25', '00:00'))).toBe('wed');
    expect(boardDay(p, zonedToEpoch('2026-11-25', '23:59'))).toBe('wed');
    expect(boardDay(p, zonedToEpoch('2026-11-26', '00:00'))).toBe('thu');
    expect(currentPlanDay(p, zonedToEpoch('2026-11-26', '12:00'))).toBe('thu');
  });
  it('nearest day outside the plan', () => {
    expect(boardDay(p, zonedToEpoch('2026-11-24', '20:00'))).toBe('wed');
    expect(boardDay(p, zonedToEpoch('2026-11-27', '08:00'))).toBe('thu');
    expect(boardDay(p, zonedToEpoch('2027-01-01', '08:00'))).toBe('thu');
    expect(currentPlanDay(p, zonedToEpoch('2026-11-24', '20:00'))).toBeNull();
    expect(currentPlanDay(p, zonedToEpoch('2026-11-27', '00:00'))).toBeNull();
  });
});
