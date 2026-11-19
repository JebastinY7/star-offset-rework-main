import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import Pagination from "../components/Pagination";
import "./billing.css";
import "./orders.css";
import "./billhistory.css";
import "./membership.css";

// Membership renewals = /membership-history   (admin only, route is wrapped in AdminOnly)

const PAGE_SIZE = 10; // matches MembershipPagination on the server
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

const METHODS = [["", "All"], ["cash", "Cash"], ["upi", "UPI"], ["card", "Card"]];
const METHOD_LABEL = { cash: "Cash", upi: "UPI", card: "Card" };
const RANGES = [["", "Any date"], ["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["last_month", "Last month"], ["custom", "Custom range…"]];
const STATS = [
  ["amount", "Total Collected", "collected", money],
  ["count", "Renewals", "total", (v) => v],
  ["cash", "Cash", "cash", money],
  ["upi", "UPI", "upi", money],
  ["card", "Card", "cardpay", money],
];

export default function MembershipHistory() {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [summary, setSummary] = useState({ count: 0, amount: 0, cash: 0, upi: 0, card: 0 });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [payment, setPayment] = useState("");
  const [range, setRange] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    const params = { page, q, payment };
    if (range === "custom") { params.date_from = from || undefined; params.date_to = to || undefined; }
    else if (range) params.range = range;
    api.get("/membership-history/", { params })
      .then((r) => { setRows(r.data.results); setCount(r.data.count); setSummary(r.data.summary); setLoaded(true); })
      .catch((e) => {
        if (e?.response?.status === 404 && page > 1) setPage(page - 1); // page vanished after a delete
        else setMsg(errorText(e));
      });
  }, [page, q, payment, range, from, to]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const confirmDelete = async () => {
    setMsg(""); setNotice(""); setBusy(true);
    try {
      await api.delete(`/membership-history/${toDelete.id}/`);
      setNotice(`Membership record of ${toDelete.customer.name} deleted and the customer's membership removed`);
    } catch (e) { setMsg(errorText(e)); }
    setBusy(false); setToDelete(null); load();
  };

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const first = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, count);
  const filtered = Boolean(q || payment || range);
  const filter = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const reset = () => { setQ(""); setPayment(""); setRange(""); setFrom(""); setTo(""); setPage(1); };

  return (
    <>
      <div className="od-head">
        <div>
          <h1>Membership History</h1>
          <p className="muted">Every membership payment and renewal, with its validity period.</p>
        </div>
        <Link to="/customers"><button type="button" className="primary big"><Icon name="users" size={16} />Go to Customers</button></Link>
      </div>

      <div className="od-stats mh-stats">
        {STATS.map(([key, label, tone, fmt]) => (
          <div key={key} className={`od-stat ${tone}`}>
            <b>{fmt(summary[key] ?? 0)}</b><span>{label}</span>
          </div>
        ))}
      </div>

      <div className="card od-filters">
        <div className="mh-filter-row">
          <div className="search-box">
            <Icon name="search" size={16} />
            <input placeholder="Search customer / phone / member ID" value={q} onChange={filter(setQ)} aria-label="Search memberships" />
          </div>
          <select value={range} onChange={filter(setRange)} aria-label="Date range">
            {RANGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={payment} onChange={filter(setPayment)} aria-label="Payment method">
            <option value="">Payment Method</option>
            {METHODS.slice(1).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button type="button" disabled={!filtered} onClick={reset}>Clear</button>
        </div>
        {range === "custom" && (
          <div className="mh-range">
            <span className="muted">From</span>
            <input type="date" value={from} max={to || undefined} onChange={filter(setFrom)} aria-label="From date" />
            <span className="muted">to</span>
            <input type="date" value={to} min={from || undefined} onChange={filter(setTo)} aria-label="To date" />
          </div>
        )}
        <div className="bl-chips">
          {METHODS.map(([key, label]) => (
            <button key={key} type="button" className={`bl-chip${payment === key ? " on" : ""}`} onClick={() => { setPayment(key); setPage(1); }}>{label}</button>
          ))}
        </div>
      </div>

      {msg && <div className="error">{msg}</div>}
      {notice && <div className="success">{notice}</div>}

      <div className="card od-register">
        <div className="od-reg-head">
          <h3>Membership register<span className="muted">{count} {count === 1 ? "record" : "records"}</span></h3>
          <div className="row">
            <button type="button" className="bh-btn-ico" onClick={load}><Icon name="refresh" size={16} />Refresh</button>
          </div>
        </div>

        <div className="od-table-wrap">
          <table className="od-table bh-table mh-table">
            <thead>
              <tr>
                <th>Customer</th><th>Paid On</th><th>Type</th><th className="num">Amount</th>
                <th>Payment</th><th>Valid From</th><th>Valid Till</th><th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loaded && <tr><td colSpan={8} className="od-empty">Loading…</td></tr>}
              {loaded && rows.length === 0 && <tr><td colSpan={8} className="od-empty">{filtered ? "No records match these filters" : "No membership payments yet"}</td></tr>}
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link className="bh-no" to={`/customers/${m.customer.id}`}>{m.customer.name}</Link>
                    <span className="od-sub">{m.customer.phone}{m.customer.member_id ? ` · ${m.customer.member_id}` : ""}</span>
                  </td>
                  <td className="nowrap">{fmtDateTime(m.created_at)}</td>
                  <td><span className="pill blue">{titleCase(m.type)}</span></td>
                  <td className="num"><b>{money(m.amount)}</b></td>
                  <td><span className={`mh-pay ${m.payment_method}`}>{METHOD_LABEL[m.payment_method] || titleCase(m.payment_method)}</span></td>
                  <td className="nowrap">{fmtDate(m.start_date)}</td>
                  <td className="nowrap">{fmtDate(m.end_date)}</td>
                  <td>
                    <div className="bh-actions">
                      <Link to={`/customers/${m.customer.id}`} className="bh-ico view" data-tip="View customer" aria-label={`View customer ${m.customer.name}`}><Icon name="user" size={16} /></Link>
                      <button type="button" className="bh-ico delete" data-tip="Delete record" aria-label={`Delete membership record of ${m.customer.name}`} onClick={() => setToDelete(m)}><Icon name="trash" size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="od-foot-row">
          <span className="muted">Showing {first}–{last} of {count} records</span>
          {pages > 1 && <Pagination page={page} pages={pages} onChange={setPage} />}
        </div>
      </div>

      {toDelete && (
        <div className="modal-bg">
          <div className="card modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Delete membership record?</h2>
            <p>
              This removes the {money(toDelete.amount)} {toDelete.type} record of <b>{toDelete.customer.name}</b> and
              marks the customer as a non-member. This cannot be undone.
            </p>
            <div className="row">
              <button disabled={busy} onClick={() => setToDelete(null)}>Cancel</button>
              <button className="danger" disabled={busy} onClick={confirmDelete}>{busy ? "Please wait…" : "Yes, delete"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}