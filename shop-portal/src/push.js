import api from "./api";

// Web Push for this portal: lets the server send notifications while the browser / tab is closed
// (the WebSocket in realtime.js only works while the portal is open). Needs public/sw.js and the backend's
// VAPID keys; when the server has no keys, or the browser has no push support, everything here quietly does nothing.
const BASE = "/shop/push"; // -> /api//shop/push/key/  /subscribe/  /unsubscribe/
const DISMISS_KEY = "push-prompt-dismissed";
const DISMISS_DAYS = 7;

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const toBytes = (b64) => {
  const s = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};
const sameKey = (buf, bytes) => {
  const a = new Uint8Array(buf);
  return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
};

async function registration() {
  await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

async function serverKey() {
  const { data } = await api.get(`${BASE}/key/`);
  return data.enabled ? data.public_key : "";
}

// subscribe this browser (if it is not yet) and tell the server about it
async function sync(publicKey) {
  const key = toBytes(publicKey);
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options?.applicationServerKey && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe(); // the server's keys changed: the old subscription is useless
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.post(`${BASE}/subscribe/`, sub.toJSON());
}

// Is it worth offering the "turn on notifications" button? (server has keys)
export async function pushAvailable() {
  try { return pushSupported() && !!(await serverKey()); } catch { return false; }
}

// Button click -> ask permission, then subscribe.  Returns "granted" | "denied" | "default" | "unsupported" | "unavailable"
export async function enablePush() {
  if (!pushSupported()) return "unsupported";
  const key = await serverKey();
  if (!key) return "unavailable";
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return permission;
  await sync(key);
  lastOk = { endpoint: "", at: 0 };
  return "granted";
}

// Keep this browser registered with the server. Safe to call often: runs one at a time and skips the server call
// if it already succeeded for this subscription in the last 10 minutes. Returns true when the server has the subscription.
let syncing = null;
let lastOk = { endpoint: "", at: 0 };
export function syncPush() {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      if (!pushSupported() || Notification.permission !== "granted") return false;
      const reg = await registration();
      const existing = await reg.pushManager.getSubscription();
      if (existing && existing.endpoint === lastOk.endpoint && Date.now() - lastOk.at < 10 * 60 * 1000) return true;
      const key = await serverKey();
      if (!key) { console.warn("Push: server has no VAPID keys (or this account may not use push)"); return false; }
      await sync(key);
      const sub = await (await registration()).pushManager.getSubscription();
      lastOk = { endpoint: sub ? sub.endpoint : "", at: Date.now() };
      return true;
    } catch (e) {
      console.warn("Push sync failed", e);
      return false;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

// The user can switch notifications on from the lock icon next to the address bar while the portal is already open.
// Nothing reloads then, so without this the browser would never subscribe. Calls onGranted() when permission becomes
// "granted" and again when the tab regains focus. Returns a function that stops watching.
export function watchPermission(onGranted) {
  if (typeof window === "undefined" || !("Notification" in window)) return () => {};
  const run = () => { if (Notification.permission === "granted") onGranted(); };
  const onVisible = () => { if (document.visibilityState === "visible") run(); };
  let status = null;
  window.addEventListener("focus", run);
  document.addEventListener("visibilitychange", onVisible);
  try {
    navigator.permissions?.query({ name: "notifications" }).then((s) => { status = s; s.onchange = run; }).catch(() => {});
  } catch { /* Permissions API not available - focus / visibility still cover it */ }
  return () => {
    window.removeEventListener("focus", run);
    document.removeEventListener("visibilitychange", onVisible);
    if (status) status.onchange = null;
  };
}

// Sign-out: this browser must stop receiving the account's alerts (shared computers!). Never throws.
export async function disablePush() {
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await api.post(`${BASE}/unsubscribe/`, { endpoint: sub.endpoint });
    await sub.unsubscribe();
  } catch { /* offline / already gone - nothing to do */ }
}

export function dismissedRecently() {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return !!t && Date.now() - t < DISMISS_DAYS * 86400000;
  } catch { return false; }
}
export function dismissPrompt() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* storage blocked - ignore */ }
}
