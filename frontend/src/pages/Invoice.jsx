import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";

const fmtDate = (d) => (d ? d.split("-").reverse().join("-") : "");
const n = (v) => Number(v || 0);

export default function Invoice() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const [bill, setBill] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get(`/bills/${id}/`).then((r) => setBill(r.data)).catch((e) => setErr(errorText(e)));
  }, [id]);

  // "Save & Print" on the billing page opens this page with ?print=1
  const printed = useRef(false);
  useEffect(() => {
    if (bill && sp.get("print") && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 400);
    }
  }, [bill, sp]);

  if (err) return <div className="error">{err}</div>;
  if (!bill) return <p>Loading…</p>;
  const b = bill;

  return (
    <div className="invoice-card">
      <div className="invoice-top"><h4>INVOICE / CASH BILL</h4></div>

      <div className="invoice-shop">
        <img src="/images/logo.png" alt="" className="shop-logo" />
        <div>
          <h1>Star Offset Printing</h1>
          <p>1/116, Puthanchanthai Jn, Maruthancode Post</p>
          <p>K.K District - 629163</p>
          <p><Icon name="phone" size={13} /> +91 9488634058</p>
          <p><Icon name="mail" size={13} /> staroffsets@gmail.com</p>
        </div>
      </div>

      <div className="invoice-header">
        <div><p><b>Bill No:</b> {b.bill_no}</p><p><b>Date:</b> {fmtDate(b.bill_date)}</p></div>
        <div><p><b>Name:</b> {b.customer.name}</p><p><b>Phone:</b> {b.customer.phone}</p></div>
      </div>

      <table className="invoice-table">
        <thead><tr><th>S.No</th><th>Service</th><th>Qty</th><th>Price</th><th>Discount</th><th>Extra Charge</th><th>Total</th></tr></thead>
        <tbody>
          {b.items.map((i, idx) => (
            <tr key={i.id}>
              <td>{idx + 1}</td>
              <td>{i.name}{i.extraPurpose && <><br /><small>Extra: {i.extraPurpose}</small></>}</td>
              <td>{i.qty}</td><td>{i.price}</td>
              <td>{i.discount > 0 ? i.discount : "-"}</td>
              <td>{i.extraCharge > 0 ? i.extraCharge : "-"}</td>
              <td>{i.total}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="summary-box">
        {(n(b.discount) > 0 || n(b.extra_charge_total) > 0) && <div className="srow"><span>Gross Total :</span><span>₹ {b.gross_total}</span></div>}
        {n(b.discount) > 0 && <div className="srow"><span>Discount :</span><span>₹ {b.discount}</span></div>}
        {n(b.extra_charge_total) > 0 && <div className="srow"><span>Extra Charge :</span><span>₹ {b.extra_charge_total}</span></div>}
        <div className="srow"><span>Net Total :</span><span>₹ {b.total_amount}</span></div>
        <div className="srow final"><span>Final Amount :</span><span>₹ {b.final_amount}</span></div>

        {n(b.current_due) > 0 && (
          <>
            <div className="srow"><span>Paid Amount :</span><span>₹ {b.paid_amount}</span></div>
            <div className="srow"><span>Due Amount (This Bill) :</span><span>₹ {b.current_due}</span></div>
          </>
        )}
        {n(b.previous_due) > 0 && <div className="srow"><span>Previous Due :</span><span>₹ {b.previous_due}</span></div>}
        {n(b.old_due_paid) > 0 && (
          <>
            <div className="srow"><span>Old Due Paid :</span><span>₹ {b.old_due_paid}</span></div>
            <div className="srow"><span>Total Paid :</span><span>₹ {(n(b.paid_amount) + n(b.old_due_paid)).toFixed(2)}</span></div>
          </>
        )}
        {n(b.due_amount) > 0 && n(b.due_amount) !== n(b.current_due) && (
          <div className="srow final"><span>Total Due :</span><span>₹ {b.due_amount}</span></div>
        )}
        {b.payment_mode && b.payment_mode !== "credit" && (n(b.paid_amount) > 0 || n(b.old_due_paid) > 0) && (
          <div className="srow"><span>Payment Mode :</span><span>{{ cash: "Cash", upi: "UPI", bank: "Bank" }[b.payment_mode] || b.payment_mode}</span></div>
        )}
        <div className="srow"><span>Status :</span>
          <span className={b.payment_status === "paid" ? "ok" : "bad"}>{b.payment_status.toUpperCase()}</span>
        </div>
      </div>

      <div className="signature-box">
        <p>Customer Signature</p>
        <div className="sign-right">
          <img src="/images/signature.png" alt="" className="signature-img" />
          <p>For <b>STAR OFFSET PRINTING</b></p>
        </div>
      </div>

      <div className="row no-print" style={{ marginTop: 16 }}>
        <Link to={sp.get("from_history") ? "/history" : "/billing"}><button>Back</button></Link>
        <Link to="/billing"><button>New Bill</button></Link>
        <button className="primary" onClick={() => window.print()}>Print</button>
      </div>
    </div>
  );
}