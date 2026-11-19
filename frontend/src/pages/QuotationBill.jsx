import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";

// Printable quotation = /quotations/:id/bill   (same look as the invoice page)

const fmtDate = (d) => (d ? d.split("-").reverse().join("-") : "");
const money = (n) => Number(n || 0).toFixed(2);

export default function QuotationBill() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const [quote, setQuote] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get(`/quotations/${id}/`).then((r) => setQuote(r.data)).catch((e) => setErr(errorText(e)));
  }, [id]);

  // "Save & Print" on the quotation form opens this page with ?print=1
  const printed = useRef(false);
  useEffect(() => {
    if (quote && sp.get("print") && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 400);
    }
  }, [quote, sp]);

  const backTo = `/quotations?page=${sp.get("page") || 1}&q=${encodeURIComponent(sp.get("q") || "")}`;

  if (err) return <div className="error">{err}</div>;
  if (!quote) return <p>Loading…</p>;
  const q = quote;

  return (
    <div className="invoice-card">
      <div className="invoice-top"><h4>QUOTATION</h4></div>

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
        <div>
          <p><b>Quotation No:</b> {q.code}</p>
          <p><b>Date:</b> {fmtDate(q.quotation_date)}</p>
          {q.valid_until && <p><b>Valid Till:</b> {fmtDate(q.valid_until)}</p>}
        </div>
        <div>
          {q.customer_name && <p><b>Name:</b> {q.customer_name}</p>}
          {q.customer_phone && <p><b>Phone:</b> {q.customer_phone}</p>}
        </div>
      </div>

      <table className="invoice-table">
        <thead><tr><th>S.No</th><th>Service</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>
          {q.items.map((i, idx) => (
            <tr key={i.id}>
              <td>{idx + 1}</td><td>{i.name}</td><td>{i.qty}</td><td>{money(i.price)}</td><td>{money(i.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="summary-box">
        {(q.discount > 0 || q.extra_charge > 0) && (
          <div className="srow"><span>Items Total :</span><span>₹ {money(q.items.reduce((s, i) => s + i.total, 0))}</span></div>
        )}
        {q.discount > 0 && <div className="srow"><span>Discount :</span><span>- ₹ {money(q.discount)}</span></div>}
        {q.extra_charge > 0 && <div className="srow"><span>Extra Charges :</span><span>₹ {money(q.extra_charge)}</span></div>}
        <div className="srow final"><span>Quotation Amount :</span><span>₹ {money(q.total_amount)}</span></div>
      </div>

      {(q.notes || q.terms) && (
        <div style={{ margin: "14px 0", fontSize: 13 }}>
          {q.notes && <p><b>Notes:</b> {q.notes}</p>}
          {q.terms && <p style={{ whiteSpace: "pre-line" }}><b>Terms:</b> {q.terms}</p>}
        </div>
      )}

      <div className="signature-box">
        <p>Customer Signature</p>
        <div className="sign-right">
          <img src="/images/signature.png" alt="" className="signature-img" />
          <p>For <b>STAR OFFSET PRINTING</b></p>
        </div>
      </div>

      <div className="row no-print" style={{ marginTop: 16 }}>
        <Link to={backTo}><button>Back</button></Link>
        <button className="primary" onClick={() => window.print()}>Print</button>
      </div>
    </div>
  );
}
