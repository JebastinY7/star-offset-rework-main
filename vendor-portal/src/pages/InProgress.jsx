import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import Pager from "../components/Pager";
import StatusChip, { fmtDate } from "../components/StatusChip";
import UpdateProgress from "../components/UpdateProgress";
import "../assigned.css";
import "../progress.css";

const SORTS = [["due", "Due Date (Earliest)"], ["due_desc", "Due Date (Latest)"], ["newest", "Assigned Date (Newest)"], ["oldest", "Assigned Date (Oldest)"]];
const EMPTY = { q: "", work_type: "", sort: "due" };

// jobs the vendor has accepted and is working on (status accepted / in production)
export default function InProgress() {
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  const [editing, setEditing] = useState(null); // full job shown in the Update Progress dialog
  const [opening, setOpening] = useState(null); // id of the row whose dialog is loading
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  useEffect(() => {
    const ctrl = new AbortController();
    const params = { status: "active", page, per_page: size };
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
  const filtered = JSON.stringify(applied) !== JSON.stringify(EMPTY);

  const search = (e) => { e.preventDefault(); setApplied(draft); setPage(1); };
  const clear = () => { setDraft(EMPTY); setApplied(EMPTY); setPage(1); };

  const openUpdate = async (id) => {
    setOpening(id); setError("");
    try { setEditing((await api.get(`/vendor/jobs/${id}/`)).data.job); }
    catch (e) { setError(errorText(e)); }
    setOpening(null);
  };

  return (
    <div className="aw">
      <div className="aw-head">
        <h1>In Progress</h1>
        <p>Work you have accepted and are producing. Update it as you go.</p>
      </div>

      <form className="aw-filters three" onSubmit={search}>
        <div className="aw-f">
          <label htmlFor="ip-q">Search</label>
          <div className="aw-in aw-search"><Icon name="search" size={18} />
            <input id="ip-q" value={draft.q} onChange={set("q")} placeholder="Search by order no. or work type..." /></div>
        </div>
        <div className="aw-f">
          <label htmlFor="ip-type">Work Type</label>
          <select id="ip-type" className="aw-select" value={draft.work_type} onChange={set("work_type")}>
            <option value="">All Work Types</option>
            {(data?.work_types || []).map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="aw-f">
          <label htmlFor="ip-sort">Sort By</label>
          <select id="ip-sort" className="aw-select" value={draft.sort} onChange={set("sort")}>
            {SORTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
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
              <th>#</th><th>Order No.</th><th>Work Type</th><th>Product Details</th><th>Progress</th>
              <th>Due Date</th><th>Status</th><th>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const pct = r.qty ? Math.min(100, Math.round((r.qty_done / r.qty) * 100)) : 0;
                return (
                  <tr key={r.id}>
                    <td>{start + i + 1}</td><td>{r.order_no}</td><td>{r.items_text}</td><td>{r.product || "—"}</td>
                    <td><div className="ip-prog"><div className="ip-bar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${pct}%` }} /></div>
                      <small>{Number(r.qty_done).toLocaleString("en-IN")} / {Number(r.qty).toLocaleString("en-IN")} pcs</small></div></td>
                    <td>{fmtDate(r.due_date)}</td>
                    <td><StatusChip status={r.status} label={r.status_label} overdue={r.is_overdue} /></td>
                    <td><div className="ip-actions">
                      <button type="button" className="aw-view accent" onClick={() => openUpdate(r.id)} disabled={opening === r.id}>{opening === r.id ? "Opening…" : "Update"}</button>
                      <Link to={`/assigned/${r.id}`} className="aw-view"><Icon name="eye" size={18} /> View</Link>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data && !error && <div className="aw-empty">Loading…</div>}
          {data && rows.length === 0 && !error && <div className="aw-empty">{filtered ? "No work matches these filters." : "Nothing is in progress right now. Accept a job from Assigned Work to start."}</div>}
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

      {editing && <UpdateProgress job={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setTries((t) => t + 1); }} />}
    </div>
  );
}
