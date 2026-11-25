/**
 * AUDIO PUBLIC API (contract). Owner: audio/platform agent. Signatures are fixed.
 * Synthesize everything with Web Audio (no files). Loop by rendering the pattern
 * into an AudioBuffer and playing an AudioBufferSourceNode with loop = true, so the
 * loop keeps going when the tab is in the background and timers are throttled.
 */
import type { SoundId } from '../engine/types';

export type AlarmKind = 'alarm' | 'gentle' | 'headsUp';
export type AudioState = 'locked' | 'running' | 'suspended' | 'unsupported';

export const SOUNDS: readonly { id: SoundId; label: string }[] = [
  { id: 'klaxon', label: 'Klaxon' },
  { id: 'triple-beep', label: 'Triple beep' },
  { id: 'bell', label: 'Bell' },
];

export interface AlarmPlayer {
  readonly state: AudioState;
  /** Call from a user gesture. Creates/resumes the AudioContext and plays a short test chirp. Resolves true if running. */
  unlock(): Promise<boolean>;
  /**
   * Start looping. Idempotent for the same (kind, sound); a different kind/sound restarts.
   * 'alarm' = the chosen SoundId, loud. 'gentle' = soft two-note chime every ~6 s.
   * 'headsUp' = single soft ding every ~10 s.
   * Also sets document.documentElement.dataset.alarm = kind (and 'off' on stop) for tests.
   */
  start(kind: AlarmKind, sound: SoundId, volume: number): void;
  stop(): void;
  /** One-shot ~2 s preview for Settings. Works only when unlocked. */
  preview(kind: AlarmKind, sound: SoundId, volume: number): void;
  setVolume(volume: number): void;
  onStateChange(cb: (s: AudioState) => void): () => void;
}

export { createAlarmPlayer } from './player';
export { renderPattern, renderChirp, cycleSeconds } from './synth';
