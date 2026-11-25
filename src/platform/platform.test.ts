// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeNotification,
  createTicker,
  createWakeLock,
  notificationPermission,
  onResume,
  requestNotificationPermission,
  showNotification,
} from './index';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fakeNotification(permission: string) {
  const made: { title: string; opts: Record<string, unknown>; close: ReturnType<typeof vi.fn>; onclick?: () => void }[] = [];
  class N {
    static permission = permission;
    static requestPermission = vi.fn(async () => permission);
    close = vi.fn();
    onclick?: () => void;
    constructor(public title: string, public opts: Record<string, unknown>) {
      made.push(this);
    }
  }
  vi.stubGlobal('Notification', N);
  return made;
}

describe('notifications', () => {
  it('unsupported when missing', async () => {
    vi.stubGlobal('Notification', undefined);
    expect(notificationPermission()).toBe('unsupported');
    expect(await requestNotificationPermission()).toBe('unsupported');
    expect(() => showNotification({ tag: 'a', title: 't', body: 'b' })).not.toThrow();
    expect(() => closeNotification('a')).not.toThrow();
  });

  it('no-op when denied', () => {
    const made = fakeNotification('denied');
    showNotification({ tag: 'a', title: 't', body: 'b' });
    expect(made).toHaveLength(0);
  });

  it('shows with options, replaces by tag, closes by tag, click focuses', () => {
    const made = fakeNotification('granted');
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    showNotification({ tag: 'x', title: 'T1', body: 'B' });
    expect(made[0].opts).toMatchObject({ body: 'B', tag: 'x', requireInteraction: true, renotify: true, silent: false });
    showNotification({ tag: 'x', title: 'T2', body: 'B' });
    expect(made[0].close).toHaveBeenCalledTimes(1);
    made[1].onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(made[1].close).toHaveBeenCalledTimes(1);
    showNotification({ tag: 'y', title: 'T3', body: 'B' });
    closeNotification('y');
    expect(made[2].close).toHaveBeenCalledTimes(1);
  });
});

describe('ticker', () => {
  it('falls back to setInterval without Worker, and supports interval change and stop', () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', undefined);
    const cb = vi.fn();
    const t = createTicker(1000, cb);
    vi.advanceTimersByTime(3000);
    expect(cb).toHaveBeenCalledTimes(3);
    t.setIntervalMs(250);
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(7);
    t.stop();
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(7);
  });

  it('falls back when the worker errors', () => {
    vi.useFakeTimers();
    const workers: { onerror?: () => void; terminate: ReturnType<typeof vi.fn> }[] = [];
    class W {
      terminate = vi.fn();
      postMessage = vi.fn();
      onerror?: () => void;
      constructor() {
        workers.push(this);
      }
    }
    vi.stubGlobal('Worker', W);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    const revoke = (URL.revokeObjectURL = vi.fn());
    const cb = vi.fn();
    const t = createTicker(500, cb);
    workers[0].onerror?.();
    expect(workers[0].terminate).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:x');
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(2);
    t.stop();
  });
});

describe('onResume', () => {
  it('fires on visibility, focus, pageshow; unsubscribes', () => {
    const cb = vi.fn();
    const off = onResume(cb);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cb).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    expect(cb).toHaveBeenCalledTimes(3);
    off();
    window.dispatchEvent(new Event('focus'));
    expect(cb).toHaveBeenCalledTimes(3);
  });
});

describe('wake lock', () => {
  it('unsupported when missing', async () => {
    vi.stubGlobal('navigator', {});
    const w = createWakeLock();
    expect(await w.request()).toBe('unsupported');
    expect(w.state).toBe('unsupported');
    await w.release();
  });

  it('error when request rejects, without throwing', async () => {
    vi.stubGlobal('navigator', { wakeLock: { request: vi.fn().mockRejectedValue(new Error('NotAllowed')) } });
    const w = createWakeLock();
    expect(await w.request()).toBe('error');
    await w.release();
  });

  it('active, then re-requests after release event on visibilitychange', async () => {
    const sentinels: { release: ReturnType<typeof vi.fn>; fire: () => void; addEventListener: (e: string, f: () => void) => void }[] = [];
    const request = vi.fn(async () => {
      let l: () => void = () => {};
      const s = { release: vi.fn(async () => {}), addEventListener: (_e: string, f: () => void) => (l = f), fire: () => l() };
      sentinels.push(s);
      return s;
    });
    vi.stubGlobal('navigator', { wakeLock: { request } });
    const w = createWakeLock();
    const seen: string[] = [];
    w.onChange((s) => seen.push(s));
    expect(await w.request()).toBe('active');
    sentinels[0].fire();
    expect(w.state).toBe('released');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(w.state).toBe('active'));
    expect(request).toHaveBeenCalledTimes(2);
    await w.release();
    expect(w.state).toBe('released');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(['active', 'released', 'active', 'released']);
  });

  it('retries on focus after a failed first request', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('NotAllowed'))
      .mockResolvedValue({ release: vi.fn(async () => {}), addEventListener: () => {} });
    vi.stubGlobal('navigator', { wakeLock: { request } });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    const w = createWakeLock();
    expect(await w.request()).toBe('error');
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(w.state).toBe('active'));
    expect(request).toHaveBeenCalledTimes(2);
    await w.release();
  });
});
