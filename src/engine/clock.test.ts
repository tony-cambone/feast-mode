import { describe, expect, it } from 'vitest';
import { appNow, makeTestClock, migrateClock, shouldExitTestMode, testAutoExitAt, tickIntervalMs, withSpeed } from './clock';
import { thu, wed } from './testFixture';

describe('app clock', () => {
  it('real mode is the real clock', () => {
    expect(appNow({ mode: 'real' }, 123_456)).toBe(123_456);
  });

  it('test clock = baseApp + (realNow - baseReal) * speed', () => {
    const cfg = makeTestClock(thu('06:55'), 60, 1_000_000);
    expect(cfg).toEqual({ mode: 'test', baseReal: 1_000_000, baseApp: thu('06:55'), speed: 60 });
    expect(appNow(cfg, 1_000_000)).toBe(thu('06:55'));
    expect(appNow(cfg, 1_000_250)).toBe(thu('06:55') + 15_000); // 250 ms real = 15 s app at 60x
    expect(appNow(cfg, 1_005_000)).toBe(thu('07:00'));
  });

  it('withSpeed keeps app time continuous', () => {
    const cfg = makeTestClock(thu('10:00'), 60, 0);
    const later = withSpeed(cfg, 10, 2_000); // 2 s real at 60x = 2 min app
    expect(appNow(later, 2_000)).toBe(thu('10:02'));
    expect(appNow(later, 8_000)).toBe(thu('10:03')); // 6 s at 10x = 1 min
    expect(withSpeed({ mode: 'real' }, 60, 5)).toEqual({ mode: 'real' });
  });

  it('rejects bad speeds', () => {
    expect(makeTestClock(0, 0, 0)).toMatchObject({ speed: 1 });
    expect(makeTestClock(0, -5, 0)).toMatchObject({ speed: 1 });
    expect(makeTestClock(0, NaN, 0)).toMatchObject({ speed: 1 });
  });

  it('tick interval: 250 ms when fast-forwarding, else 1 s', () => {
    expect(tickIntervalMs({ mode: 'real' })).toBe(1000);
    expect(tickIntervalMs(makeTestClock(0, 1, 0))).toBe(1000);
    expect(tickIntervalMs(makeTestClock(0, 10, 0))).toBe(250);
    expect(tickIntervalMs(makeTestClock(0, 60, 0))).toBe(250);
  });

  it('test-mode auto-exit: next cutoff after baseReal; exit once realNow reaches it', () => {
    const cutoffs = [wed('08:30'), thu('06:30')];
    const tonight = makeTestClock(thu('06:55'), 60, wed('08:30') - 12 * 3_600_000); // rehearsal Tue 20:30
    expect(testAutoExitAt(cutoffs, tonight)).toBe(wed('08:30'));
    expect(shouldExitTestMode(cutoffs, tonight, wed('08:29'))).toBe(false);
    expect(shouldExitTestMode(cutoffs, tonight, wed('08:30'))).toBe(true);
    expect(shouldExitTestMode(cutoffs, tonight, thu('12:00'))).toBe(true);
    // Started after Wednesday's cutoff: the next one is Thursday's.
    const wedRehearsal = makeTestClock(thu('06:55'), 60, wed('20:00'));
    expect(testAutoExitAt(cutoffs, wedRehearsal)).toBe(thu('06:30'));
    expect(shouldExitTestMode(cutoffs, wedRehearsal, wed('23:00'))).toBe(false);
    expect(shouldExitTestMode(cutoffs, wedRehearsal, thu('06:30'))).toBe(true);
    // Started at exactly a cutoff -> that one does not count (strictly after baseReal).
    expect(testAutoExitAt(cutoffs, makeTestClock(0, 60, wed('08:30')))).toBe(thu('06:30'));
    // After the last cutoff, or in real mode: nothing.
    expect(testAutoExitAt(cutoffs, makeTestClock(0, 60, thu('07:00')))).toBeNull();
    expect(shouldExitTestMode(cutoffs, makeTestClock(0, 60, thu('07:00')), thu('23:00'))).toBe(false);
    expect(testAutoExitAt(cutoffs, { mode: 'real' })).toBeNull();
    expect(shouldExitTestMode(cutoffs, { mode: 'real' }, thu('23:00'))).toBe(false);
  });

  it('migrateClock validates stored config', () => {
    const good = makeTestClock(thu('09:00'), 60, 1);
    expect(migrateClock(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(migrateClock(undefined)).toEqual({ mode: 'real' });
    expect(migrateClock('test')).toEqual({ mode: 'real' });
    expect(migrateClock({ mode: 'test', baseReal: 1, baseApp: 'x', speed: 60 })).toEqual({ mode: 'real' });
    expect(migrateClock({ mode: 'test', baseReal: 1, baseApp: 2, speed: 0 })).toEqual({ mode: 'real' });
  });
});
