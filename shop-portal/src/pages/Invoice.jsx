import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import { downloadInvoice } from "../invoice";
import { niceDate } from "./MyOrders";
import "../invoice.css";

const inr = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The invoice of one paid order: Billed By = Star Offset Printing (main shop), Bill To = this shop.
export default function Invoice() {
  const { id } = useParams();
  const [state, setState] = useState({ id: "", inv: null, error: "" });
  const [busy, setBusy] = useState(false);
  const [dlError, setDlError] = useState("");

  useEffect(() => {
    let live = true;
    api.get(`/shop/orders/${id}/invoice/`)
      .then((r) => live && setState({ id, inv: r.data.invoice, error: "" }))
      .catch((e) => live && setState({ id, inv: null, error: e.response?.status === 404 ? "This order was not found." : errorText(e) }));
    return () => { live = false; };
  }, [id]);

  const back = <Link to={`/orders/${id}`} className="back-link inv-noprint"><Icon name="arrowleft" size={16} /> Back to order</Link>;
  if (state.id !== id) return <div className="ord">{back}<div className="card ord-loading">Loading invoice…</div></div>;
  if (state.error) return <div className="ord">{back}<p className="alert error">{state.error}</p></div>;

  const inv = state.inv;
  const { seller, bill_to: to, payment } = inv; // seller = this shop (header), to = main shop

  const download = async () => {
    setBusy(true);
    setDlError("");
    try { await downloadInvoice(id, inv.invoice_no); } catch (e) { setDlError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="ord inv-page">
      {back}
      <div className="page-head inv-noprint">
        <div>
          <h1>Invoice {inv.invoice_no}</h1>
          <p className="muted">Invoice for {inv.order_no}, billed to {to.name}.</p>
        </div>
        <div className="inv-actions">
          <button type="button" className="inv-btn" onClick={() => window.print()}><Icon name="print" size={16} /> Print</button>
          <button type="button" className="inv-btn primary" onClick={download} disabled={busy}><Icon name="download" size={16} /> {busy ? "Preparing…" : "Download PDF"}</button>
        </div>
      </div>
      {dlError && <p className="alert error inv-noprint">{dlError}</p>}

      <article className="inv-sheet" aria-label={`Invoice ${inv.invoice_no}`}>
        <header className="inv-top">
          <div className="inv-brand">
            <div>
              <h2>{seller.name}</h2>
              {seller.address && <p className="inv-addr">{seller.address}</p>}
              {(seller.phone || seller.email) && <p>{[seller.phone && `Phone: ${seller.phone}`, seller.email].filter(Boolean).join(" · ")}</p>}
              {seller.gst_number && <p>GSTIN: {seller.gst_number}</p>}
            </div>
          </div>
          <div className="inv-meta">
            <span className="inv-word">INVOICE</span>
            <dl>
              <dt>Invoice No</dt><dd>{inv.invoice_no}</dd>
              <dt>Date</dt><dd>{niceDate(inv.date)}</dd>
              <dt>Order No</dt><dd>{inv.order_no}</dd>
              <dt>Order Date</dt><dd>{niceDate(inv.order_date)}</dd>
            </dl>
          </div>
        </header>

        <section className="inv-parties">
          <div>
            <small>Bill To</small>
            <b>{to.name}</b>
            <p>{to.address}</p>
            <p>Phone: {to.phone}</p>
            <p>{to.email}</p>
          </div>
        </section>

        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead><tr><th>#</th><th>Description</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {inv.items.map((i) => (
                <tr key={i.no}>
                  <td>{i.no}</td>
                  <td>
                    <b>{i.name}</b>
                    {i.spec.length > 0 && <small>{i.spec.map((s) => `${s.label}: ${s.value}`).join(", ")}</small>}
                  </td>
                  <td className="num">{Number(i.qty).toLocaleString("en-IN")}</td>
                  <td className="num">{i.rate ? inr(i.rate) : "—"}</td>
                  <td className="num">{i.amount ? inr(i.amount) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="inv-totals">
          {inv.adjustment && <><dt>Sub Total</dt><dd>{inr(inv.subtotal)}</dd><dt>Price adjustment</dt><dd>{inr(inv.adjustment)}</dd></>}
          <dt className="grand">Total Amount</dt><dd className="grand">{inr(inv.total)}</dd>
        </dl>

        <section className="inv-pay">
          <span className="inv-paid"><Icon name="checkcircle" size={16} /> {payment.status}</span>
          {payment.method && <span><em>Mode</em> {payment.method}</span>}
          {payment.reference && <span><em>Reference</em> {payment.reference}</span>}
          {payment.paid_on && <span><em>Paid on</em> {niceDate(payment.paid_on)}</span>}
        </section>

        <footer className="inv-foot">This is a computer-generated invoice.</footer>
      </article>
    </div>
  );
}
