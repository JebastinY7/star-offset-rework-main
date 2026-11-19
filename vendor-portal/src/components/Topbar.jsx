import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import Icon from "./Icon";
import StatusChip from "./StatusChip";
import ThemeToggle from "./ThemeToggle";
import "../topsearch.css";

// top bar: menu button (mobile), job search, light/dark switch, notifications, account menu
export default function Topbar({ vendor, newCount = 0, quoteCount = 0, onLogout, onMenu }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  const nav = useNavigate();

  // live search: wait for a short pause in typing, then look the text up in this vendor's jobs
  const [sOpen, setSOpen] = useState(false);
  const [found, setFound] = useState(null); // null = not searched yet
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sRef = useRef(null);

  // notification bell: new assignments and price requests are counted separately
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  const bellTotal = newCount + quoteCount;
  const NOTES = [
    { key: "new", ico: "file", count: newCount, to: "/assigned", title: (c) => `${c} new ${c === 1 ? "assignment" : "assignments"}`, hint: "Work given to you. Open it to accept or reject.", cta: "View work", tone: "amber" },
    { key: "quotes", ico: "rupee", count: quoteCount, to: "/price-requests", title: (c) => `${c} ${c === 1 ? "price request" : "price requests"}`, hint: "Star Offset is waiting for your price.", cta: "Send price", tone: "blue" },
  ].filter((n) => n.count > 0);

  useEffect(() => {
    if (!bellOpen) return;
    const away = (e) => { if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setBellOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [bellOpen]);

  useEffect(() => {
    const t = q.trim();
    if (!t) { setFound(null); setLoading(false); setFailed(false); return; }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      api.get("/vendor/jobs/", { params: { q: t, per_page: 10, sort: "newest" }, signal: ctrl.signal })
        .then((r) => { setFound((r.data.results || []).slice(0, 6)); setTotal(r.data.total_count || 0); setFailed(false); setLoading(false); })
        .catch((e) => { if (e.code !== "ERR_CANCELED") { setFound([]); setFailed(true); setLoading(false); } });
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q]);

  useEffect(() => {
    if (!sOpen) return;
    const away = (e) => { if (sRef.current && !sRef.current.contains(e.target)) setSOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setSOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [sOpen]);

  const openJob = (id) => { setSOpen(false); setQ(""); nav(`/assigned/${id}`); };

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const person = vendor.owner_name || vendor.name;
  const initials = person.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  const search = (e) => {
    e.preventDefault();
    const t = q.trim();
    setSOpen(false);
    nav(t ? `/assigned?q=${encodeURIComponent(t)}` : "/assigned");
  };

  return (
    <header className="topbar">
      <button type="button" className="tb-menu" onClick={onMenu} aria-label="Open menu"><Icon name="menu" size={22} /></button>

      <div className="tb-search-wrap" ref={sRef}>
        <form className="tb-search" onSubmit={search} role="search">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => { setQ(e.target.value); setSOpen(true); }} onFocus={() => setSOpen(true)}
            placeholder="Search by order no. or work type..." aria-label="Search jobs" autoComplete="off" />
          {q && <button type="button" className="tb-clear" onClick={() => { setQ(""); setSOpen(false); }} aria-label="Clear search"><Icon name="close" size={16} /></button>}
        </form>
        {sOpen && q.trim() && (
          <div className="ts-panel" role="listbox">
            {loading && <div className="ts-msg">Searching…</div>}
            {!loading && failed && <div className="ts-msg">Could not search right now. Please try again.</div>}
            {!loading && !failed && found && found.length === 0 && (
              <div className="ts-msg ts-none"><Icon name="search" size={18} /> Not available — nothing matches “{q.trim()}”.</div>
            )}
            {!loading && !failed && found && found.length > 0 && (
              <>
                {found.map((r) => (
                  <button type="button" key={r.id} className="ts-row" role="option" onClick={() => openJob(r.id)}>
                    <span className="ts-main"><b>{r.order_no}</b><small>{r.items_text} · {Number(r.qty).toLocaleString("en-IN")} pcs</small></span>
                    <StatusChip status={r.status} label={r.status_label} overdue={r.is_overdue} />
                  </button>
                ))}
                {total > found.length && (
                  <button type="button" className="ts-all" onClick={search}>See all {total} results</button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="tb-right">
        <ThemeToggle />
        <div className="bell-wrap" ref={bellRef}>
          <button type="button" className="tb-bell" onClick={() => setBellOpen((o) => !o)} aria-haspopup="menu" aria-expanded={bellOpen}
            aria-label={bellTotal ? `${bellTotal} notifications` : "Notifications"}>
            <Icon name="bell" size={22} />
            {bellTotal > 0 && <em>{bellTotal > 9 ? "9+" : bellTotal}</em>}
          </button>
          {bellOpen && (
            <div className="dropdown bell-menu" role="menu">
              <div className="bell-head">
                <strong>Notifications</strong>
                {bellTotal > 0 && <span className="bell-total">{bellTotal} new</span>}
              </div>
              {NOTES.length === 0 && (
                <div className="bell-empty">
                  <span className="bell-empty-ico"><Icon name="checkcircle" size={26} /></span>
                  <b>You are all caught up</b>
                  <small>New work and price requests will appear here.</small>
                </div>
              )}
              {NOTES.map((n) => (
                <button type="button" key={n.key} role="menuitem" className="bell-item" onClick={() => { setBellOpen(false); nav(n.to); }}>
                  <span className={`bell-ico ${n.tone}`}><Icon name={n.ico} size={22} /></span>
                  <span className="bell-text">
                    <b>{n.title(n.count)}</b>
                    <small>{n.hint}</small>
                    <span className="bell-cta">{n.cta} <Icon name="chevright" size={14} /></span>
                  </span>
                  <i className="bell-dot" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="user-menu" ref={ref}>
          <button type="button" className="user-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
            <span className="avatar">{initials}</span>
            <span className="user-text"><b>{person}</b><small>{vendor.name}</small></span>
            <Icon name="chevron" size={16} className={`chev${open ? " open" : ""}`} />
          </button>
          {open && (
            <div className="dropdown" role="menu">
              <div className="dropdown-head"><strong>{vendor.name}</strong><small>@{vendor.username}</small></div>
              <button type="button" role="menuitem" className="dd-logout" onClick={() => { setOpen(false); nav("/profile"); }}><Icon name="user" size={17} /> Profile</button>
              <button type="button" role="menuitem" className="dd-logout" onClick={onLogout}><Icon name="logout" size={17} /> Logout</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
