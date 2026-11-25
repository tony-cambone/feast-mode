/** Calls cb when the page becomes visible again, gains focus, or is restored. Returns unsubscribe. */
export function onResume(cb: () => void): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  const onVis = () => {
    if (document.visibilityState === 'visible') cb();
  };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', cb);
  window.addEventListener('pageshow', cb);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('focus', cb);
    window.removeEventListener('pageshow', cb);
  };
}

export function isFullscreen(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenElement;
}

export async function toggleFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
    } else {
      await document.documentElement.requestFullscreen?.();
    }
  } catch {
    /* ignore: denied or unsupported */
  }
}
