import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";
import Pagination from "../components/Pagination";
import "./billing.css";
import "./orders.css";
import "./billhistory.css"; // icon buttons (.bh-ico) with tooltips
import "./orderactions.css";

const PAGE_SIZE = 7; // matches OrderPagination on the server
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const orderCode = (id) => "W" + String(id).padStart(3, "0");
const dayDiff = (d) => Math.round((new Date(d + "T00:00:00") - new Date(new Date().toLocaleDateString("en-CA") + "T00:00:00")) / 86400000);
const fmtShort = (d) => {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", ...(sameYear ? {} : { year: "2-digit" }) });
};

const STATUS_LABEL = { pending: "Pending", progress: "In Progress", completed: "Completed", delivered: "Delivered", cancelled: "Cancelled" };
const NEXT_STATUS = { pending: "progress", progress: "completed", completed: "delivered" };
const MODE_LABEL = { cash: "Cash", upi: "UPI", bank: "Bank" };
const STATS = [["total", "Total Orders", ""], ["pending", "Pending", "pending"], ["progress", "In Progress", "progress"], ["completed", "Completed", "completed"], ["overdue", "Overdue", "overdue"]];
const QUICK = [["", "All Orders"], ["pending", "Pending"], ["progress", "In Progress"], ["completed", "Completed"], ["delivered", "Delivered"], ["overdue", "Overdue"]];

