// Notifications : système (quand l'appli est ouverte ou en arrière-plan récent),
// pastille sur l'icône, et export calendrier (.ics) pour des rappels garantis même appli fermée.
import { CONFIG } from './config.js';
import { moments } from './timeline.js';
import { toast } from './ui.js';

const NOTIFIED = 'cai.notified.';

export function notifSupported() {
  return 'Notification' in window;
}

export function notifState() {
  return notifSupported() ? Notification.permission : 'unsupported';
}

export async function askPermission() {
  if (!notifSupported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && notifSupported();
}

export function isIosBrowser() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return ios && !standalone;
}

function keyBytes(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

// Abonne ce téléphone aux notifications push (appli fermée). Renvoie 'ok' ou une raison.
export async function enablePush(store, { ask = false } = {}) {
  if (!store?.pushKey) return 'no-server';
  if (!pushSupported()) return isIosBrowser() ? 'ios-install' : 'unsupported';
  let perm = Notification.permission;
  if (perm === 'default' && ask) perm = await askPermission();
  if (perm !== 'granted') return perm;
  try {
    const key = await store.pushKey();
    if (!key) return 'not-ready';
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const want = keyBytes(key);
    if (sub) {
      const cur = sub.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
      if (cur && (cur.length !== want.length || cur.some((b, i) => b !== want[i]))) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    await store.savePush(sub);
    return 'ok';
  } catch (e) {
    console.warn('push', e);
    return 'error';
  }
}

export async function show(body, tag) {
  if (notifState() === 'granted') {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: './' }, renotify: true };
      if (reg) { await reg.showNotification(CONFIG.APP_NAME, opts); return; }
      new Notification(CONFIG.APP_NAME, opts);
      return;
    } catch { /* on retombe sur le toast */ }
  }
  toast(body);
}

// Appelé à chaque tick : notifie les cartes nouvellement débloquées (une seule fois chacune).
export function notifyNew(dateId, unlockedMoments, { silentFirst } = {}) {
  let seen;
  try { seen = JSON.parse(localStorage.getItem(NOTIFIED + dateId) || 'null'); } catch { seen = null; }
  const first = seen === null;
  seen = new Set(seen || []);
  const fresh = unlockedMoments.filter((m) => !seen.has(m.key));
  fresh.forEach((m) => seen.add(m.key));
  try { localStorage.setItem(NOTIFIED + dateId, JSON.stringify([...seen])); } catch { /* rien */ }
  if (first && silentFirst) return [];
  const last = fresh[fresh.length - 1];
  if (last) show(last.notif, last.key);
  return fresh;
}

export function setBadge(n) {
  try {
    if (n > 0) navigator.setAppBadge?.(n);
    else navigator.clearAppBadge?.();
  } catch { /* non supporté */ }
}

// ---------- Calendrier ----------
function icsDate(ts) {
  return new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function esc(s) {
  return String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
}

export function calendarFile(date, uid) {
  const now = icsDate(Date.now());
  const events = moments(date, uid)
    .filter((m) => m.at > Date.now() && !['invite', 'cadrage', 'verdict'].includes(m.key))
    .map((m) => [
      'BEGIN:VEVENT',
      `UID:${date.id}-${m.key}@coeur-all-in`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(m.at)}`,
      `DTEND:${icsDate(m.at + 5 * 60e3)}`,
      `SUMMARY:${esc('♥ ' + m.notif)}`,
      `DESCRIPTION:${esc('Ouvre Cœur All In : un nouveau message t’attend.')}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(m.notif)}`, 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT',
    ].join('\r\n'));
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Coeur All In//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR'].join('\r\n');
  return new Blob([body], { type: 'text/calendar;charset=utf-8' });
}

export function downloadCalendar(date, uid) {
  const url = URL.createObjectURL(calendarFile(date, uid));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'coeur-all-in.ics';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
