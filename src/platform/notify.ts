export type NotifPermission = 'granted' | 'denied' | 'default' | 'unsupported';

const live = new Map<string, Notification>();

function hasNotification(): boolean {
  return typeof Notification !== 'undefined';
}

export function notificationPermission(): NotifPermission {
  if (!hasNotification()) return 'unsupported';
  const p = Notification.permission;
  return p === 'granted' || p === 'denied' || p === 'default' ? p : 'default';
}

export async function requestNotificationPermission(): Promise<NotifPermission> {
  if (!hasNotification()) return 'unsupported';
  try {
    await Notification.requestPermission();
  } catch {
    /* older callback-only implementations or blocked contexts */
  }
  return notificationPermission();
}

export function closeNotification(tag: string): void {
  const n = live.get(tag);
  if (!n) return;
  live.delete(tag);
  try {
    n.close();
  } catch {
    /* ignore */
  }
}

export function showNotification(opts: { tag: string; title: string; body: string }): void {
  if (notificationPermission() !== 'granted') return;
  closeNotification(opts.tag);
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      requireInteraction: true,
      renotify: true,
      silent: false,
    } as NotificationOptions);
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      try {
        n.close();
      } catch {
        /* ignore */
      }
      if (live.get(opts.tag) === n) live.delete(opts.tag);
    };
    n.onclose = () => {
      if (live.get(opts.tag) === n) live.delete(opts.tag);
    };
    live.set(opts.tag, n);
  } catch {
    /* ignore: some contexts throw on construction */
  }
}
