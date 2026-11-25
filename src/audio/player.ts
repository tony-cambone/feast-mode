import type { SoundId } from '../engine/types';
import type { AlarmKind, AlarmPlayer, AudioState } from './index';
import { renderChirp, renderPattern } from './synth';

type Ctor = typeof AudioContext;

function getCtor(): Ctor | undefined {
  const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function setAlarmDataset(v: string): void {
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.dataset.alarm = v;
    }
  } catch {
    /* ignore */
  }
}

interface Active {
  kind: AlarmKind;
  sound: SoundId;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export function createAlarmPlayer(): AlarmPlayer {
  const Ctor = getCtor();
  let ctx: AudioContext | null = null;
  let comp: DynamicsCompressorNode | null = null;
  let state: AudioState = Ctor ? 'locked' : 'unsupported';
  const listeners = new Set<(s: AudioState) => void>();
  const buffers = new Map<string, AudioBuffer>();
  let active: Active | null = null;
  let pending: { kind: AlarmKind; sound: SoundId; volume: number } | null = null;

  function setState(s: AudioState): void {
    if (s === state) return;
    state = s;
    for (const cb of [...listeners]) {
      try {
        cb(s);
      } catch {
        /* listener errors must not break audio */
      }
    }
  }

  function syncState(): void {
    if (!ctx) return;
    setState(ctx.state === 'running' ? 'running' : 'suspended');
    if (ctx.state === 'running' && pending && !active) {
      const p = pending;
      pending = null;
      startNow(p.kind, p.sound, p.volume);
    }
  }

  function getBuffer(kind: AlarmKind, sound: SoundId): AudioBuffer {
    const c = ctx!;
    const key = `${kind}:${kind === 'alarm' ? sound : '-'}:${c.sampleRate}`;
    let b = buffers.get(key);
    if (!b) {
      const data = renderPattern(kind, sound, c.sampleRate);
      b = c.createBuffer(1, data.length, c.sampleRate);
      b.getChannelData(0).set(data);
      buffers.set(key, b);
    }
    return b;
  }

  function ensureCtx(): AudioContext | null {
    if (ctx) return ctx;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.15;
      comp.connect(ctx.destination);
      ctx.onstatechange = () => syncState();
      return ctx;
    } catch {
      ctx = null;
      state = 'unsupported';
      return null;
    }
  }

  function fadeOutAndStop(a: Active): void {
    const c = ctx;
    if (!c) return;
    try {
      const t = c.currentTime;
      a.gain.gain.cancelScheduledValues(t);
      a.gain.gain.setValueAtTime(a.gain.gain.value, t);
      a.gain.gain.linearRampToValueAtTime(0, t + 0.03);
      a.src.stop(t + 0.05);
    } catch {
      try {
        a.src.stop();
      } catch {
        /* ignore */
      }
    }
  }

  function startNow(kind: AlarmKind, sound: SoundId, volume: number): void {
    const c = ctx;
    if (!c || !comp) return;
    try {
      const src = c.createBufferSource();
      src.buffer = getBuffer(kind, sound);
      src.loop = true;
      const gain = c.createGain();
      gain.gain.value = clamp01(volume);
      src.connect(gain);
      gain.connect(comp);
      src.start();
      active = { kind, sound, src, gain };
    } catch {
      active = null;
    }
  }

  async function unlock(): Promise<boolean> {
    const c = ensureCtx();
    if (!c) return false;
    try {
      await c.resume();
    } catch {
      /* fall through to state check */
    }
    syncState();
    if (c.state !== 'running') return false;
    try {
      const src = c.createBufferSource();
      const data = renderChirp(c.sampleRate);
      const b = c.createBuffer(1, data.length, c.sampleRate);
      b.getChannelData(0).set(data);
      src.buffer = b;
      const g = c.createGain();
      g.gain.value = 0.6;
      src.connect(g);
      g.connect(comp!);
      src.start();
    } catch {
      /* chirp is best-effort */
    }
    return true;
  }

  function kick(): void {
    if (ctx && ctx.state !== 'running') {
      try {
        void ctx.resume().catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }

  function setVolume(volume: number): void {
    if (pending) pending.volume = volume;
    if (!active || !ctx) return;
    try {
      active.gain.gain.setTargetAtTime(clamp01(volume), ctx.currentTime, 0.03);
    } catch {
      /* ignore */
    }
  }

  return {
    get state() {
      return state;
    },
    unlock,
    start(kind, sound, volume) {
      setAlarmDataset(kind);
      const same = active && active.kind === kind && (kind !== 'alarm' || active.sound === sound);
      if (same && ctx) {
        pending = null;
        setVolume(volume);
        kick();
        return;
      }
      if (active) {
        fadeOutAndStop(active);
        active = null;
      }
      if (!ctx) {
        pending = { kind, sound, volume };
        return;
      }
      pending = null;
      startNow(kind, sound, volume);
      kick();
      // If the context is suspended, the source plays once it resumes; unlock() re-resumes.
    },
    stop() {
      pending = null;
      if (active) {
        fadeOutAndStop(active);
        active = null;
      }
      setAlarmDataset('off');
    },
    preview(kind, sound, volume) {
      const c = ctx;
      if (!c || !comp || c.state !== 'running') return;
      try {
        const src = c.createBufferSource();
        src.buffer = getBuffer(kind, sound);
        const gain = c.createGain();
        const t = c.currentTime;
        gain.gain.setValueAtTime(clamp01(volume), t);
        gain.gain.setValueAtTime(clamp01(volume), t + 1.9);
        gain.gain.linearRampToValueAtTime(0, t + 2.0);
        src.connect(gain);
        gain.connect(comp);
        src.start(t);
        src.stop(t + 2.05);
      } catch {
        /* ignore */
      }
    },
    setVolume,
    onStateChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
