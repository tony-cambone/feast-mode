import { describe, expect, it } from 'vitest';
import { createAlarmPlayer } from './index';
import { cycleSeconds, renderChirp, renderPattern } from './synth';
import type { AlarmKind } from './index';
import type { SoundId } from '../engine/types';

const SR = 44100;
const combos: [AlarmKind, SoundId][] = [
  ['alarm', 'klaxon'],
  ['alarm', 'triple-beep'],
  ['alarm', 'bell'],
  ['gentle', 'klaxon'],
  ['headsUp', 'klaxon'],
];
const peak = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('renderPattern', () => {
  it.each(combos)('%s/%s has correct length, sane peak, and click-free edges', (kind, sound) => {
    const b = renderPattern(kind, sound, SR);
    expect(b.length).toBe(Math.round(cycleSeconds(kind, sound) * SR));
    const p = peak(b);
    expect(p).toBeGreaterThan(0.2);
    expect(p).toBeLessThanOrEqual(1);
    expect(Math.abs(b[0])).toBeLessThan(0.01);
    expect(Math.abs(b[b.length - 1])).toBeLessThan(0.01);
    expect(b.every(Number.isFinite)).toBe(true);
  });

  it('is deterministic', () => {
    expect(renderPattern('alarm', 'bell', SR)).toEqual(renderPattern('alarm', 'bell', SR));
  });

  it('alarms are louder than gentle and headsUp', () => {
    const g = peak(renderPattern('gentle', 'klaxon', SR));
    const h = peak(renderPattern('headsUp', 'klaxon', SR));
    for (const s of ['klaxon', 'triple-beep', 'bell'] as const) {
      const a = peak(renderPattern('alarm', s, SR));
      expect(a).toBeGreaterThan(g * 2);
      expect(a).toBeGreaterThan(h * 2);
    }
  });

  it('cycle cadences match spec and include trailing silence', () => {
    expect(cycleSeconds('gentle', 'bell')).toBe(6);
    expect(cycleSeconds('headsUp', 'bell')).toBe(10);
    const k = renderPattern('alarm', 'klaxon', SR);
    expect(peak(k.subarray(Math.round(1.62 * SR)))).toBeLessThan(1e-6);
    expect(peak(k.subarray(Math.round(1.2 * SR), Math.round(1.5 * SR)))).toBeGreaterThan(0.3);
    const t = renderPattern('alarm', 'triple-beep', SR);
    expect(peak(t.subarray(Math.round(0.55 * SR)))).toBeLessThan(1e-6);
    // gap between beep 1 (0-120ms) and 2 (200-320ms)
    expect(peak(t.subarray(Math.round(0.125 * SR), Math.round(0.195 * SR)))).toBeLessThan(1e-6);
    const g = renderPattern('gentle', 'klaxon', SR);
    expect(peak(g.subarray(Math.round(2.5 * SR)))).toBeLessThan(0.01);
  });

  it('chirp is short and click-free', () => {
    const c = renderChirp(SR);
    expect(c.length).toBeLessThan(SR);
    expect(Math.abs(c[0])).toBeLessThan(0.01);
    expect(Math.abs(c[c.length - 1])).toBeLessThan(0.01);
  });
});

describe('createAlarmPlayer without Web Audio', () => {
  it('reports unsupported and does not throw', async () => {
    const p = createAlarmPlayer();
    expect(p.state).toBe('unsupported');
    expect(await p.unlock()).toBe(false);
    expect(() => {
      p.start('alarm', 'klaxon', 1);
      p.setVolume(0.5);
      p.preview('gentle', 'bell', 1);
      p.stop();
    }).not.toThrow();
  });
});
