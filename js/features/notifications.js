/**
 * Local notifications (no server push). Permission is requested only when
 * the user turns notifications on, never on page load.
 */
export function notificationStatus() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export const STATUS_TEXT = {
  unsupported: 'This browser does not support notifications.',
  default: 'Permission has not been asked yet. It will be requested when you turn notifications on.',
  granted: 'Allowed. Winlark can notify you when a session ends.',
  denied: 'Blocked in the browser. Allow notifications for this site in your browser settings to use them.',
};

export async function requestPermission() {
  const status = notificationStatus();
  if (status !== 'default') return status;
  try {
    return await Notification.requestPermission();
  } catch (err) {
    console.warn('[notify] permission request failed', err);
    return notificationStatus();
  }
}

/** Show a notification if allowed. Prefers the service worker (required on Android). */
export async function notify(title, body, { tag = 'pomofocus-timer', settings } = {}) {
  if (!settings?.notifications?.enabled || notificationStatus() !== 'granted') return false;
  const options = { body, tag, renotify: true, icon: './assets/icons/icon-192.png', badge: './assets/icons/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) { await reg.showNotification(title, options); return true; }
  } catch { /* fall through */ }
  try {
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch (err) {
    console.warn('[notify] could not show notification', err);
    return false;
  }
}
