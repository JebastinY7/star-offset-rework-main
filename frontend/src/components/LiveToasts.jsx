import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon";
import { useRealtime, useRealtimeConnection } from "../realtime";
import "../realtime.css";

// Pop-up that slides in when something happens (new order, price quote, order ready ...). Click it to open the page.
// Also keeps the live connection open for as long as the signed-in area is on screen.
const ICON = { whatsapp_message: "message", shop_order: "store", vendor_ready: "truck", vendor_quote: "tag" };
const SHOW_MS = 7000;
const MAX = 3;

export default function LiveToasts() {
  useRealtimeConnection();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const drop = useCallback((id) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  useRealtime((m) => {
    const n = m.type === "notification" ? m.notification : m.type === "vendor_event" ? m : null;
    if (!n) return;
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-(MAX - 1)), { id, kind: n.kind, title: n.title, message: n.message, link: n.link }]);
    setTimeout(() => drop(id), SHOW_MS);
  });

  const open = (t) => { drop(t.id); if (t.link) nav(t.link); };

  return (
    <div className="live-toasts no-print" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="live-toast">
          <button type="button" className="lt-main" onClick={() => open(t)}>
            <span className="lt-ico"><Icon name={ICON[t.kind] || "bell"} size={20} /></span>
            <span className="lt-text"><b>{t.title}</b><span>{t.message}</span></span>
          </button>
          <button type="button" className="lt-x" onClick={() => drop(t.id)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      ))}
    </div>
  );
}
