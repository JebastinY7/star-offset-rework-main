import { useEffect, useRef } from "react";
import api from "./api";

// Live channel (WebSocket) to the server: the server pushes events, this file keeps ONE connection per tab,
// reconnects by itself, and hands every message to whoever called useRealtime().
//
// Messages: { type: "notification", notification }  { type: "wallet" }  { type: "messages" }
//           { type: "vendor_event", kind, title, message, link }   (see star_admin/live_events.py)
// Every ping also says whether this tab is on screen ({type:"ping", visible}); the server uses that to skip the
// Web Push / fallback email for someone who is looking at the portal right now (star_admin/push.py).
//           { type: "resync" }  <- made here each time the socket (re)connects: "re-read your data, you may have missed something".
//
// Local dev: Vite forwards /ws to Django (vite.config.js).  Production: either proxy /ws to the backend, or set
//   VITE_WS_URL=wss://<backend-host>/ws/notifications/   in this app's environment.
const TICKET_URL = "/shop/ws-ticket/";
const MAX_DELAY = 30000;

const listeners = new Set();
let users = 0; // components that want the connection (the Layout)
let socket = null;
let retry = 0;
let retryTimer = null;
let pingTimer = null;

const sendPing = () => {
  if (socket?.readyState === 1) socket.send(JSON.stringify({ type: "ping", visible: document.visibilityState === "visible" }));
};
const emit = (msg) => listeners.forEach((fn) => { try { fn(msg); } catch (e) { console.error(e); } });

function wsUrl(ticket) {
  const base = import.meta.env.VITE_WS_URL
    || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/notifications/`;
  return `${base}${base.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(ticket)}`;
}

function schedule() {
  clearTimeout(retryTimer);
  if (!users) return;
  retryTimer = setTimeout(open, Math.min(MAX_DELAY, 1000 * 2 ** retry) + Math.random() * 500);
  retry += 1;
}

async function open() {
  if (!users || socket) return;
  let ticket;
  try {
    ticket = (await api.get(TICKET_URL)).data.ticket;
  } catch (e) {
    const s = e?.response?.status;
    if (s === 401 || s === 403) return; // signed out: nothing to listen for
    schedule();
    return;
  }
  if (!users || socket) return;
  let sock;
  try { sock = new WebSocket(wsUrl(ticket)); } catch { schedule(); return; }
  socket = sock;
  sock.onopen = () => {
    retry = 0;
    clearInterval(pingTimer);
    sendPing();
    pingTimer = setInterval(sendPing, 25000);
  };
  sock.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "ready") emit({ type: "resync" });
    else if (m.type !== "pong") emit(m);
  };
  sock.onclose = () => { if (socket === sock) socket = null; clearInterval(pingTimer); schedule(); };
  sock.onerror = () => { try { sock.close(); } catch { /* already closed */ } };
}

const reconnectNow = () => { if (users && !socket) { clearTimeout(retryTimer); retry = 0; open(); } };
window.addEventListener("online", reconnectNow);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reconnectNow(); sendPing(); });

function release() {
  users = Math.max(0, users - 1);
  if (users) return;
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  const s = socket;
  socket = null;
  if (s) { s.onclose = null; try { s.close(); } catch { /* already closed */ } }
}

export const isLive = () => socket?.readyState === 1;

// Safety net: poll like before while the socket is down; while it is up only check every 2 minutes.
export function makePoller(fn, every = 20000) {
  let n = 0;
  const t = setInterval(() => { n += 1; if (!isLive() || n % 6 === 0) fn(); }, every);
  return () => clearInterval(t);
}

// Layout: keep the connection open while the signed-in area is on screen.
export function useRealtimeConnection() {
  useEffect(() => { users += 1; if (users === 1) { retry = 0; open(); } return release; }, []);
}

// Any component: run handler(message) for every live message.
export function useRealtime(handler) {
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  useEffect(() => {
    const fn = (m) => ref.current(m);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
}
