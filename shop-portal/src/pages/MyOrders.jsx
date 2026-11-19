import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import TablePager from "../components/TablePager";
import "../orders.css";
import "../orderspage.css";
import "../datatable.css";

export const STATUS_OPTIONS = [
  { value: "", label: "All Orders" },
  { value: "submitted", label: "Submitted" },
  { value: "awaiting_payment", label: "Awaiting Payment" },
  { value: "payment_confirmed", label: "Payment Confirmed" },
  { value: "in_production", label: "In Production" },
  { value: "ready", label: "Ready for Pickup" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];
export const money = (v) => (Number(v) > 0 ? `₹${Number(v).toLocaleString("en-IN")}` : "—");
export const niceDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

export function StatusBadge({ status, label }) {
  return <span className={`ord-badge ${status}`}>{label}</span>;
}

// summary cards at the top - clicking one filters the list by that status
const KPIS = [
  ["", "Total Orders", "receipt", "total", "total"],
  ["submitted", "Submitted", "quote", "submitted", "submitted"],
  ["awaiting_payment", "Awaiting Payment", "history", "awaiting_payment", "awaiting_payment"],
  ["payment_confirmed", "Payment Confirmed", "shield", "payment_confirmed", "payment_confirmed"],
  ["in_production", "In Production", "refresh", "in_production", "in_production"],
  ["completed", "Completed", "check", "completed", "completed"],
];

const EMPTY = { q: "", status: "", from: "", to: "" };

export default function MyOrders() {
  const [filters, setFilters] = useState(EMPTY);
  const [query, setQuery] = useState(""); // search text after the typing pause
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // wait a moment after typing before searching
  useEffect(() => {
    const t = setTimeout(() => { setQuery(filters.q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [filters.q]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    api.get("/shop/orders/", { params: { q: query, status: filters.status, date_from: filters.from, date_to: filters.to, page, per_page: size }, signal: ctrl.signal })
      .then((r) => { setData(r.data); setError(""); setLoading(false); })
      .catch((e) => { if (e.code !== "ERR_CANCELED") { setError(errorText(e)); setLoading(false); } });
    return () => ctrl.abort();
  }, [query, filters.status, filters.from, filters.to, page, size]);

  const set = (key) => (e) => { setFilters((f) => ({ ...f, [key]: e.target.value })); if (key !== "q") setPage(1); };
  const pickStatus = (key) => { setFilters((f) => ({ ...f, status: f.status === key ? "" : key })); setPage(1); };
  const filtered = filters.q || filters.status || filters.from || filters.to;
  const counts = data?.counts;
  const rows = data?.results || [];

  return (
    <div className="ord">
      <div className="page-head">
        <div>
          <h1>My Orders</h1>
          <p className="muted">View and track your printing orders with Star Offset Printing.</p>
        </div>
        <Link to="/orders/new" className="btn-link primary cart-btn"><Icon name="plus" size={16} /> Place New Order</Link>
      </div>

      <section className="ord-stats" aria-label="Order summary">
        {KPIS.map(([key, label, icon, tone]) => {
          const active = key === "" ? !filters.status : filters.status === key;
          return (
            <button type="button" key={label} className={`ord-stat ${tone}${active ? " active" : ""}`} aria-pressed={active}
              onClick={() => (key === "" ? (setFilters((f) => ({ ...f, status: "" })), setPage(1)) : pickStatus(key))}>
              <span className="ord-stat-ico"><Icon name={icon} size={18} /></span>
              <span className="ord-stat-text"><small>{label}</small><b>{counts ? (counts[key === "" ? "total" : key] ?? 0) : "—"}</b></span>
            </button>
          );
        })}
      </section>

      <section className="card ord-filters">
        <div className="ord-search">
          <Icon name="search" size={18} />
          <input type="search" value={filters.q} onChange={set("q")} placeholder="Search order no. or item…" aria-label="Search orders" />
        </div>
        <label className="ord-fld">Status
          <select value={filters.status} onChange={set("status")}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="ord-fld">From date
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={set("from")} />
        </label>
        <label className="ord-fld">To date
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={set("to")} />
        </label>
        <button type="button" className="ord-reset" disabled={!filtered} onClick={() => { setFilters(EMPTY); setQuery(""); setPage(1); }}>Reset</button>
      </section>

      {error && <p className="alert error">{error}</p>}

      <section className={`dt-card${loading && data ? " is-loading" : ""}`}>
        <div className="dt-head">
          <div><h2>Order List</h2><p>Your printing orders and their status.</p></div>
          {data && <div className="dt-tools"><span className="dt-count">{data.total_count} order{data.total_count === 1 ? "" : "s"}</span></div>}
        </div>

        {rows.length > 0 && (
          <div className="dt-wrap">
            <table className="dt-table">
              <thead>
                <tr><th>#</th><th>Order No.</th><th>Work Type</th><th>Quantity</th><th>Order Date</th><th className="num">Amount</th><th>Payment</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {rows.map((o, i) => (
                  <tr key={o.id}>
                    <td>{(data.page - 1) * data.page_size + i + 1}</td>
                    <td><Link to={`/orders/${o.id}`} className="dt-link">{o.order_no}</Link></td>
                    <td><span className="dt-clip" title={o.items_text}>{o.items_text || "Printing items"}</span></td>
                    <td>{Number(o.qty || 0).toLocaleString("en-IN")} pcs</td>
                    <td>{niceDate(o.date)}</td>
                    <td className="num">{money(o.amount)}</td>
                    <td className={o.payment_confirmed_at && o.payment_method ? "" : "dt-dash"}>{o.payment_confirmed_at && o.payment_method ? `Paid · ${cap(o.payment_method)}` : "—"}</td>
                    <td><StatusBadge status={o.status} label={o.status_label} /></td>
                    <td>
                      <div className="dt-actions">
                        <Link to={`/orders/${o.id}`} className="dt-view">View</Link>
                        {o.invoice_available && (
                            <Link to={`/orders/${o.id}/invoice`} className="dt-view alt" title="View invoice"><Icon name="receipt" size={14} /> Invoice</Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!data && loading && <div className="dt-skel" aria-label="Loading orders">{[0, 1, 2, 3].map((n) => <span key={n} />)}</div>}

        {data && rows.length === 0 && (
          <div className="dt-empty">
            <span className="dt-empty-ico"><Icon name="receipt" size={24} /></span>
            <b>{filtered ? "No orders match your search" : "No orders yet"}</b>
            <p>{filtered ? "Try a different search or clear the filters." : "Choose a printing service and place your first order."}</p>
            {!filtered && <Link to="/orders/new" className="btn-link primary"><Icon name="plus" size={16} /> Place an Order</Link>}
          </div>
        )}

        {data && (
          <TablePager page={data.page} pages={data.pages} total={data.total_count} count={rows.length} size={size}
            onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} />
        )}
      </section>
    </div>
  );
}