export default function Orders() {
  const { user } = useAuth();
  const [sp] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState({ total: 0, pending: 0, progress: 0, completed: 0, overdue: 0 });
  const [page, setPage] = useState(Number(sp.get("page")) || 1); // the edit screen sends us back to the same page
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [delivery, setDelivery] = useState("");
  const [open, setOpen] = useState(null);       // order id whose details row is expanded
  const [menu, setMenu] = useState(null);       // { order, top, right } for the "more" dropdown
  const [confirm, setConfirm] = useState(null); // { type: "delete" | "cancel" | "whatsapp", order }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    api.get("/orders/", { params: { page, q, status, delivery } })
      .then((r) => { setRows(r.data.results); setCount(r.data.count); setSummary(r.data.summary); })
      .catch((e) => {
        // asking for a page that no longer exists (e.g. after deleting the last row of it)
        if (e?.response?.status === 404 && page > 1) setPage(page - 1);
        else setMsg(errorText(e));
      });
  }, [page, q, status, delivery]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  // close the "more" dropdown on any outside click / scroll / resize
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDown = (e) => { if (!e.target.closest(".od-menu") && !e.target.closest(".bh-ico.more")) close(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [menu]);

  const clearMessages = () => { setMsg(""); setNotice(""); };

  const advance = async (o) => {
    clearMessages();
    try { await api.post(`/orders/${o.id}/status/`, { status: NEXT_STATUS[o.status] }); }
    catch (e) { setMsg(errorText(e)); }
    load();
  };

  const runConfirmed = async () => {
    const { type, order } = confirm;
    clearMessages(); setBusy(true);
    try {
      if (type === "delete") { await api.delete(`/orders/${order.id}/`); setNotice("Order deleted successfully"); }
      if (type === "cancel") { await api.post(`/orders/${order.id}/cancel/`); setNotice("Order cancelled successfully"); }
      if (type === "whatsapp") { const r = await api.post(`/orders/${order.id}/whatsapp/`); setNotice(r.data.message); }
    } catch (e) { setMsg(errorText(e)); }
    setBusy(false); setConfirm(null); load();
  };

  const exportCsv = () => {
    const params = new URLSearchParams({ q, status, delivery });
    window.open(`/api/orders/export/?${params.toString()}`, "_blank");
  };

  const openMenu = (e, order) => {
    if (menu?.order.id === order.id) { setMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ order, top: r.bottom + 4, right: window.innerWidth - r.right });
  };

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const from = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, count);
  const filtered = Boolean(q || status || delivery);
  const setStatusFilter = (v) => { setStatus(v); setPage(1); };

  return (
    <>
      <div className="od-head">
        <div>
          <h1>Orders</h1>
          <p className="muted">Manage print jobs, production status and delivery.</p>
        </div>
        <Link to="/orders/new"><button className="primary big">+ Create New Order</button></Link>
      </div>

      <div className="od-stats">
        {STATS.map(([key, label, filterKey]) => (
          <button key={key} type="button" className={`od-stat ${key}${status === filterKey && (filterKey || !status) ? " on" : ""}`}
            onClick={() => setStatusFilter(status === filterKey ? "" : filterKey)}>
            <b>{summary[key] ?? 0}</b><span>{label}</span>
          </button>
        ))}
      </div>

      <div className="card od-filters">
        <div>
          <p className="section-label">Quick filters</p>
          <div className="bl-chips">
            {QUICK.map(([key, label]) => (
              <button key={key} type="button" className={`bl-chip${status === key ? " on" : ""}`} onClick={() => setStatusFilter(key)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="od-filter-row">
          <div className="search-box">
            <Icon name="search" size={16} />
            <input placeholder="Search order / customer / mobile / work" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <select value={status} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="overdue">Overdue</option>
          </select>
          <select value={delivery} onChange={(e) => { setDelivery(e.target.value); setPage(1); }}>
            <option value="">Any delivery date</option>
            <option value="today">Due today</option>
            <option value="tomorrow">Due tomorrow</option>
            <option value="week">Next 7 days</option>
          </select>
          <button type="button" disabled={!filtered} onClick={() => { setQ(""); setStatus(""); setDelivery(""); setPage(1); }}>Clear</button>
        </div>
      </div>

      {msg && <div className="error">{msg}</div>}
      {notice && <div className="success">{notice}</div>}

      <div className="card od-register">
        <div className="od-reg-head">
          <h3>Order register<span className="muted">{count} {count === 1 ? "order" : "orders"}</span></h3>
          <div className="row">
            <button type="button" onClick={exportCsv}>Export</button>
            <button type="button" onClick={load}>Refresh</button>
          </div>
        </div>

        <div className="od-table-wrap">
          <table className="od-table">
            <thead>
              <tr>
                <th>ID</th><th>Customer</th><th>Work</th><th>Order date</th><th>Delivery</th>
                <th className="num">Total</th><th className="num">Advance</th><th className="num">Due</th><th>Status</th><th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={10} className="od-empty">{filtered ? "No orders match these filters" : "No orders yet"}</td></tr>}
              {rows.map((o) => (
                <OrderRows key={o.id} o={o} user={user} page={page} expanded={open === o.id}
                  onToggle={() => setOpen(open === o.id ? null : o.id)}
                  onAdvance={() => advance(o)} onMenu={(e) => openMenu(e, o)} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="od-foot-row">
          <span className="muted">Showing {from}–{to} of {count} orders</span>
          {pages > 1 && <Pagination page={page} pages={pages} onChange={setPage} />}
        </div>
      </div>

      {menu && (
        <div className="od-menu" style={{ top: menu.top, right: menu.right }}>
          {menu.order.status === "completed" && (
            <button type="button" onClick={() => { setConfirm({ type: "whatsapp", order: menu.order }); setMenu(null); }}><Icon name="whatsapp" size={16} />Notify via WhatsApp</button>
          )}
          {user.is_superuser && menu.order.status !== "cancelled" && !menu.order.is_billed && (
            <button type="button" className="danger" onClick={() => { setConfirm({ type: "cancel", order: menu.order }); setMenu(null); }}><Icon name="block" size={16} />Cancel order</button>
          )}
          {user.is_superuser && (
            <button type="button" className="danger" onClick={() => { setConfirm({ type: "delete", order: menu.order }); setMenu(null); }}><Icon name="trash" size={16} />Delete order</button>
          )}
        </div>
      )}

      {confirm && (
        <div className="modal-bg">
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            {confirm.type === "delete" && (<><h2>Delete Order</h2><p>Delete {orderCode(confirm.order.id)} ({confirm.order.work_name})? This cannot be undone.</p></>)}
            {confirm.type === "cancel" && (<><h2>Cancel Order</h2><p>Are you sure you want to cancel {orderCode(confirm.order.id)} ({confirm.order.work_name})?</p></>)}
            {confirm.type === "whatsapp" && (
              <>
                <h2>Send WhatsApp Notification</h2>
                <div className="cust-box">
                  <div><b>Customer:</b> {confirm.order.customer.name}</div>
                  <div><b>Mobile:</b> {confirm.order.customer.phone}</div>
                  <div><b>Work:</b> {confirm.order.work_name}</div>
                </div>
                <p>Send order completion message to this customer?</p>
              </>
            )}
            <div className="row">
              <button disabled={busy} onClick={() => setConfirm(null)}>{confirm.type === "cancel" ? "No" : "Cancel"}</button>
              <button className={confirm.type === "whatsapp" ? "primary" : "danger"} disabled={busy} onClick={runConfirmed}>
                {busy ? "Please wait…" : confirm.type === "delete" ? "Yes, Delete" : confirm.type === "cancel" ? "Yes, Cancel" : "Yes, Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// One order = its table row + (optional) expanded details row
function OrderRows({ o, user, page, expanded, onToggle, onAdvance, onMenu }) {
  const canBill = !o.is_billed && (o.status === "completed" || o.status === "delivered");
  const left = o.status === "delivered" || o.status === "cancelled" ? null : dayDiff(o.delivery_date);
  const hasMore = o.status === "completed" || user.is_superuser;
  return (
    <>
      <tr>
        <td className="od-id">{orderCode(o.id)}</td>
        <td><span className="od-cell-main">{o.customer.name}</span><span className="od-sub">{o.customer.phone}</span></td>
        <td><span className="od-cell-main">{o.work_name}</span><span className="od-sub">{o.items.length} {o.items.length === 1 ? "item" : "items"}</span></td>
        <td className="nowrap">{fmtShort(o.order_date)}</td>
        <td className="nowrap">
          <span className={o.is_overdue ? "bad" : ""}>{fmtShort(o.delivery_date)}</span>
          {left === 0 && <span className="od-tag">Today</span>}
          {left === 1 && <span className="od-tag">Tomorrow</span>}
          {o.is_overdue && <span className="od-tag red">Overdue</span>}
        </td>
        <td className="num">{money(o.total_amount)}</td>
        <td className="num">{money(o.advance_paid)}</td>
        <td className={`num${o.due_amount > 0 && o.status !== "cancelled" ? " bad" : ""}`}>{money(o.due_amount)}</td>
        <td>
          {NEXT_STATUS[o.status]
            ? <button type="button" className={`status next ${o.status}`} title={`Move to ${STATUS_LABEL[NEXT_STATUS[o.status]]}`} onClick={onAdvance}>{STATUS_LABEL[o.status]}</button>
            : <span className={`status ${o.status}`}>{STATUS_LABEL[o.status]}</span>}
          {o.is_billed && <span className="od-sub">Billed</span>}
        </td>
        <td>
          <div className="od-actions">
            {canBill && <Link to={`/billing?order_id=${o.id}`} className="bh-ico bill" data-tip="Generate bill" aria-label={`Generate bill for ${orderCode(o.id)}`}><Icon name="billing" size={16} /></Link>}
            <button type="button" className={`bh-ico view${expanded ? " on" : ""}`} data-tip={expanded ? "Hide details" : "View details"} aria-label={expanded ? "Hide details" : "View details"} aria-expanded={expanded} onClick={onToggle}><Icon name="eye" size={16} /></button>
            {user.is_superuser && <Link to={`/orders/${o.id}/edit?page=${page}`} className="bh-ico edit" data-tip="Edit order" aria-label={`Edit ${orderCode(o.id)}`}><Icon name="edit" size={16} /></Link>}
            {hasMore && <button type="button" className="bh-ico more" data-tip="More actions" aria-label="More actions" aria-haspopup="menu" onClick={onMenu}><Icon name="more" size={16} /></button>}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="od-detail">
          <td colSpan={10}>
            <div className="od-detail-grid">
              <div>
                <h4>Items</h4>
                <table className="mini">
                  <thead><tr><th>Item</th><th>Qty</th><th>Job</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
                  <tbody>
                    {o.items.map((i) => (
                      <tr key={i.id}><td>{i.name}</td><td>{i.qty}</td><td>{i.job}</td><td className="num">{money(i.price)}</td><td className="num">{money(i.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h4>Notes</h4>
                <div>{o.notes || <span className="muted">No notes</span>}</div>
                {o.advance_paid > 0 && (
                  <>
                    <h4 style={{ marginTop: 12 }}>Advance</h4>
                    <div>{money(o.advance_paid)} · {MODE_LABEL[o.advance_mode] || o.advance_mode}{o.advance_reference ? ` · Ref ${o.advance_reference}` : ""}</div>
                  </>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}