export type WakeLockState = 'active' | 'released' | 'unsupported' | 'error';
export interface WakeLockController {
  readonly state: WakeLockState;
  request(): Promise<WakeLockState>;
  release(): Promise<void>;
  onChange(cb: (s: WakeLockState) => void): () => void;
}

export function createWakeLock(): WakeLockController {
  let state: WakeLockState = 'released';
  let sentinel: WakeLockSentinel | null = null;
  let wanted = false; // set after a successful request, cleared by release()
  let inflight: Promise<WakeLockState> | null = null;
  const listeners = new Set<(s: WakeLockState) => void>();

  const api = (): WakeLock | undefined =>
    typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock : undefined;

  function set(s: WakeLockState): void {
    if (s === state) return;
    state = s;
    for (const cb of [...listeners]) {
      try {
        cb(s);
      } catch {
        /* ignore */
      }
    }
  }

  async function acquire(): Promise<WakeLockState> {
    const wl = api();
    if (!wl || typeof wl.request !== 'function') {
      set('unsupported');
      return state;
    }
    try {
      const s = await wl.request('screen');
      sentinel = s;
      s.addEventListener('release', () => {
        if (sentinel === s) {
          sentinel = null;
          if (state === 'active') set('released');
        }
      });
      set('active');
    } catch {
      sentinel = null;
      set('error');
    }
    return state;
  }

  function request(): Promise<WakeLockState> {
    wanted = true;
    if (state === 'active' && sentinel) return Promise.resolve(state);
    if (inflight) return inflight;
    inflight = acquire().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  if (typeof document !== 'undefined') {
    const retry = () => {
      if (document.visibilityState === 'visible' && wanted && !sentinel) void request();
    };
    document.addEventListener('visibilitychange', retry);
    if (typeof window !== 'undefined') window.addEventListener('focus', retry);
  }

  return {
    get state() {
      return state;
    },
    request,
    async release() {
      wanted = false;
      const s = sentinel;
      sentinel = null;
      if (s) {
        try {
          await s.release();
        } catch {
          /* ignore */
        }
      }
      if (state !== 'unsupported') set('released');
    },
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
