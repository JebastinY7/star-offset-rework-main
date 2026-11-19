import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";
import "./billhistory.css"; // icon buttons (.bh-ico) with tooltips
import "./shopOrders.css";

const STATUSES = [
  ["submitted", "Submitted"], ["awaiting_payment", "Awaiting Payment"],
  ["payment_confirmed", "Payment Confirmed"], ["in_production", "In Production"],
  ["ready", "Ready for Pickup"], ["completed", "Completed"], ["cancelled", "Cancelled"],
];
// order progress shown on the detail page (cancelled is handled separately)
const FLOW = STATUSES.filter(([k]) => k !== "cancelled");
const NEXT_ACTIONS = {
  submitted: [["awaiting_payment", "Review order & set final price"], ["cancelled", "Cancel order"]],
  awaiting_payment: [["payment_confirmed", "Confirm payment received"], ["cancelled", "Cancel order"]],
  payment_confirmed: [["in_production", "Start production"], ["cancelled", "Cancel order"]],
  in_production: [["ready", "Mark ready for pickup"], ["cancelled", "Cancel order"]],
  ready: [["completed", "Mark completed"], ["cancelled", "Cancel order"]],
  completed: [], cancelled: [],
};
// clickable summary cards on the list page (they filter the table)
const KPIS = [
  ["", "Total Orders", "sheet", "total"],
  ["submitted", "Submitted", "send", "submitted"],
  ["awaiting_payment", "Awaiting Payment", "history", "awaiting_payment"],
  ["payment_confirmed", "Payment Confirmed", "card", "payment_confirmed"],
  ["in_production", "In Production", "printer", "in_production"],
  ["ready", "Ready for Pickup", "store", "ready"],
  ["completed", "Completed", "check", "completed"],
];

