/** App clock: the real wall clock, or a fake test clock running at `speed`x from a chosen start. */
import type { ClockConfig } from './types';

export const DEFAULT_TEST_SPEED = 60;

function sanitizeSpeed(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

export function appNow(cfg: ClockConfig, realNow: number): number {
  if (cfg.mode !== 'test') return realNow;
  return Math.round(cfg.baseApp + (realNow - cfg.baseReal) * cfg.speed);
}

export function makeTestClock(appTime: number, speed: number, realNow: number): ClockConfig {
  return { mode: 'test', baseReal: realNow, baseApp: Math.round(appTime), speed: sanitizeSpeed(speed) };
}

/** Change speed keeping the current app time continuous. Real mode stays real. */
export function withSpeed(cfg: ClockConfig, speed: number, realNow: number): ClockConfig {
  if (cfg.mode !== 'test') return cfg;
  return makeTestClock(appNow(cfg, realNow), speed, realNow);
}

/** Tick interval for the store: 250 ms when the test clock runs faster than real time, else 1 s. */
export function tickIntervalMs(cfg: ClockConfig): number {
  return cfg.mode === 'test' && cfg.speed > 1 ? 250 : 1000;
}

/** Validate a stored clock config; anything malformed falls back to the real clock. Never throws. */
export function migrateClock(raw: unknown): ClockConfig {
  try {
    if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>;
      if (
        r.mode === 'test' &&
        Number.isFinite(r.baseReal) &&
        Number.isFinite(r.baseApp) &&
        Number.isFinite(r.speed) &&
        (r.speed as number) > 0
      ) {
        return { mode: 'test', baseReal: r.baseReal as number, baseApp: r.baseApp as number, speed: r.speed as number };
      }
    }
  } catch {
    /* fall through */
  }
  return { mode: 'real' };
}

/** Next test-mode cutoff after the test clock was started (real time), or null (real mode / none left). */
export function testAutoExitAt(cutoffs: readonly number[], cfg: ClockConfig): number | null {
  if (cfg.mode !== 'test') return null;
  for (const c of cutoffs) if (c > cfg.baseReal) return c;
  return null;
}

/** True when a test clock must hand back to the real clock: some cutoff C with baseReal < C <= realNow. */
export function shouldExitTestMode(cutoffs: readonly number[], cfg: ClockConfig, realNow: number): boolean {
  const c = testAutoExitAt(cutoffs, cfg);
  return c !== null && c <= realNow;
}
