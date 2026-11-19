import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import Pagination from "../components/Pagination";
import WaIcon from "../components/Waicons";
import { avatarColor, fmtListTime, initials, previewText, rangeDates } from "../lib/whatsapp";
import "./messages.css";

// WhatsApp inbox = /messages   (one row per customer phone; the chat itself is /messages/:phone)
// Search, filter and date range are done by the API. Refreshes every 15 seconds.

const PAGE_SIZE = 25; // matches InboxPagination.page_size on the server

const FILTERS = [
  ["all", "All Chats"],
  ["unread", "Unread"],
  ["needs_reply", "Needs Reply"],
  ["replied", "Replied"],
];
const RANGES = [
  ["all", "Any date"],
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["custom", "Custom range"],
];

export function Avatar({ name, phone, className = "" }) {
  const letters = initials(name);
  return (
    <span className={`wx-avatar ${className}${letters ? "" : " none"}`} style={{ background: avatarColor(phone) }}>
      {letters || <WaIcon name="user" size={20} />}
    </span>
  );
}

export default function Messages() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [stats, setStats] = useState({ conversations: 0, unread: 0, needs_reply: 0 });
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");

  // the chat screen sends us back here with these in the URL
  const [page, setPage] = useState(Number(sp.get("page")) || 1);
  const [q, setQ] = useState(sp.get("q") || "");
  const [flt, setFlt] = useState(sp.get("filter") || "all");
  const [range, setRange] = useState(sp.get("range") || "all");
  const [from, setFrom] = useState(sp.get("from") || "");
  const [to, setTo] = useState(sp.get("to") || "");

  const load = useCallback(() => {
    const d = rangeDates(range, from, to);
    const params = { page, page_size: PAGE_SIZE, filter: flt };
    if (q.trim()) params.q = q.trim();
    if (d.from) params.from = d.from;
    if (d.to) params.to = d.to;

    api.get("/messages/", { params })
      .then((r) => {
        setRows(r.data.results);
        setCount(r.data.count);
        if (r.data.stats) setStats(r.data.stats);
        setErr("");
        setLoaded(true);
      })
      .catch((e) => {
        if (e?.response?.status === 404 && page > 1) setPage(page - 1);
        else { setErr(errorText(e)); setLoaded(true); }
      });
  }, [page, q, flt, range, from, to]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const filtered = !!q.trim() || flt !== "all" || range !== "all";

  // so the chat can bring us back to this exact view
  const back = new URLSearchParams(
    Object.entries({ page: page > 1 ? page : "", q: q.trim(), filter: flt !== "all" ? flt : "",
      range: range !== "all" ? range : "", from: range === "custom" ? from : "", to: range === "custom" ? to : "" })
      .filter(([, v]) => v)
  ).toString();
  const chatUrl = (phone) => `/messages/${phone}${back ? `?${back}` : ""}`;

  const setFilter = (v) => { setFlt(v); setPage(1); };
  const clearAll = () => { setQ(""); setFlt("all"); setRange("all"); setFrom(""); setTo(""); setPage(1); };

  const first = count ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, count);

  const cards = [
    { key: "all", cls: "all", icon: "chat", n: stats.conversations, label: "Conversations" },
    { key: "unread", cls: "unread", icon: "inbox", n: stats.unread, label: "Unread" },
    { key: "needs_reply", cls: "reply", icon: "reply", n: stats.needs_reply, label: "Needs Reply" },
  ];

  return (
    <>
      <div className="wx-head">
        <div>
          <h1>Messages</h1>
          <p className="muted">Manage customer conversations and WhatsApp communication.</p>
        </div>
        <button type="button" className="wx-btn-ico" onClick={load}>
          <WaIcon name="refresh" size={16} /> Refresh
        </button>
      </div>

      <div className="wx-stats">
        {cards.map((c) => (
          <button key={c.key} type="button" className={`wx-stat ${c.cls}${flt === c.key ? " on" : ""}`}
            onClick={() => setFilter(c.key)}>
            <span className="wx-stat-ico"><WaIcon name={c.icon} size={20} /></span>
            <div><b>{c.n}</b><span>{c.label}</span></div>
          </button>
        ))}
      </div>

      <div className="wx-filters">
        <div className="search-box">
          <WaIcon name="search" size={16} />
          <input placeholder="Search name / phone / message" value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <select value={flt} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={range} onChange={(e) => { setRange(e.target.value); setPage(1); }}>
          {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="button" disabled={!filtered} onClick={clearAll}>Clear</button>
      </div>

      {range === "custom" && (
        <div className="wx-custom">
          <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <span>to</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
      )}

      {err && <div className="error">{err}</div>}

      <div className="card wx-card">
        <div className="wx-card-head">
          <h3>Conversations <span className="muted">{count} {filtered ? "found" : "total"}</span></h3>
        </div>

        <div className="wx-table-wrap">
          <table className="wx-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="wx-col-phone">Phone</th>
                <th>Last message</th>
                <th>Time</th>
                <th>Status</th>
                <th className="wx-act wx-col-act">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loaded && <tr><td colSpan={6} className="wx-empty-row">Loading…</td></tr>}
              {loaded && rows.length === 0 && (
                <tr><td colSpan={6} className="wx-empty-row">
                  {filtered ? "No conversations match these filters" : "No WhatsApp conversations yet"}
                </td></tr>
              )}
              {rows.map((c) => (
                <tr key={c.phone} className={c.unread ? "unread" : ""} onClick={() => nav(chatUrl(c.phone))}>
                  <td>
                    <div className="wx-who">
                      <Avatar name={c.customer_name} phone={c.phone} />
                      <div style={{ minWidth: 0 }}>
                        <strong className={c.customer_name ? "" : "wx-unknown"}>{c.customer_name || "Unknown"}</strong>
                        <span className="wx-sub-mobile">{c.phone}</span>
                      </div>
                    </div>
                  </td>
                  <td className="wx-col-phone">{c.phone}</td>
                  <td><div className="wx-last"><span>{previewText(c.last_message)}</span></div></td>
                  <td className="wx-time">{fmtListTime(c.last_message.created_at)}</td>
                  <td>
                    {c.unread > 0
                      ? <span className="wx-pill new">{c.unread} new</span>
                      : c.needs_reply
                        ? <span className="wx-pill reply">Needs reply</span>
                        : <span className="wx-pill">Replied</span>}
                  </td>
                  <td className="wx-act wx-col-act">
                    <Link to={chatUrl(c.phone)} onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="wx-open"><WaIcon name="chat" size={15} /> Open</button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="wx-foot">
          <span className="muted">{count ? `Showing ${first}–${last} of ${count}` : "Nothing to show"}</span>
          {pages > 1 && <Pagination page={page} pages={pages} onChange={setPage} />}
        </div>
      </div>
    </>
  );
}