// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAlarmPlayer } from './index';

function fakeCtx() {
  const sources: { loop: boolean; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const param = () => ({ value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() });
  class Ctx {
    state = 'suspended';
    sampleRate = 8000;
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
    createDynamicsCompressor() {
      return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect: vi.fn() };
    }
    createGain() {
      return { gain: param(), connect: vi.fn() };
    }
    createBuffer(_c: number, len: number) {
      const d = new Float32Array(len);
      return { getChannelData: () => d };
    }
    createBufferSource() {
      const s = { loop: false, buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      sources.push(s);
      return s;
    }
    resumeCalls = 0;
    async resume() {
      this.resumeCalls++;
      this.state = 'running';
      this.onstatechange?.();
    }
  }
  return { Ctx, sources };
}

describe('alarm player with fake AudioContext', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.alarm;
  });

  it('locked until unlock; pending start fires after unlock; idempotent', async () => {
    const { Ctx, sources } = fakeCtx();
    vi.stubGlobal('AudioContext', Ctx);
    const p = createAlarmPlayer();
    const states: string[] = [];
    p.onStateChange((s) => states.push(s));
    expect(p.state).toBe('locked');
    p.start('alarm', 'bell', 0.8);
    expect(document.documentElement.dataset.alarm).toBe('alarm');
    expect(sources).toHaveLength(0);
    expect(await p.unlock()).toBe(true);
    expect(p.state).toBe('running');
    expect(states).toContain('running');
    const loops = sources.filter((s) => s.loop);
    expect(loops).toHaveLength(1);
    p.start('alarm', 'bell', 0.5); // idempotent
    expect(sources.filter((s) => s.loop)).toHaveLength(1);
    p.start('gentle', 'bell', 0.5); // different kind restarts
    expect(sources.filter((s) => s.loop)).toHaveLength(2);
    expect(loops[0].stop).toHaveBeenCalled();
    p.stop();
    expect(document.documentElement.dataset.alarm).toBe('off');
  });

  it('stop before unlock cancels the pending request', async () => {
    const { Ctx, sources } = fakeCtx();
    vi.stubGlobal('AudioContext', Ctx);
    const p = createAlarmPlayer();
    p.start('headsUp', 'bell', 1);
    p.stop();
    await p.unlock();
    expect(sources.filter((s) => s.loop)).toHaveLength(0);
  });

  it('start() resumes a suspended context', async () => {
    const { Ctx, sources } = fakeCtx();
    let inst!: InstanceType<typeof Ctx>;
    vi.stubGlobal('AudioContext', class extends Ctx { constructor() { super(); inst = this; } });
    const p = createAlarmPlayer();
    await p.unlock();
    inst.state = 'suspended';
    const before = inst.resumeCalls;
    p.start('alarm', 'bell', 1);
    expect(inst.resumeCalls).toBe(before + 1);
    inst.state = 'suspended';
    p.start('alarm', 'bell', 1); // idempotent path
    expect(inst.resumeCalls).toBe(before + 2);
    expect(sources.filter((s) => s.loop)).toHaveLength(1);
  });
});
