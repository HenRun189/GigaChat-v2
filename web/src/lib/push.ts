import { api } from './api';

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const isAndroid = () => /Android/i.test(navigator.userAgent);

export function pushSupport(): 'ok' | 'install-first' | 'unsupported' {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return 'unsupported';
  if (!('PushManager' in window)) return isIOS() && !isStandalone() ? 'install-first' : 'unsupported';
  if (isIOS() && !isStandalone()) return 'install-first';
  return 'ok';
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function subscribePush(publicKey: string): Promise<'granted' | 'denied' | 'error'> {
  if (pushSupport() !== 'ok' || !publicKey) return 'error';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  // iOS occasionally needs a moment after permission before subscribe succeeds.
  await new Promise((r) => setTimeout(r, 250));
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
    await api.post('/api/push/subscribe', sub.toJSON());
    return 'granted';
  } catch {
    return 'error';
  }
}

export async function unsubscribePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint });
  } finally {
    await sub.unsubscribe();
  }
}

/** Re-sync an existing browser subscription with the server (e.g. after login on a new account). */
export async function syncSubscription(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await api.post('/api/push/subscribe', sub.toJSON());
  } catch {
    /* ignore */
  }
}