const money = (v) => Number(v) > 0 ? `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "Price to confirm";
const date = (v) => v ? new Date(`${v.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const initials = (name) => (name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const fileSize = (bytes) => { const b = Number(bytes || 0); return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(b / 1024))} KB`; };

function Badge({ status, label }) {
  return <span className={`sho-badge ${status}`}>{label}</span>;
}

export default function ShopOrders() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [finalAmount, setFinalAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentReference, setPaymentReference] = useState("");

  const loadList = useCallback(() => {
    setLoading(true);
    api.get("/admin/shop-orders/", { params: { q, status, date_from: from, date_to: to, page } })
      .then((r) => { setRows(r.data.results || []); setCounts(r.data.counts || {}); setTotal(r.data.total_count || 0); setError(""); })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
  }, [q, status, from, to, page]);

  const loadDetail = useCallback(() => {
    if (!orderId) { setDetail(null); return; }
    setLoading(true);
    api.get(`/admin/shop-orders/${orderId}/`)
      .then((r) => { setDetail(r.data); setFinalAmount(r.data.order?.final_amount || ""); setPaymentMethod(r.data.order?.payment_method || ""); setPaymentReference(r.data.order?.payment_reference || ""); setError(""); })
      .catch((e) => { setDetail(null); setError(errorText(e)); })
      .finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => { if (orderId) loadDetail(); else loadList(); }, [orderId, loadList, loadDetail]);

  const updateStatus = async (next) => {
    if (!detail || next === detail.order.status) return;
    if (next === "awaiting_payment" && !(Number(finalAmount) > 0)) { setError("Enter the confirmed final price first."); return; }
    if (next === "cancelled" && !window.confirm(`Cancel order ${detail.order.order_no}? This cannot be undone.`)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const payload = { status: next };
      if (next === "awaiting_payment") payload.final_amount = finalAmount;
      if (next === "payment_confirmed") {
        payload.payment_method = paymentMethod;
        payload.payment_reference = paymentReference;
      }
      const r = await api.patch(`/admin/shop-orders/${orderId}/`, payload);
      setDetail(r.data); setFinalAmount(r.data.order?.final_amount || "");
      setNotice(next === "payment_confirmed" ? "Payment confirmed and recorded." : "Order workflow updated.");
      loadList();
    } catch (e) { setError(errorText(e)); }
    finally { setSaving(false); }
  };

  /* ------------------------------------------------------------------ detail page */
  if (orderId) {
    const order = detail?.order;
    const actions = order ? NEXT_ACTIONS[order.status] || [] : [];
    const needsPrice = order && ["submitted", "awaiting_payment"].includes(order.status);
    const needsPayment = order && order.status === "awaiting_payment";
    const stepIndex = order ? FLOW.findIndex(([k]) => k === order.status) : -1;

    return <div className="sho-page">
      <Link to="/shop-orders" className="sho-back"><Icon name="arrowLeft" size={16} /> Back to Shop Orders</Link>
      {error && <div className="sho-alert error">{error}</div>}
      {loading && !detail ? <div className="card sho-loading">Loading order…</div> : order && <>
        <div className="sho-head">
          <div className="sho-head-main">
            <div className="sho-head-line"><h1>{order.order_no}</h1><Badge status={order.status} label={order.status_label} /></div>
            <p className="muted">Placed by <b>{order.shop_name}</b> on {date(order.date)}</p>
          </div>
          <div className="sho-head-total"><span>Order total</span><b>{money(order.final_amount ?? order.amount)}</b></div>
        </div>

        {notice && <div className="sho-alert success">{notice}</div>}

        {order.status === "cancelled"
          ? <div className="sho-cancelled"><Icon name="block" size={18} /> This order was cancelled.</div>
          : <section className="card sho-steps-card" aria-label="Order progress">
              <ol className="sho-steps">
                {FLOW.map(([key, label], i) => {
                  const state = i < stepIndex ? "done" : i === stepIndex ? "current" : "todo";
                  return <li key={key} className={state} aria-current={state === "current" ? "step" : undefined}>
                    <span className="sho-step-dot">{state === "done" ? <Icon name="check" size={14} /> : i + 1}</span>
                    <span className="sho-step-label">{label}</span>
                  </li>;
                })}
              </ol>
            </section>}

        <div className="sho-layout">
          <div className="sho-main">
            <div className="sho-block-title"><h2>Printing Items</h2><span>{detail.items.length} item{detail.items.length !== 1 ? "s" : ""}</span></div>
            <div className="sho-item-list">
              {detail.items.map((item, i) => <article className="card sho-item" key={`${item.service_name}-${i}`}>
                <div className="sho-item-heading">
                  <div><span className="sho-item-no">Item {i + 1}</span><h3>{item.service_name}</h3></div>
                  <strong className={item.estimate == null ? "sho-noprice" : ""}>{item.estimate == null ? "No price" : money(item.estimate)}</strong>
                </div>
                <div className="sho-specs">
                  {(item.spec || []).map((s, j) => <span key={j} className="sho-chip"><em>{s.label}</em>{s.value}</span>)}
                  <span className="sho-chip"><em>Quantity</em>{Number(item.qty).toLocaleString("en-IN")}</span>
                </div>
                <div className="sho-files">
                  <span className="sho-files-label"><Icon name="sheet" size={15} /> Artwork files</span>
                  {item.files?.length
                    ? <ul>{item.files.map((f, k) => <li key={k}>
                      {f.stored
                        ? <a className="sho-file-name sho-file-link" href={`/api/admin/order-files/${item.id}/${f.idx ?? k}/`} title="Download file"><Icon name="download" size={14} /> {f.name}</a>
                        : <span className="sho-file-name">{f.name}</span>}
                      <small>{fileSize(f.size)}{!f.stored && " · in order e-mail only"}</small>
                    </li>)}</ul>
                    : <span className="muted">No files recorded</span>}
                </div>
              </article>)}
            </div>

            <section className="card sho-panel sho-instructions">
              <h2>Additional Instructions</h2>
              <p className={order.instructions ? "" : "muted"}>{order.instructions || "No additional instructions."}</p>
              <p className="sho-small"><Icon name="info" size={14} /> Artwork is emailed to Star Offset when the order is placed, and a private copy is kept so it can be downloaded here or e-mailed to a vendor. Orders placed before this was added only have their files in the e-mail.</p>
            </section>
          </div>

          <aside className="sho-side">
            <section className="card sho-panel sho-action">
              <h2>Next action</h2>
              {actions.length === 0
                ? <p className="muted sho-noaction">{order.status === "completed" ? "This order is completed. No further actions." : "No further actions are available for this order."}</p>
                : <>
                    {needsPrice && <label className="sho-field">Final price (₹)
                      <input type="number" min="0.01" step="0.01" value={finalAmount} onChange={(e) => setFinalAmount(e.target.value)} onWheel={(e) => e.currentTarget.blur()} placeholder="Enter confirmed price" /></label>}
                    {needsPayment && <>
                      <label className="sho-field">Payment method
                        <input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="Cash / bank transfer / UPI" /></label>
                      <label className="sho-field">Payment reference <small>(optional)</small>
                        <input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Transaction / reference no." /></label>
                    </>}
                    <div className="sho-action-btns">
                      {actions.map(([value, label]) => <button key={value} type="button" disabled={saving}
                        className={value === "cancelled" ? "sho-btn-cancel" : "primary sho-btn-main"} onClick={() => updateStatus(value)}>
                        {saving ? "Updating…" : label}
                      </button>)}
                    </div>
                  </>}
            </section>

            {user?.is_superuser && order.status !== "cancelled" && order.status !== "completed" && <section className="card sho-panel sho-vendor">
              <h2>Vendor work</h2>
              <p className="muted">Give some or all items of this order to an outside printer.</p>
              <Link to={`/vendor-work?order=${order.id}`} className="sho-vendor-btn"><Icon name="truck" size={16} /> Assign to vendor</Link>
            </section>}

            <section className="card sho-panel">
              <h2>Order summary</h2>
              <dl className="sho-dl">
                <dt>Order date</dt><dd>{date(order.date)}</dd>
                <dt>Required delivery</dt><dd>{date(order.delivery_date)}</dd>
                <dt>Order total</dt><dd>{money(order.final_amount ?? order.amount)}</dd>
                <dt>Final price</dt><dd>{order.final_amount ? money(order.final_amount) : "Not set"}</dd>
              </dl>
              {order.payment_confirmed_at && <>
                <h3 className="sho-sub">Payment</h3>
                <dl className="sho-dl">
                  <dt>Method</dt><dd>{cap(order.payment_method) || "Not recorded"}</dd>
                  <dt>Reference</dt><dd>{order.payment_reference || "Not provided"}</dd>
                  <dt>Confirmed</dt><dd>{new Date(order.payment_confirmed_at).toLocaleString("en-IN")}</dd>
                  <dt>Confirmed by</dt><dd>{order.payment_confirmed_by || "Staff"}</dd>
                </dl>
              </>}
            </section>

            <section className="card sho-panel">
              <h2>Shop</h2>
              <div className="sho-shop">
                <span className="sho-avatar lg">{initials(order.shop_name)}</span>
                <div><b>{order.shop_name}</b><small>@{order.username}</small></div>
              </div>
              <ul className="sho-contact">
                <li><Icon name="user" size={15} /><span>{order.phone || "—"}</span></li>
                <li><Icon name="mail" size={15} /><span>{order.email || "—"}</span></li>
              </ul>
            </section>
          </aside>
        </div>
      </>}
    </div>;
  }

  /* ------------------------------------------------------------------ list page */
  const filtered = Boolean(q || status || from || to);
  const pages = Math.max(1, Math.ceil(total / 10));
  const pickStatus = (key) => { setStatus(status === key ? "" : key); setPage(1); };

  return <div className="sho-page">
    <div className="sho-head">
      <div className="sho-head-main"><h1>Shop Orders</h1><p className="muted">Orders submitted by shops through the Shop Portal.</p></div>
      <button type="button" className="sho-refresh" onClick={loadList} disabled={loading}><Icon name="refresh" size={16} /> Refresh</button>
    </div>

    <div className="sho-stats">
      {KPIS.map(([key, label, icon, tone]) => {
        const value = key === "" ? counts.total : counts[key];
        const active = key === "" ? !status : status === key;
        return <button type="button" key={label} className={`sho-stat ${tone}${active ? " active" : ""}`} onClick={() => key === "" ? (setStatus(""), setPage(1)) : pickStatus(key)} aria-pressed={active}>
          <span className="sho-stat-ico"><Icon name={icon} size={17} /></span>
          <span className="sho-stat-text"><small>{label}</small><b>{value ?? "—"}</b></span>
        </button>;
      })}
    </div>

    <section className="card sho-filters">
      <div className="sho-search"><Icon name="search" size={18} /><input value={q} placeholder="Search order number, shop, phone or item…" onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
      <label className="sho-date">From<input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
      <label className="sho-date">To<input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
      <button type="button" className="sho-reset" disabled={!filtered} onClick={() => { setQ(""); setStatus(""); setFrom(""); setTo(""); setPage(1); }}>Reset</button>
    </section>

    {error && <div className="sho-alert error">{error}</div>}

    <section className="card sho-table-card">
      <div className="sho-table-head">
        <h2>Incoming Orders</h2>
        <span>{status ? `${STATUSES.find(([k]) => k === status)?.[1]} · ` : ""}{total} order{total !== 1 ? "s" : ""}</span>
      </div>
      <div className="sho-table-wrap">
        <table className="sho-table">
          <thead><tr><th>Order</th><th>Shop</th><th>Items</th><th className="num">Order total</th><th>Status</th><th className="act">Action</th></tr></thead>
          <tbody>
            {loading && rows.length === 0 && [0, 1, 2, 3].map((n) => <tr key={`sk${n}`} className="sho-skel"><td colSpan={6}><span /></td></tr>)}
            {rows.map((o) => <tr key={o.id} className="sho-row" onClick={() => navigate(`/shop-orders/${o.id}`)}>
              <td><b className="sho-ono">{o.order_no}</b><small>{date(o.date)}</small></td>
              <td><div className="sho-shop-cell"><span className="sho-avatar">{initials(o.shop_name)}</span><div><b>{o.shop_name}</b><small>{o.phone || o.username}</small></div></div></td>
              <td><b>{o.items} item{Number(o.items) !== 1 ? "s" : ""}</b><small className="sho-clip">{o.items_text || "Printing items"}</small></td>
              <td className="num"><b>{money(o.amount)}</b></td>
              <td><Badge status={o.status} label={o.status_label} /></td>
              <td className="act" onClick={(e) => e.stopPropagation()}>
                <Link to={`/shop-orders/${o.id}`} className="bh-ico view" data-tip="View details" aria-label={`View details of ${o.order_no}`}><Icon name="eye" size={16} /></Link>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && <div className="sho-empty">
        <span className="sho-empty-ico"><Icon name="store" size={24} /></span>
        <b>{filtered ? "No orders match your filters" : "No shop orders yet"}</b>
        <p>{filtered ? "Try a different search or clear the filters." : "Orders submitted through the Shop Portal will appear here."}</p>
      </div>}
      <div className="sho-pager">
        <span className="muted">Showing {total ? (page - 1) * 10 + 1 : 0}–{Math.min(page * 10, total)} of {total} orders</span>
        <div>
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="sho-page-no">Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
    </section>
  </div>;
}