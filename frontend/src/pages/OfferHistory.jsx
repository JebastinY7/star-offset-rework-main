import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";
import Pagination from "../components/Pagination";
import {
  OFFER_CATEGORIES, OFFER_GROUPS, OFFER_STATUS, fmtOfferDate, offerLabel, validityText,
} from "../lib/offers";
import "./offers.css";

// Offers that were sent (and saved drafts) = /offers/history   (admin only)

const PAGE_SIZE = 8; // matches OfferPagination on the server

const localDay = (d) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD in the browser's timezone
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDay(d); };
const RANGES = {
  "": "Any date",
  today: "Today",
  week: "Last 7 days",
  month: "Last 30 days",
  custom: "Custom range…",
};
const rangeDates = (range, from, to) => {
  if (range === "today") return { date_from: localDay(new Date()), date_to: localDay(new Date()) };
  if (range === "week") return { date_from: daysAgo(6) };
  if (range === "month") return { date_from: daysAgo(29) };
  if (range === "custom") return { date_from: from || undefined, date_to: to || undefined };
  return {};
};

const audience = (o) => (o.group === "selected"
  ? `Selected${o.total_recipients ? ` (${o.total_recipients})` : ""}`
  : offerLabel(OFFER_GROUPS, o.group));
const categoryOf = (o) => (o.group === "selected" ? "—" : offerLabel(OFFER_CATEGORIES, o.category));

function StatusPill({ status }) {
  const [label, tone] = OFFER_STATUS[status] || [status, ""];
  return <span className={`pill ${tone}`}>{label}</span>;
}

