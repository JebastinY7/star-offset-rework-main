import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import { downloadInvoice } from "../invoice";
import { StatusBadge, STATUS_OPTIONS, cap, money, niceDate } from "./MyOrders";
import "../orders.css";
import "../orderspage.css";
import "../invoice.css";

// progress shown under the title (cancelled is shown as a banner instead)
const FLOW = STATUS_OPTIONS.filter((s) => s.value && s.value !== "cancelled");
const fileSize = (bytes) => { const b = Number(bytes || 0); return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(b / 1024))} KB`; };

export default function OrderDetail() {
  const { id } = useParams();
  const [state, setState] = useState({ id: "", data: null, error: "" });
  const [dl, setDl] = useState({ busy: false, error: "" });

  useEffect(() => {
    let live = true;
    api.get(`/shop/orders/${id}/`)
      .then((r) => live && setState({ id, data: r.data, error: "" }))
      .catch((e) => live && setState({ id, data: null, error: e.response?.status === 404 ? "This order was not found." : errorText(e) }));
    return () => { live = false; };
  }, [id]);

  const back = <Link to="/orders" className="back-link"><Icon name="arrowleft" size={16} /> Back to My Orders</Link>;
  if (state.id !== id) return <div className="ord">{back}<div className="card ord-loading">Loading order…</div></div>;
  if (state.error) return <div className="ord">{back}<p className="alert error">{state.error}</p></div>;

  const { order, items } = state.data;
  const total = items.reduce((sum, i) => sum + Number(i.estimate || 0), 0);
  const finalTotal = money(order.final_amount ?? total);
  const stepIndex = FLOW.findIndex((s) => s.value === order.status);
  const paid = Boolean(order.payment_confirmed_at);

  const getInvoice = async () => {
    setDl({ busy: true, error: "" });
    try { await downloadInvoice(order.id, `Invoice-${order.order_no}`); setDl({ busy: false, error: "" }); }
    catch (e) { setDl({ busy: false, error: e.message }); }
  };

  return (
    <div className="ord odp">
      {back}

      <div className="odp-head">
        <div>
          <div className="odp-title"><h1>{order.order_no}</h1><StatusBadge status={order.status} label={order.status_label} /></div>
          <p className="muted">Placed on {niceDate(order.date)}</p>
        </div>
        <div className="odp-total"><span>Final total</span><b>{finalTotal}</b></div>
      </div>

      {order.invoice_available && (
        <div className="odp-invoice">
          <span className="odp-invoice-text"><Icon name="receipt" size={18} /> <b>Invoice {`INV-${order.order_no}`}</b> <small>in your shop's name, billed to Star Offset Printing</small></span>
          <span className="odp-invoice-btns">
            <Link to={`/orders/${order.id}/invoice`} className="dt-view"><Icon name="eye" size={14} /> View Invoice</Link>
            <button type="button" className="dt-view alt" onClick={getInvoice} disabled={dl.busy}><Icon name="download" size={14} /> {dl.busy ? "Preparing…" : "Download PDF"}</button>
          </span>
        </div>
      )}
      {dl.error && <p className="alert error">{dl.error}</p>}

      {order.status === "cancelled"
        ? <div className="odp-cancelled"><Icon name="close" size={18} /> This order was cancelled.</div>
        : (
          <section className="card odp-steps-card" aria-label="Order progress">
            <ol className="odp-steps">
              {FLOW.map((s, i) => {
                const st = i < stepIndex ? "done" : i === stepIndex ? "current" : "todo";
                return (
                  <li key={s.value} className={st} aria-current={st === "current" ? "step" : undefined}>
                    <span className="odp-dot">{st === "done" ? <Icon name="check" size={14} /> : i + 1}</span>
                    <span className="odp-step-label">{s.label}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

      <div className="odp-layout">
        <div className="odp-main">
          <div className="odp-block-title"><h2>Items</h2><span>{items.length} item{items.length === 1 ? "" : "s"}</span></div>
          {items.map((i, n) => (
            <article className="card odp-item" key={n}>
              <div className="odp-item-top">
                <div><span className="odp-item-no">Item {n + 1}</span><h3>{i.service_name}</h3></div>
                <b className={i.estimate == null ? "odp-noprice" : ""}>{i.estimate == null ? "No final price" : money(i.estimate)}</b>
              </div>
              <div className="odp-chips">
                {(i.spec || []).map((s) => <span className="odp-chip" key={s.label}><em>{s.label}</em>{s.value}</span>)}
                <span className="odp-chip"><em>Quantity</em>{Number(i.qty).toLocaleString("en-IN")}</span>
              </div>
              <div className="odp-files">
                <span className="odp-files-label"><Icon name="receipt" size={15} /> Artwork</span>
                {i.files?.length
                  ? <ul>{i.files.map((f, k) => <li key={k}><span>{f.name}</span>{f.size ? <small>{fileSize(f.size)}</small> : null}</li>)}</ul>
                  : <span className="muted">No files attached</span>}
              </div>
            </article>
          ))}

          {order.instructions && (
            <section className="card odp-panel">
              <h2>Additional instructions</h2>
              <p className="odp-text">{order.instructions}</p>
            </section>
          )}
          <p className="muted small">The displayed total is the final price recorded for this order.</p>
        </div>

        <aside className="odp-side">
          <section className="card odp-panel">
            <h2>Order summary</h2>
            <dl className="odp-dl">
              <dt>Order date</dt><dd>{niceDate(order.date)}</dd>
              <dt>Required delivery</dt><dd>{order.delivery_date ? niceDate(order.delivery_date) : "Not specified"}</dd>
              <dt>Items</dt><dd>{order.items}</dd>
              <dt>Final total</dt><dd className="odp-strong">{finalTotal}</dd>
            </dl>
          </section>

          {(order.status === "submitted" || order.status === "awaiting_payment" || paid) && (
            <section className={`card odp-panel odp-pay ${paid ? "paid" : "due"}`}>
              <h2><Icon name={paid ? "shield" : "wallet"} size={18} /> {paid ? "Payment confirmed" : order.status === "awaiting_payment" ? "Payment required" : "Order received"}</h2>
              {order.status === "submitted" && <p>Your order has been received. Star Offset will review it and confirm the final price.</p>}
              {order.status === "awaiting_payment" && <p>Star Offset has reviewed this order. Please pay using the instructions provided by Star Offset, then wait for the admin to confirm receipt.</p>}
              {order.status === "payment_confirmed" && <p>Payment has been confirmed by Star Offset. Your order can now proceed to production.</p>}
              {paid && (
                <dl className="odp-dl">
                  <dt>Method</dt><dd>{cap(order.payment_method) || "Not recorded"}</dd>
                  {order.payment_reference && <><dt>Reference</dt><dd>{order.payment_reference}</dd></>}
                  <dt>Confirmed</dt><dd>{new Date(order.payment_confirmed_at).toLocaleString("en-IN")}</dd>
                </dl>
              )}
            </section>
          )}

          <section className="card odp-help">
            <span className="odp-help-ico"><Icon name="phone" size={18} /></span>
            <div><b>Questions about this order?</b><small>Our team is happy to help.</small></div>
            <Link to="/contact" className="btn-link">Contact Support</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}