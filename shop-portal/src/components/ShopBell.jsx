import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { makePoller, useRealtime } from "../realtime";
import Icon from "./Icon";

// Shop top-bar bell. The server creates a notification when Star Offset moves an order to a new status
// (payment confirmed, in production, ready ...) or a wallet payment arrives, and pushes it over the WebSocket.
const ICON = { order_status: "box", wallet: "wallet" };

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 172800) return "yesterday";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function ShopBell() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(null);

  const load = useCallback(() => api.get("/shop/notifications/")
    .then((r) => { setUnread(r.data.unread || 0); setRows(r.data.results || []); setLoaded(true); })
    .catch(() => {}), []);

  useEffect(() => { load(); return makePoller(load); }, [load]);
  useEffect(() => { if (open) load(); }, [open, load]);
  useRealtime((m) => { if (m.type === "notification" || m.type === "resync") load(); });

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const markRead = (body) => api.post("/shop/notifications/read/", body).then((r) => setUnread(r.data.unread || 0)).catch(() => {});

  const openItem = (n) => {
    if (!n.read) {
      setRows((rs) => rs.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      markRead({ id: n.id });
    }
    setOpen(false);
    if (n.link) nav(n.link);
  };

  const markAll = () => { setRows((rs) => rs.map((x) => ({ ...x, read: true }))); markRead({ all: true }); };

  return (
    <div className="sbell" ref={ref}>
      <button type="button" className="icon-btn bell" onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open}
        aria-label={`Notifications${unread ? `, ${unread} new` : ""}`} title="Notifications">
        <Icon name="bell" size={20} />
        {unread > 0 && <span className="sbell-dot">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div className="sbell-panel" role="dialog" aria-label="Notifications">
          <div className="sbell-head">
            <strong>Notifications</strong>
            <button type="button" className="sbell-all" disabled={!unread} onClick={markAll}>
              <Icon name="check" size={14} /> Mark all as read
            </button>
          </div>
          <div className="sbell-list">
            {rows.map((n) => (
              <button type="button" key={n.id} className={`sbell-item${n.read ? "" : " unread"}`} onClick={() => openItem(n)}>
                <span className="sbell-ico"><Icon name={ICON[n.kind] || "bell"} size={17} /></span>
                <span className="sbell-body">
                  <b>{n.title}</b>
                  <span>{n.message}</span>
                  <small>{ago(n.created_at)}</small>
                </span>
                {!n.read && <i className="sbell-unread" aria-label="Unread" />}
              </button>
            ))}
            {loaded && rows.length === 0 && (
              <div className="sbell-empty"><Icon name="bell" size={26} /><b>No notifications yet</b><p>Order updates and wallet payments will show here.</p></div>
            )}
            {!loaded && <div className="sbell-empty"><p>Loading…</p></div>}
          </div>
        </div>
      )}
    </div>
  );
}