export default function OfferHistory() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [range, setRange] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [view, setView] = useState(null);       // offer whose details are open
  const [confirm, setConfirm] = useState(null); // offer about to be deleted
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    if (!user.is_superuser) return;
    api.get("/offers/history/", { params: { page, q, status, ...rangeDates(range, from, to) } })
      .then((r) => { setRows(r.data.results); setCount(r.data.count); setLoaded(true); })
      .catch((e) => {
        // asking for a page that no longer exists (e.g. after deleting the last row of it)
        if (e?.response?.status === 404 && page > 1) setPage(page - 1);
        else setMsg(errorText(e));
      });
  }, [page, q, status, range, from, to, user.is_superuser]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  // keep the list fresh while an offer is still being sent
  const anySending = rows.some((o) => o.status === "sending");
  useEffect(() => {
    if (!anySending) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [anySending, load]);

  if (!user.is_superuser) {
    return (<><h1>Offers</h1><div className="card">Only admin can view offers.</div></>);
  }

  const filtered = Boolean(q || status || range);
  const resetFilters = () => { setQ(""); setStatus(""); setRange(""); setFrom(""); setTo(""); setPage(1); };
  const filter = (setter) => (e) => { setter(e.target.value); setPage(1); };

  const remove = async () => {
    setMsg(""); setNotice(""); setBusy(true);
    try {
      await api.delete(`/offers/history/${confirm.id}/`);
      setNotice(confirm.status === "draft" ? "Draft deleted" : "Offer deleted from the history");
      setView(null);
    } catch (e) { setMsg(errorText(e)); }
    setBusy(false); setConfirm(null); load();
  };

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const first = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, count);

  return (
    <>
      <div className="of-head">
        <div>
          <h1>Offer History</h1>
          <p className="muted">Review previous campaigns and their delivery results.</p>
        </div>
        <Link to="/offers"><button type="button" className="primary"><Icon name="plus" size={16} />Create Offer</button></Link>
      </div>

      <div className="card of-filters">
        <div className="search-box">
          <Icon name="search" size={16} />
          <input placeholder="Search offer title" value={q} onChange={filter(setQ)} aria-label="Search offer title" />
        </div>
        <select value={range} onChange={filter(setRange)} aria-label="Date range">
          {Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={status} onChange={filter(setStatus)} aria-label="Delivery status">
          <option value="">All delivery status</option>
          {Object.entries(OFFER_STATUS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button type="button" disabled={!filtered} onClick={resetFilters}>Clear</button>
      </div>

      {range === "custom" && (
        <div className="of-range">
          <span className="muted">From</span>
          <input type="date" value={from} max={to || undefined} onChange={filter(setFrom)} aria-label="From date" />
          <span className="muted">to</span>
          <input type="date" value={to} min={from || undefined} onChange={filter(setTo)} aria-label="To date" />
        </div>
      )}

      {msg && <div className="error">{msg}</div>}
      {notice && <div className="success">{notice}</div>}

      <div className="card of-table-card">
        <div className="of-table-wrap">
          <table className="of-table">
            <thead>
              <tr>
                <th>Date</th><th>Offer</th><th>Audience</th><th>Category</th><th>Sent</th><th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loaded && <tr><td colSpan={7} className="of-empty">Loading…</td></tr>}
              {loaded && rows.length === 0 && (
                <tr><td colSpan={7} className="of-empty">{filtered ? "No offers match these filters" : "No offers yet. Create your first offer."}</td></tr>
              )}
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="of-date">{fmtOfferDate(o.created_at)}</td>
                  <td>
                    <span className="of-offer-title">{o.title}</span>
                    <span className="of-offer-sub">{o.message}</span>
                  </td>
                  <td>{audience(o)}</td>
                  <td>{categoryOf(o)}</td>
                  <td className="of-sent">
                    {o.status === "draft" ? "—" : o.total_sent}
                    {o.failed > 0 && <small className="bad">{o.failed} failed</small>}
                  </td>
                  <td><StatusPill status={o.status} /></td>
                  <td>
                    <div className="of-acts">
                      {o.status === "draft" && <Link to={`/offers?draft=${o.id}`}><button type="button" className="primary">Continue</button></Link>}
                      <button type="button" onClick={() => setView(o)}><Icon name="eye" size={14} />View</button>
                      <button type="button" className="danger icon-only" title="Delete" aria-label={`Delete ${o.title}`} onClick={() => setConfirm(o)}>
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="of-foot">
          <span className="muted">Showing {first}–{last} of {count} offer{count === 1 ? "" : "s"}</span>
          {pages > 1 && <Pagination page={page} pages={pages} onChange={setPage} maxVisible={3} />}
        </div>
      </div>

      {view && (
        <div className="modal-bg">
          <div className="card modal wide" role="dialog" aria-modal="true" aria-label={view.title} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 style={{ fontSize: 18 }}>{view.title}</h2>
              <StatusPill status={view.status} />
            </div>
            <div className="modal-body" style={{ gap: 14 }}>
              <dl className="of-detail">
                <div><dt>Created</dt><dd>{fmtOfferDate(view.created_at)}</dd></div>
                <div><dt>Audience</dt><dd>{audience(view)}</dd></div>
                <div><dt>Category</dt><dd>{categoryOf(view)}</dd></div>
                <div><dt>Delivered</dt><dd>{view.status === "draft" ? "Not sent" : `${view.total_sent}${view.total_recipients ? ` of ${view.total_recipients}` : ""}`}</dd></div>
                {view.failed > 0 && <div><dt>Failed</dt><dd className="bad">{view.failed}</dd></div>}
                <div><dt>Validity</dt><dd>{validityText(view.valid_from, view.valid_until) || "No validity set"}</dd></div>
                {view.shop_number && <div><dt>Contact number</dt><dd>{view.shop_number}</dd></div>}
              </dl>
              <div>
                <p className="section-label">Message</p>
                <p className="of-msgbox">{view.message || "—"}</p>
              </div>
            </div>
            <div className="modal-foot">
              <button className="danger grow" onClick={() => setConfirm(view)}>Delete</button>
              {view.status === "draft" && <Link to={`/offers?draft=${view.id}`}><button className="primary">Continue editing</button></Link>}
              <button onClick={() => setView(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="modal-bg" style={{ zIndex: 11 }}>
          <div className="card modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>{confirm.status === "draft" ? "Delete Draft" : "Delete Offer"}</h2>
            <p>
              Delete “{confirm.title}” from the history?
              {confirm.status !== "draft" && " Customers who already received it are not affected."}
            </p>
            <div className="row">
              <button disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
              <button className="danger" disabled={busy} onClick={remove}>{busy ? "Please wait…" : "Yes, Delete"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
