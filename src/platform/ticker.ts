export interface Ticker {
  setIntervalMs(ms: number): void;
  stop(): void;
}

const WORKER_SRC = `
let id = null;
function start(ms) { if (id !== null) clearInterval(id); id = setInterval(() => postMessage(0), ms); }
onmessage = (e) => {
  const d = e.data;
  if (d && d.stop) { if (id !== null) clearInterval(id); id = null; return; }
  if (d && typeof d.interval === 'number') start(d.interval);
};
`;

export function createTicker(intervalMs: number, onTick: () => void): Ticker {
  let ms = intervalMs;
  let stopped = false;
  let worker: Worker | null = null;
  let url: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  function cleanupWorker(): void {
    if (worker) {
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
      worker = null;
    }
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
      url = null;
    }
  }

  function startFallback(): void {
    if (stopped) return;
    if (timer !== null) clearInterval(timer);
    timer = setInterval(onTick, ms);
  }

  function fallBack(): void {
    cleanupWorker();
    startFallback();
  }

  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error('no worker support');
    }
    url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = () => {
      if (!stopped) onTick();
    };
    worker.onerror = () => fallBack();
    worker.postMessage({ interval: ms });
  } catch {
    fallBack();
  }

  return {
    setIntervalMs(next) {
      ms = next;
      if (stopped) return;
      if (worker) {
        try {
          worker.postMessage({ interval: ms });
        } catch {
          fallBack();
        }
      } else {
        startFallback();
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      cleanupWorker();
    },
  };
}
