import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import Pager from "../components/Pager";
import StatusChip, { fmtDate } from "../components/StatusChip";
import "../assigned.css";

const STATUSES = [
  ["assigned", "New"], ["accepted", "Accepted"], ["in_progress", "In Production"], ["ready", "Ready"],
  ["overdue", "Overdue"], ["completed", "Completed"], ["rejected", "Rejected"],
];
const SORTS = [["newest", "Assigned Date (Newest)"], ["oldest", "Assigned Date (Oldest)"], ["due", "Due Date (Earliest)"], ["due_desc", "Due Date (Latest)"]];
const EMPTY = { q: "", status: "", work_type: "", date_from: "", date_to: "", sort: "newest" };

export default function AssignedWork() {
  const [draft, setDraft] = useState(EMPTY);     // what the inputs show
  const [applied, setApplied] = useState(EMPTY); // what was last searched
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  useEffect(() => {
    const ctrl = new AbortController();
    const params = { page, per_page: size };
    Object.entries(applied).forEach(([k, v]) => { if (v) params[k] = v; });
    setError("");
    api.get("/vendor/jobs/", { params, signal: ctrl.signal })
      .then((r) => setData(r.data))
      .catch((e) => { if (e.code !== "ERR_CANCELED") { setError(errorText(e)); setData((d) => d || { results: [], total_count: 0, pages: 1, page: 1, work_types: [] }); } });
    return () => ctrl.abort();
  }, [applied, page, size, tries]);

  const rows = data?.results || [];
  const total = data?.total_count ?? 0;
  const pages = data?.pages ?? 1;
  const cur = data?.page ?? page;
  const start = (cur - 1) * size;

  const search = (e) => { e.preventDefault(); setApplied(draft); setPage(1); };
  const clear = () => { setDraft(EMPTY); setApplied(EMPTY); setPage(1); };

  return (
    <div className="aw">
      <div className="aw-head">
        <h1>Assigned Work</h1>
        <p>All work assigned to you by Star Offset Printing.</p>
      </div>

      <form className="aw-filters" onSubmit={search}>
        <div className="aw-f">
          <label htmlFor="aw-q">Search</label>
          <div className="aw-in aw-search"><Icon name="search" size={18} />
            <input id="aw-q" value={draft.q} onChange={set("q")} placeholder="Search by order no. or work type..." /></div>
        </div>
        <div className="aw-f">
          <label htmlFor="aw-status">Status</label>
          <select id="aw-status" className="aw-select" value={draft.status} onChange={set("status")}>
            <option value="">All Status</option>
            {STATUSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="aw-f">
          <label htmlFor="aw-type">Work Type</label>
          <select id="aw-type" className="aw-select" value={draft.work_type} onChange={set("work_type")}>
            <option value="">All Work Types</option>
            {(data?.work_types || []).map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="aw-f">
          <span>Date Range</span>
          <div className="aw-range">
            <input type="date" aria-label="Assigned from" value={draft.date_from} onChange={set("date_from")} />
            <i>–</i>
            <input type="date" aria-label="Assigned to" value={draft.date_to} onChange={set("date_to")} />
          </div>
        </div>

        <div className="aw-f">
          <label htmlFor="aw-sort">Sort By</label>
          <select id="aw-sort" className="aw-select" value={draft.sort} onChange={set("sort")}>
            {SORTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="aw-actions">
          <button type="button" className="aw-btn" onClick={clear}><Icon name="refresh" size={18} /> Clear Filters</button>
          <button type="submit" className="aw-btn accent"><Icon name="search" size={18} /> Search</button>
        </div>
      </form>

      {error && (
        <div className="alert error"><span>{error}</span>
          <button type="button" onClick={() => setTries((t) => t + 1)}><Icon name="refresh" size={14} /> Retry</button></div>
      )}

      <section className="aw-card">
        <div className="aw-table-wrap">
          <table className="aw-table">
            <thead><tr>
              <th>#</th><th>Order No.</th><th>Work Type</th><th>Product Details</th><th>Quantity</th>
              <th>Assigned Date</th><th>Due Date</th><th>Status</th><th>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{start + i + 1}</td><td>{r.order_no}</td><td>{r.items_text}</td><td>{r.product || "—"}</td>
                  <td>{Number(r.qty).toLocaleString("en-IN")} pcs</td><td>{fmtDate(r.assigned_at)}</td><td>{fmtDate(r.due_date)}</td>
                  <td><StatusChip status={r.status} label={r.status_label} overdue={r.is_overdue} /></td>
                  <td><Link to={`/assigned/${r.id}`} className="aw-view"><Icon name="eye" size={18} /> View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data && !error && <div className="aw-empty">Loading…</div>}
          {data && rows.length === 0 && !error && <div className="aw-empty">{total === 0 && JSON.stringify(applied) === JSON.stringify(EMPTY) ? "No work has been assigned to you yet." : "No work matches these filters."}</div>}
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
