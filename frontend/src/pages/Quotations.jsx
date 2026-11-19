import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";
import Pagination from "../components/Pagination";
import "./billing.css";
import "./orders.css";
import "./quotations.css";
import "./billhistory.css"; // icon buttons (.bh-ico) with tooltips
import "./orderactions.css"; // icon-button tweaks shared with the Orders page

// Quotation list = /quotations   (add / edit / bill screens are separate pages)
// Edit and delete are admin only. "Convert to Bill" opens Billing with the quotation's items;
// once that bill is saved the quotation shows as "Billed".

const PAGE_SIZE = 7; // matches QuotationPagination on the server
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtShort = (d) => (d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : "");
const todayStr = () => new Date().toLocaleDateString("en-CA");
const TABS = [["", "All Quotations"], ["no", "Not Billed"], ["yes", "Converted to Bill"]];

export default function Quotations() {
  const { user } = useAuth();
  const [sp] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState({ total: 0, this_month: 0, amount: 0, billed: 0 });
  const [page, setPage] = useState(Number(sp.get("page")) || 1); // the edit / bill screens send us back here
  const [q, setQ] = useState(sp.get("q") || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [validity, setValidity] = useState("");
  const [billed, setBilled] = useState(""); // "" = all | "no" | "yes"
  const [confirm, setConfirm] = useState(null); // quotation about to be deleted
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    const params = { page, q, billed, validity, date_from: from, date_to: to };
    Object.keys(params).forEach((k) => !params[k] && delete params[k]);
    api.get("/quotations/", { params })
      .then((r) => { setRows(r.data.results); setCount(r.data.count); setSummary(r.data.summary); setMsg(""); })
      .catch((e) => {
        // asking for a page that no longer exists (e.g. after deleting the last row of it)
        if (e?.response?.status === 404 && page > 1) setPage(page - 1);
        else setMsg(errorText(e));
      })
      .finally(() => setLoaded(true));
  }, [page, q, billed, validity, from, to]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const filter = (setter) => (value) => { setter(value); setPage(1); };
  const filtered = Boolean(q || from || to || validity || billed);
  const clearFilters = () => { setQ(""); setFrom(""); setTo(""); setValidity(""); setBilled(""); setPage(1); };

  const remove = async () => {
    setMsg(""); setNotice(""); setBusy(true);
    try {
      await api.delete(`/quotations/${confirm.id}/`);
      setNotice("Quotation deleted successfully");
    } catch (e) { setMsg(errorText(e)); }
    setBusy(false); setConfirm(null); load();
  };

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const showFrom = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showTo = Math.min(page * PAGE_SIZE, count);
  const back = `page=${page}&q=${encodeURIComponent(q)}`; // so the next screen can bring us back to this exact view
  const today = todayStr();

  return (
    <>
      <div className="od-head">
        <div>
          <h1>Quotations</h1>
          <p className="muted">Manage customer estimates and convert confirmed quotations into bills.</p>
        </div>
        <Link to="/quotations/new"><button className="primary">+ Add Quotation</button></Link>
      </div>

      <div className="qt-stats">
        <div className="od-stat total"><b>{summary.total}</b><span>Total Quotes</span></div>
        <div className="od-stat progress"><b>{summary.this_month}</b><span>This Month</span></div>
        <div className="od-stat completed"><b>{money(summary.amount)}</b><span>Quoted Amount</span></div>
      </div>

      <div className="card od-filters">
        <div className="qt-filter-row">
          <div className="search-box">
            <Icon name="search" size={16} />
            <input placeholder="Search ID / customer / phone / work" value={q} onChange={(e) => filter(setQ)(e.target.value)} />
          </div>
          <div className="qt-range" title="Quotation date range">
            <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => filter(setFrom)(e.target.value)} />
            <span>to</span>
            <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => filter(setTo)(e.target.value)} />
          </div>
          <select aria-label="Validity" value={validity} onChange={(e) => filter(setValidity)(e.target.value)}>
            <option value="">Status: All</option>
            <option value="valid">Valid</option>
            <option value="expired">Expired</option>
          </select>
          {filtered && <button type="button" onClick={clearFilters}>Clear</button>}
        </div>
        <div className="cust-tabs">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" className={billed === key ? "on" : ""} onClick={() => filter(setBilled)(key)}>
              {label}
              {key === "yes" && summary.billed > 0 && <span className="qt-tab-count">{summary.billed}</span>}
            </button>
          ))}
        </div>
      </div>

      {msg && <div className="error">{msg}</div>}
      {notice && <div className="success">{notice}</div>}

      <div className="card od-register">
        <div className="od-reg-head">
          <h3>Quotation register<span className="muted">{count} {count === 1 ? "quotation" : "quotations"}</span></h3>
          <button type="button" onClick={load}>Refresh</button>
        </div>

        <div className="od-table-wrap">
          <table className="od-table qt-table">
            <thead>
              <tr>
                <th>Quote ID</th><th>Customer</th><th>Phone</th><th>Work</th><th>Date</th>
                <th className="num">Amount</th><th>Status</th><th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loaded && rows.length === 0 && (
                <tr><td colSpan={8} className="od-empty">{filtered ? "No quotations match these filters" : "No quotations yet"}</td></tr>
              )}
              {!loaded && <tr><td colSpan={8} className="od-empty">Loading…</td></tr>}
              {rows.map((r) => {
                const expired = !r.is_billed && r.valid_until && r.valid_until < today;
                return (
                  <tr key={r.id}>
                    <td className="od-id">{r.code}</td>
                    <td>{r.customer_name ? <span className="od-cell-main">{r.customer_name}</span> : <span className="muted">Walk-in</span>}</td>
                    <td className="nowrap">{r.customer_phone || <span className="muted">—</span>}</td>
                    <td>
                      <span className="od-cell-main">{r.work_name}</span>
                      {r.valid_until && <span className="od-sub">Valid till {fmtShort(r.valid_until)}</span>}
                    </td>
                    <td className="nowrap">{fmtShort(r.quotation_date)}</td>
                    <td className="num">{money(r.total_amount)}</td>
                    <td>
                      {r.is_billed
                        ? <Link to={`/invoice/${r.bill_id}`} className="qt-pill billed" title="Open the bill">Billed{r.bill_no ? ` · ${r.bill_no}` : ""}</Link>
                        : <span className={`qt-pill${expired ? " expired" : ""}`}>{expired ? "Expired" : "Not billed"}</span>}
                    </td>
                    <td>
                      <div className="od-actions">
                        <Link to={`/quotations/${r.id}/bill?${back}`} className="bh-ico view" data-tip="View quotation" aria-label={`View quotation Q${String(r.id).padStart(3, "0")}`}><Icon name="eye" size={16} /></Link>
                        {user.is_superuser && !r.is_billed && (
                          <Link to={`/quotations/${r.id}/edit?${back}`} className="bh-ico edit" data-tip="Edit quotation" aria-label={`Edit quotation Q${String(r.id).padStart(3, "0")}`}><Icon name="edit" size={16} /></Link>
                        )}
                        {!r.is_billed && (
                          <Link to={`/billing?quotation_id=${r.id}`} className="bh-ico bill" data-tip="Convert to bill" aria-label={`Convert quotation Q${String(r.id).padStart(3, "0")} to bill`}><Icon name="billing" size={16} /></Link>
                        )}
                        {user.is_superuser && <button type="button" className="bh-ico delete" data-tip="Delete quotation" aria-label={`Delete quotation Q${String(r.id).padStart(3, "0")}`} onClick={() => setConfirm(r)}><Icon name="trash" size={16} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="od-foot-row">
          <span className="muted">Showing {showFrom}–{showTo} of {count} quotations</span>
          {pages > 1 && <Pagination page={page} pages={pages} onChange={setPage} />}
        </div>
      </div>

      {confirm && (
        <div className="modal-bg">
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Quotation</h2>
            <p>Delete {confirm.code} ({confirm.work_name})? This cannot be undone.</p>
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