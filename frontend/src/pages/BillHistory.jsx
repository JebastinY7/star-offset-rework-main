import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";
import Pagination from "../components/Pagination";
import "./billing.css";
import "./orders.css";
import "./billhistory.css";

const PAGE_SIZE = 9; // matches BillPagination on the server
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const fmtShort = (d) => {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", ...(sameYear ? {} : { year: "2-digit" }) });
};

// the server stores "due"; the screen calls it "Unpaid"
const STATUS_LABEL = { paid: "Paid", partial: "Partial", due: "Unpaid" };
const QUICK = [["", "All Bills"], ["paid", "Paid"], ["partial", "Partial"], ["due", "Unpaid"]];
const RANGES = [["", "All dates"], ["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["last_month", "Last month"]];
const STATS = [
  ["total", "Total Bills", "total", (v) => v],
  ["billed", "Total Billed", "billed", money],
  ["received", "Amount Received", "received", money],
  ["outstanding", "Outstanding", "outstanding", money],
];

export default function BillHistory() {
  const { user } = useAuth();
  const [sp] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState({ total: 0, billed: 0, received: 0, outstanding: 0 });
  const [page, setPage] = useState(Number(sp.get("page")) || 1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [range, setRange] = useState("");
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    api.get("/bills/", { params: { page, q, status, range } })
      .then((r) => { setRows(r.data.results); setCount(r.data.count); setSummary(r.data.summary); })
      .catch((e) => {
        // asking for a page that no longer exists (e.g. after deleting the last row of it)
        if (e?.response?.status === 404 && page > 1) setPage(page - 1);
        else setMsg(errorText(e));
      });
  }, [page, q, status, range]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const confirmDelete = async () => {
    setMsg(""); setNotice(""); setBusy(true);
    try { await api.delete(`/bills/${toDelete.id}/`); setNotice(`Bill ${toDelete.bill_no} deleted successfully`); }
    catch (e) { setMsg(errorText(e)); }
    setBusy(false); setToDelete(null); load();
  };

  const exportExcel = () => {
    const params = new URLSearchParams({ q, status, range });
    window.open(`/api/bills/export/?${params.toString()}`, "_blank");
  };

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const from = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, count);
  const filtered = Boolean(q || status || range);
  const setStatusFilter = (v) => { setStatus(v); setPage(1); };

  return (
    <>
      <div className="od-head">
        <div>
          <h1>Bill History</h1>
          <p className="muted">View, search and manage customer invoices and payments.</p>
        </div>
        <Link to="/billing"><button className="primary big">+ Create New Bill</button></Link>
      </div>

      <div className="od-stats bh-stats">
        {STATS.map(([key, label, tone, fmt]) => (
          <div key={key} className={`od-stat ${tone}`}>
            <b>{fmt(summary[key] ?? 0)}</b><span>{label}</span>
          </div>
        ))}
      </div>

      <div className="card od-filters">
        <div className="bh-filter-row">
          <div className="search-box">
            <Icon name="search" size={16} />
            <input placeholder="Search bill / customer / phone" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <select value={status} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Payment status">
            <option value="">Payment Status</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={range} onChange={(e) => { setRange(e.target.value); setPage(1); }} aria-label="Date range">
            {RANGES.map(([k, v]) => <option key={k} value={k}>{k ? v : "Date Range"}</option>)}
          </select>
          <button type="button" disabled={!filtered} onClick={() => { setQ(""); setStatus(""); setRange(""); setPage(1); }}>Clear</button>
        </div>
        <div className="bl-chips">
          {QUICK.map(([key, label]) => (
            <button key={key} type="button" className={`bl-chip${status === key ? " on" : ""}`} onClick={() => setStatusFilter(key)}>{label}</button>
          ))}
        </div>
      </div>

      {msg && <div className="error">{msg}</div>}
      {notice && <div className="success">{notice}</div>}

      <div className="card od-register">
        <div className="od-reg-head">
          <h3>Bill register<span className="muted">{count} {count === 1 ? "bill" : "bills"}</span></h3>
          <div className="row">
            <button type="button" className="bh-btn-ico" onClick={exportExcel}><Icon name="sheet" size={16} />Export Excel</button>
            <button type="button" className="bh-btn-ico" onClick={load}><Icon name="refresh" size={16} />Refresh</button>
          </div>
        </div>

        <div className="od-table-wrap">
          <table className="od-table bh-table">
            <thead>
              <tr>
                <th>Bill No</th><th>Customer</th><th>Date</th>
                <th className="num">Subtotal</th><th className="num">Discount</th><th className="num">Final</th>
                <th className="num">Paid</th><th className="num">Due</th><th>Status</th><th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={10} className="od-empty">{filtered ? "No bills match these filters" : "No bills yet"}</td></tr>}
              {rows.map((b) => (
                <tr key={b.id}>
                  <td><Link className="bh-no" to={`/history/${b.id}`}>{b.bill_no}</Link></td>
                  <td><span className="od-cell-main">{b.customer.name}</span><span className="od-sub">{b.customer.phone}</span></td>
                  <td className="nowrap">{fmtShort(b.bill_date)}</td>
                  <td className="num">{money(b.gross_total)}</td>
                  <td className="num">{money(b.discount)}</td>
                  <td className="num"><b>{money(b.final_amount)}</b></td>
                  <td className="num">{money(b.paid_amount)}</td>
                  <td className={`num${Number(b.current_due) > 0 ? " bad" : ""}`}>{money(b.current_due)}</td>
                  <td><span className={`status ${b.payment_status}`}>{STATUS_LABEL[b.payment_status] || b.payment_status}</span></td>
                  <td>
                    <div className="bh-actions">
                      <Link to={`/history/${b.id}`} className="bh-ico view" data-tip="View bill" aria-label={`View bill ${b.bill_no}`}><Icon name="eye" size={16} /></Link>
                      {user.is_superuser && (
                        <Link to={`/billing/${b.id}/edit?from_history=1`} className="bh-ico edit" data-tip="Edit bill" aria-label={`Edit bill ${b.bill_no}`}><Icon name="edit" size={16} /></Link>
                      )}
                      <Link to={`/invoice/${b.id}?print=1&from_history=1`} className="bh-ico print" data-tip="Print invoice" aria-label={`Print bill ${b.bill_no}`}><Icon name="printer" size={16} /></Link>
                      {user.is_superuser && (
                        <button type="button" className="bh-ico delete" data-tip="Delete bill" aria-label={`Delete bill ${b.bill_no}`} onClick={() => setToDelete(b)}><Icon name="trash" size={16} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="od-foot-row">
          <span className="muted">Showing {from}–{to} of {count} bills</span>
          {pages > 1 && <Pagination page={page} pages={pages} onChange={setPage} />}
        </div>
      </div>

      {toDelete && (
        <div className="modal-bg">
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete bill {toDelete.bill_no}?</h2>
            <p>This removes the bill and its items. This cannot be undone.</p>
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