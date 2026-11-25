/**
 * Pure, deterministic sample generation for the alarm patterns. No Web Audio needed,
 * so it is unit-testable in Node. Each rendered buffer is one full loop cycle,
 * including its trailing silence, so looping it gives the right cadence.
 */
import type { SoundId } from '../engine/types';
import type { AlarmKind } from './index';

const TWO_PI = Math.PI * 2;

/** Peak targets (full scale = 1). Alarms are near full scale; gentle/headsUp are quieter. */
export const PEAK = { alarm: 0.95, gentle: 0.35, headsUp: 0.28 } as const;

/** Cycle length in seconds for each pattern. */
export function cycleSeconds(kind: AlarmKind, sound: SoundId): number {
  if (kind === 'gentle') return 6;
  if (kind === 'headsUp') return 10;
  switch (sound) {
    case 'klaxon':
      return 2.0;
    case 'triple-beep':
      return 1.2;
    case 'bell':
      return 2.0;
  }
}

/** Linear attack / release envelope over a note of `dur` seconds, t relative to note start. */
function ar(t: number, dur: number, attack: number, release: number): number {
  if (t < 0 || t > dur) return 0;
  const a = Math.min(1, t / attack);
  const r = Math.min(1, (dur - t) / release);
  return Math.min(a, r);
}

/** Add a harmonic stack (amplitudes by harmonic number) into buf. */
function addTone(
  buf: Float32Array,
  sr: number,
  start: number,
  dur: number,
  freq: number,
  harmonics: readonly number[],
  opts: { attack: number; release: number; decayTau?: number; gain?: number },
): void {
  const i0 = Math.max(0, Math.floor(start * sr));
  const i1 = Math.min(buf.length, Math.ceil((start + dur) * sr));
  const gain = opts.gain ?? 1;
  for (let i = i0; i < i1; i++) {
    const t = i / sr - start;
    let env = ar(t, dur, opts.attack, opts.release);
    if (opts.decayTau) env *= Math.exp(-t / opts.decayTau);
    let s = 0;
    for (let h = 0; h < harmonics.length; h++) {
      s += harmonics[h] * Math.sin(TWO_PI * freq * (h + 1) * t);
    }
    buf[i] += s * env * gain;
  }
}

function normalize(buf: Float32Array, peak: number): void {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  if (max === 0) return;
  const k = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= k;
}

/** Guarantee a click-free loop seam: tiny fade-in/out on the very first/last samples. */
function seam(buf: Float32Array, sr: number): void {
  const n = Math.min(buf.length >> 1, Math.max(8, Math.round(sr * 0.004)));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    buf[i] *= g;
    buf[buf.length - 1 - i] *= g;
  }
  buf[0] = 0;
  buf[buf.length - 1] = 0;
}

// Brassy harmonic stack: sawtooth-ish 1/k rolloff cut off by a gentle low-pass.
const BRASS = Array.from({ length: 8 }, (_, i) => {
  const k = i + 1;
  return (1 / k) / (1 + (k / 4) ** 2);
});
const SINE = [1] as const;
const BEEP = [1, 0.18] as const;
const BELL_PARTIALS: readonly (readonly [number, number, number])[] = [
  // ratio, amplitude, decay tau (s)
  [0.5, 0.7, 0.55],
  [1.0, 1.0, 0.45],
  [1.19, 0.6, 0.38],
  [1.56, 0.45, 0.3],
  [2.0, 0.55, 0.28],
  [2.74, 0.35, 0.2],
  [3.0, 0.3, 0.17],
  [4.07, 0.2, 0.12],
];

export function renderPattern(kind: AlarmKind, sound: SoundId, sampleRate: number): Float32Array {
  const sr = sampleRate;
  const len = Math.round(cycleSeconds(kind, sound) * sr);
  const buf = new Float32Array(len);
  let peak: number = PEAK.alarm;

  if (kind === 'gentle') {
    // E5 -> C5 soft chime.
    addTone(buf, sr, 0, 1.2, 659.25, SINE, { attack: 0.01, release: 0.4, decayTau: 0.35 });
    addTone(buf, sr, 0.4, 1.4, 523.25, SINE, { attack: 0.01, release: 0.5, decayTau: 0.4 });
    peak = PEAK.gentle;
  } else if (kind === 'headsUp') {
    addTone(buf, sr, 0, 1.0, 880, SINE, { attack: 0.01, release: 0.4, decayTau: 0.3 });
    peak = PEAK.headsUp;
  } else if (sound === 'klaxon') {
    // 4 x 0.4 s alternating 650/950 Hz = 1.6 s on, 0.4 s gap.
    const freqs = [650, 950, 650, 950];
    freqs.forEach((f, i) => {
      addTone(buf, sr, i * 0.4, 0.4, f, BRASS, { attack: 0.012, release: 0.02 });
    });
  } else if (sound === 'triple-beep') {
    for (let i = 0; i < 3; i++) {
      addTone(buf, sr, i * 0.2, 0.12, 1000, BEEP, { attack: 0.004, release: 0.008 });
    }
  } else {
    // bell: two strikes per 2 s cycle.
    for (const start of [0, 1.0]) {
      for (const [ratio, amp, tau] of BELL_PARTIALS) {
        addTone(buf, sr, start, 1.0, 520 * ratio, SINE, {
          attack: 0.003,
          release: 0.06,
          decayTau: tau,
          gain: amp,
        });
      }
    }
  }

  normalize(buf, peak);
  seam(buf, sr);
  return buf;
}

/** Short pleasant two-note test chirp played on unlock (not looped). */
export function renderChirp(sampleRate: number): Float32Array {
  const sr = sampleRate;
  const buf = new Float32Array(Math.round(0.5 * sr));
  addTone(buf, sr, 0, 0.2, 660, SINE, { attack: 0.01, release: 0.08 });
  addTone(buf, sr, 0.18, 0.3, 880, SINE, { attack: 0.01, release: 0.15 });
  normalize(buf, 0.5);
  seam(buf, sr);
  return buf;
}
