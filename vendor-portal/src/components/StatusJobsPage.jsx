import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "./Icon";
import Pager from "./Pager";
import StatusChip, { fmtDate } from "./StatusChip";
import "../assigned.css";
import "../lists.css";

/* One card with a table of the vendor's jobs in a single status (Ready for Pickup, Completed Work...).
   status: API status filter | dateHead/dateOf: the date column | headerRight: extra buttons in the card header
   params: extra query params (e.g. {month}) - the list goes back to page 1 when they change */
export default function StatusJobsPage({ title, subtitle, status, dateHead, dateOf, chipLabel, empty, params = {}, headerRight }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  const key = JSON.stringify(params);

  useEffect(() => { setPage(1); }, [key]);
  useEffect(() => {
    const ctrl = new AbortController();
    setError("");
    api.get("/vendor/jobs/", { params: { ...params, status, sort: "recent", page, per_page: size }, signal: ctrl.signal })
      .then((r) => setData(r.data))
      .catch((e) => { if (e.code !== "ERR_CANCELED") { setError(errorText(e)); setData((d) => d || { results: [], total_count: 0, pages: 1, page: 1 }); } });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, status, page, size, tries]);

  const rows = data?.results || [];
  const total = data?.total_count ?? 0;
  const pages = data?.pages ?? 1;
  const cur = data?.page ?? page;
  const start = (cur - 1) * size;

  return (
    <div className="aw">
      {error && <div className="alert error"><span>{error}</span>
        <button type="button" onClick={() => setTries((t) => t + 1)}><Icon name="refresh" size={14} /> Retry</button></div>}

      <section className="aw-card sl-card">
        <div className="sl-head">
          <div><h1>{title}</h1><p>{subtitle}</p></div>
          {headerRight && <div className="sl-tools">{headerRight}</div>}
        </div>

        <div className="aw-table-wrap sl-wrap">
          <table className="aw-table sl-table">
            <thead><tr>
              <th>#</th><th>Order No.</th><th>Work Type</th><th>Quantity</th><th>{dateHead}</th><th>Status</th><th>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{start + i + 1}</td><td>{r.order_no}</td><td>{r.items_text}</td>
                  <td>{Number(r.qty).toLocaleString("en-IN")} pcs</td><td>{fmtDate(dateOf(r))}</td>
                  <td><StatusChip status={r.status} label={chipLabel || r.status_label} /></td>
                  <td><Link to={`/assigned/${r.id}`} className="aw-view sm">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data && !error && <div className="aw-empty">Loading…</div>}
          {data && rows.length === 0 && !error && <div className="aw-empty">{empty}</div>}
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
