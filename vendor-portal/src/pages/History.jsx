import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import Pager from "../components/Pager";
import StatusChip, { fmtDate } from "../components/StatusChip";
import "../assigned.css";
import "../lists.css";
import "../profile.css";

const STATUSES = [["completed", "Completed"], ["rejected", "Rejected"], ["cancelled", "Cancelled"]];
const EMPTY = { q: "", status: "", date_from: "", date_to: "" };
const rupees = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// every job that is finished: completed, or rejected / cancelled. Totals on top, searchable list below.
export default function History() {
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  useEffect(() => {
    const ctrl = new AbortController();
    const params = { page, per_page: size, sort: "recent", status: applied.status || "closed" };
    ["q", "date_from", "date_to"].forEach((k) => { if (applied[k]) params[k] = applied[k]; });
    if (!summary) params.summary = 1;
    setError("");
    api.get("/vendor/jobs/", { params, signal: ctrl.signal })
      .then((r) => { setData(r.data); if (r.data.summary) setSummary(r.data.summary); })
      .catch((e) => { if (e.code !== "ERR_CANCELED") { setError(errorText(e)); setData((d) => d || { results: [], total_count: 0, pages: 1, page: 1 }); } });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, page, size, tries]);

  const rows = data?.results || [];
  const total = data?.total_count ?? 0;
  const pages = data?.pages ?? 1;
  const cur = data?.page ?? page;
  const start = (cur - 1) * size;
  const filtered = JSON.stringify(applied) !== JSON.stringify(EMPTY);
  const s = summary;

  const CARDS = [
    { cls: "green", icon: "checkcircle", value: s ? s.completed : "—", label: "Completed Jobs" },
    { cls: "blue", icon: "box", value: s ? Number(s.pieces).toLocaleString("en-IN") : "—", label: "Pieces Completed" },
    { cls: "navy", icon: "receipt", value: s ? rupees(s.earned) : "—", label: "Value of Completed Work" },
    { cls: "red", icon: "close", value: s ? s.rejected + s.cancelled : "—", label: "Rejected / Cancelled" },
  ];

  const search = (e) => { e.preventDefault(); setApplied(draft); setPage(1); };
  const clear = () => { setDraft(EMPTY); setApplied(EMPTY); setPage(1); };

  return (
    <div className="aw">
      <div className="aw-head">
        <h1>History</h1>
        <p>A record of all your finished work with Star Offset Printing.</p>
      </div>

      <section className="hs-cards" aria-label="History totals">
        {CARDS.map((c) => (
          <div className={`hs-card ${c.cls}`} key={c.label}>
            <span className="hs-ico"><Icon name={c.icon} size={24} /></span>
            <span><b>{c.value}</b><small>{c.label}</small></span>
          </div>
        ))}
      </section>

      <form className="aw-filters three" onSubmit={search}>
        <div className="aw-f">
          <label htmlFor="hs-q">Search</label>
          <div className="aw-in aw-search"><Icon name="search" size={18} />
            <input id="hs-q" value={draft.q} onChange={set("q")} placeholder="Search by order no. or work type..." /></div>
        </div>
        <div className="aw-f">
          <label htmlFor="hs-status">Status</label>
          <select id="hs-status" className="aw-select" value={draft.status} onChange={set("status")}>
            <option value="">All Finished Work</option>
            {STATUSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="aw-f">
          <span>Assigned Between</span>
          <div className="aw-range">
            <input type="date" aria-label="Assigned from" value={draft.date_from} onChange={set("date_from")} />
            <i>–</i>
            <input type="date" aria-label="Assigned to" value={draft.date_to} onChange={set("date_to")} />
          </div>
        </div>
        <div className="aw-actions">
          <button type="button" className="aw-btn" onClick={clear}><Icon name="refresh" size={18} /> Clear</button>
          <button type="submit" className="aw-btn accent"><Icon name="search" size={18} /> Search</button>
        </div>
      </form>

      {error && <div className="alert error"><span>{error}</span>
        <button type="button" onClick={() => setTries((t) => t + 1)}><Icon name="refresh" size={14} /> Retry</button></div>}

      <section className="aw-card">
        <div className="aw-table-wrap">
          <table className="aw-table">
            <thead><tr>
              <th>#</th><th>Order No.</th><th>Work Type</th><th>Quantity</th><th>Assigned Date</th><th>Closed Date</th><th>Status</th><th>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{start + i + 1}</td><td>{r.order_no}</td><td>{r.items_text}</td>
                  <td>{Number(r.qty).toLocaleString("en-IN")} pcs</td><td>{fmtDate(r.assigned_at)}</td><td>{fmtDate(r.updated_at)}</td>
                  <td><StatusChip status={r.status} label={r.status_label} /></td>
                  <td><Link to={`/assigned/${r.id}`} className="aw-view sm">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data && !error && <div className="aw-empty">Loading…</div>}
          {data && rows.length === 0 && !error && <div className="aw-empty">{filtered ? "No work matches these filters." : "No finished work yet. Completed, rejected and cancelled jobs will show up here."}</div>}
        </div>

        <div className="aw-foot">
          <span>{total ? `Showing ${start + 1} to ${start + rows.length} of ${total} entries` : "Showing 0 entries"}</span>
          <div className="aw-right">
            <Pager page={cur} pages={pages} onChange={setPage} />
            <select className="aw-select" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }} aria-label="Rows per page">
              {[10, 20, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}
