import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import { makePoller, useRealtime } from "../realtime";
import Icon from "./Icon";

// Top-bar bell. Kinds of notification (created by the server):
//   whatsapp_message - a customer sent a WhatsApp message
//   shop_order   - a shop placed a new order
//   vendor_ready - a vendor marked a job "ready for pickup"
//   vendor_quote - a vendor answered a price request (sent a price, or cannot do the work)
const KIND = {
  whatsapp_message: { icon: "message", cls: "chat" },
  shop_order: { icon: "store", cls: "shop" },
  vendor_ready: { icon: "truck", cls: "vendor" },
  vendor_quote: { icon: "tag", cls: "vendor" },
};

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 172800) return "yesterday";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function NotificationBell() {
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(null);

  const load = useCallback(() => api.get("/admin/notifications/")
    .then((r) => { setUnread(r.data.unread || 0); setRows(r.data.results || []); setLoaded(true); })
    .catch(() => {}), []);

  // refresh after every page change and each time the panel opens; the server pushes new ones over the
  // WebSocket (below) - the timer is only a fallback for when that connection is down
  useEffect(() => { load(); return makePoller(load); }, [load, pathname]);
  useRealtime((m) => { if (m.type === "notification" || m.type === "resync") load(); });
  useEffect(() => { if (open) load(); }, [open, load]);

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const markRead = (body) => api.post("/admin/notifications/read/", body).then((r) => setUnread(r.data.unread || 0)).catch(() => {});

  // a notification disappears as soon as it is opened (together with the others that open the same page)
  const openItem = (n) => {
    setRows((rs) => rs.filter((x) => x.id !== n.id && !(n.link && x.link === n.link)));
    markRead({ id: n.id });
    setOpen(false);
    if (n.link) nav(n.link);
  };

  const markAll = () => { setRows([]); setUnread(0); markRead({ all: true }); };

  // opening the page some other way (menu, typed address) also clears the notifications that point to it
  useEffect(() => {
    const here = pathname + search;
    setRows((rs) => (rs.some((x) => x.link === here) ? rs.filter((x) => x.link !== here) : rs));
    api.post("/admin/notifications/read/", { link: here }).then((r) => setUnread(r.data.unread || 0)).catch(() => {});
  }, [pathname, search]);

  return (
    <div className="notif" ref={ref}>
      <button type="button" className={`icon-btn bell${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)}
        aria-haspopup="true" aria-expanded={open} aria-label={`Notifications${unread ? `, ${unread} new` : ""}`} title="Notifications">
        <Icon name="bell" size={20} />
        {unread > 0 && <span className="bell-dot notif-dot">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            <button type="button" className="notif-all" disabled={!unread} onClick={markAll}>
              <Icon name="check" size={14} /> Mark all as read
            </button>
          </div>
          <div className="notif-list">
            {rows.map((n) => {
              const k = KIND[n.kind] || KIND.shop_order;
              return (
                <button type="button" key={n.id} className="notif-item unread" onClick={() => openItem(n)}>
                  <span className={`notif-ico ${k.cls}`}><Icon name={k.icon} size={17} /></span>
                  <span className="notif-body">
                    <b>{n.title}</b>
                    <span>{n.message}</span>
                    <small>{ago(n.created_at)}</small>
                  </span>
                  <i className="notif-unread" aria-label="Unread" />
                </button>
              );
            })}
            {loaded && rows.length === 0 && (
              <div className="notif-empty"><Icon name="bell" size={26} /><b>No new notifications</b><p>New WhatsApp messages, shop orders, vendor price quotes and jobs ready for pickup will show here.</p></div>
            )}
            {!loaded && <div className="notif-empty"><p>Loading…</p></div>}
          </div>
        </div>
      )}
    </div>
  );
}