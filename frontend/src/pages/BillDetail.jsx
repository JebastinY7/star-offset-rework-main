import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import "./billing.css";
import "./orders.css";
import "./billhistory.css";

const n = (v) => Number(v || 0);
const money = (v) => "₹" + n(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? d.split("-").reverse().join("-") : "");
const STATUS_LABEL = { paid: "Paid", partial: "Partial", due: "Unpaid" };
const MODE_LABEL = { cash: "Cash", upi: "UPI", bank: "Bank", credit: "Credit" };

// everything about an item that is not already in its name
function spec(i) {
  const parts = [];
  if (i.sideName) parts.push(i.sideName);
  if (i.deliveryTypeName && !i.name.includes(i.deliveryTypeName)) parts.push(i.deliveryTypeName);
  if (n(i.job) > 1) parts.push(`${i.job} jobs`);
  if (i.extraPurpose) parts.push(`Extra: ${i.extraPurpose}${n(i.extraCharge) > 0 ? ` (${money(i.extraCharge)})` : ""}`);
  return parts.join(" · ");
}

export default function BillDetail() {
  const { id } = useParams();
  const [bill, setBill] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get(`/bills/${id}/`).then((r) => setBill(r.data)).catch((e) => setErr(errorText(e)));
  }, [id]);

  if (err) return <><div className="error">{err}</div><Link to="/history" className="bd-back">← Back to Bill History</Link></>;
  if (!bill) return <p>Loading…</p>;
  const b = bill;
  const c = b.customer;
  const received = b.payments.reduce((sum, p) => sum + n(p.amount), 0);

  return (
    <div className="bd">
      <div className="bd-head no-print">
        <Link to="/history" className="bd-back" title="Back to Bill History"><Icon name="arrowLeft" size={18} />Bill History</Link>
        <div className="bd-title">
          <h1>Bill {b.bill_no}</h1>
          <span className={`status ${b.payment_status}`}>{STATUS_LABEL[b.payment_status] || b.payment_status}</span>
          <span className="muted">{fmtDate(b.bill_date)}</span>
        </div>
        <div className="bd-btns">
          <Link to={`/invoice/${b.id}?print=1&from_history=1`}><button type="button" title="Open the invoice and print it"><Icon name="printer" size={16} />Print</button></Link>
          <button type="button" title="Download the invoice as a PDF" onClick={() => window.open(`/api/bills/${b.id}/pdf/`, "_blank")}><Icon name="download" size={16} />Download</button>
        </div>
      </div>

      <div className="bd-top">
        <section className="card bd-sec customer">
          <div className="bd-sec-head"><h3>Customer Details</h3></div>
          <div className="bd-sec-body">
            <div className="bd-name"><Link className="back-link" to={`/customers/${c.id}`}>{c.name}</Link></div>
            <div className="srow"><span>Phone</span><span>{c.phone}</span></div>
            <div className="srow"><span>Customer type</span><span style={{ textTransform: "capitalize" }}>{c.category}{c.is_member ? " · Member" : ""}</span></div>
            {c.is_member && c.member_id && <div className="srow"><span>Member ID</span><span>{c.member_id}</span></div>}
            <div className="srow"><span>Account due (all bills)</span><span className={n(c.due_amount) > 0 ? "bad" : ""}>{money(c.due_amount)}</span></div>
          </div>
        </section>

        <section className="card bd-sec invoice">
          <div className="bd-sec-head"><h3>Invoice Summary</h3></div>
          <div className="bd-sec-body">
            <div className="srow"><span>Subtotal</span><span>{money(b.gross_total)}</span></div>
            <div className="srow"><span>Discount</span><span>{money(b.discount)}</span></div>
            {n(b.extra_charge_total) > 0 && <div className="srow"><span>Extra charge</span><span>{money(b.extra_charge_total)}</span></div>}
            <div className="srow final"><span>Final Amount</span><span>{money(b.final_amount)}</span></div>
            <div className="srow"><span>Paid</span><span className="ok">{money(b.paid_amount)}</span></div>
            <div className="srow out"><span>Outstanding</span><span className={n(b.current_due) > 0 ? "bad" : "ok"}>{money(b.current_due)}</span></div>
            {n(b.previous_due) > 0 && <div className="srow"><span>Previous due</span><span>{money(b.previous_due)}</span></div>}
            {n(b.old_due_paid) > 0 && <div className="srow"><span>Old due paid</span><span className="ok">{money(b.old_due_paid)}</span></div>}
          </div>
        </section>
      </div>

      <section className="card bd-sec items">
        <div className="bd-sec-head"><h3>Bill Items</h3></div>
        <div className="bd-table-wrap">
          <table className="bd-table">
            <thead>
              <tr><th>Item</th><th>Specification</th><th className="num">Qty</th><th className="num">Unit Price</th><th className="num">Discount</th><th className="num">Total</th></tr>
            </thead>
            <tbody>
              {b.items.length === 0 && <tr><td colSpan={6} className="bd-empty">No items on this bill</td></tr>}
              {b.items.map((i) => (
                <tr key={i.id}>
                  <td><b>{i.name}</b></td>
                  <td className="bd-spec">{spec(i) || "—"}</td>
                  <td className="num">{i.qty}</td>
                  <td className="num">{money(i.price)}</td>
                  <td className="num">{n(i.discount) > 0 ? money(i.discount) : "—"}</td>
                  <td className="num"><b>{money(i.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card bd-sec payments">
        <div className="bd-sec-head"><h3>Payment History</h3></div>
        <div className="bd-table-wrap">
          <table className="bd-table">
            <thead>
              <tr><th>Date</th><th>Receipt No</th><th>Payment Mode</th><th>Note</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {b.payments.length === 0 && <tr><td colSpan={5} className="bd-empty">No payment received yet — the full amount is outstanding.</td></tr>}
              {b.payments.map((p) => (
                <tr key={p.receipt_no}>
                  <td className="nowrap">{fmtDate(p.date)}</td>
                  <td><b>{p.receipt_no}</b></td>
                  <td>{MODE_LABEL[p.mode] || p.mode}</td>
                  <td className="bd-spec">{p.note}</td>
                  <td className="num">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
            {b.payments.length > 1 && (
              <tfoot><tr><td colSpan={4}>Total received</td><td className="num">{money(received)}</td></tr></tfoot>
            )}
          </table>
        </div>
      </section>

      <div className="bd-foot no-print">
        <Link to="/history"><button type="button"><Icon name="arrowLeft" size={16} />Back to Bill History</button></Link>
        <button type="button" className="primary" onClick={() => window.print()}><Icon name="printer" size={16} />Print Receipt</button>
      </div>
    </div>
  );
}