import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import { useAuth } from "../AuthContext";
import { useCart } from "../CartContext";
import api, { errorText } from "../api";

const money = (v) => `₹${Number(v).toLocaleString("en-IN")}`;

export default function OrderForm() {
  const { shop } = useAuth();
  const { items, clear } = useCart();
  const [form, setForm] = useState({ deliveryDate: "", instructions: "" });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const fileKey = (f) => `${f.name}|${f.size}|${f.lastModified}`;
  const addFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = ""; // reset so the same file can be re-picked and each pick fires onChange
    if (!picked.length) return;
    setFiles((old) => {
      const seen = new Set(old.map(fileKey));
      const fresh = picked.filter((f) => !seen.has(fileKey(f)));
      return [...old, ...fresh];
    });
  };
  const removeFile = (key) => setFiles((old) => old.filter((f) => fileKey(f) !== key));
  const update = (key) => (e) => setForm((old) => ({ ...old, [key]: e.target.value }));

  const sendOrder = async (e) => {
    e.preventDefault();
    setError("");
    setPrepared(false);
    if (!items.length) {
      setError("Your order cart is empty. Browse printing prices and add at least one item first.");
      return;
    }
    const fd = new FormData();
    fd.append("items", JSON.stringify(items.map((i) => ({ params: i.params }))));
    fd.append("delivery_date", form.deliveryDate);
    fd.append("instructions", form.instructions);
    files.forEach((f) => fd.append("files", f));
    setSending(true);
    try {
      await api.post("/shop/orders/email/", fd);
      setSentCount(items.length);
      setPrepared(true);
      setFiles([]);
      setForm({ deliveryDate: "", instructions: "" });
      clear();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  };

  if (!items.length && prepared) {
    return <div className="order-form-page">
      <div className="page-head"><div><h1>Place Order</h1><p className="muted">Your order has been sent.</p></div></div>
      <div className="card cart-empty"><span className="action-icon"><Icon name="check" size={22} /></span><h3>Order sent</h3><p className="muted">Your order for {sentCount} item(s) was emailed to Star Offset with your artwork files attached.</p><Link to="/prices" className="btn-link primary">Back to Printing Prices <Icon name="arrow" size={16} /></Link></div>
    </div>;
  }

  if (!items.length) {
    return <div className="order-form-page">
      <div className="page-head"><div><h1>Place Order</h1><p className="muted">Your order is created from items in the cart.</p></div></div>
      <div className="card cart-empty"><span className="action-icon"><Icon name="cart" size={22} /></span><h3>Your order cart is empty</h3><p className="muted">Add one or more printing items before placing an order.</p><Link to="/prices" className="btn-link primary">Browse Printing Prices <Icon name="arrow" size={16} /></Link></div>
    </div>;
  }

  return (
    <div className="order-form-page">
      <div className="page-head">
        <div><h1>Place Order</h1><p className="muted">Review all items, attach your artwork and send the complete order to Star Offset.</p></div>
        <Link to="/cart" className="btn-link">Back to Order Cart</Link>
      </div>

      <section className="card order-review">
        <div className="dash-h-row"><h2 className="dash-h">Order Items ({items.length})</h2><Link to="/prices" className="link-more">+ Add More Items</Link></div>
        {items.map((item, index) => (
          <div className="order-review-item" key={item.id}>
            <div><strong>{index + 1}. {item.service_name}</strong><p className="muted small">Qty: {Number(item.qty).toLocaleString("en-IN")} · {(item.spec || []).map((s) => `${s.label}: ${s.value}`).join(" · ") || "Specifications not provided"}</p></div>
            <b>{item.estimate == null ? "Price to be confirmed" : money(item.estimate)}</b>
          </div>
        ))}
        <div className="order-review-total"><span>Estimated total</span><strong>{items.some((i) => i.estimate != null) ? money(items.reduce((sum, i) => sum + (i.estimate == null ? 0 : Number(i.estimate)), 0)) : "Price to be confirmed"}</strong></div>
      </section>

      <form className="card order-form" onSubmit={sendOrder}>
        <h2 className="dash-h">Delivery & Artwork</h2>
        <div className="order-fields">
          <div className="field">
            <label htmlFor="order-date">Required delivery date</label>
            <input id="order-date" type="date" value={form.deliveryDate} onChange={update("deliveryDate")} />
          </div>
          <div className="field full">
            <label htmlFor="order-files">Artwork files (all items)</label>
            <input id="order-files" type="file" multiple onChange={addFiles} />
            {files.length > 0 && (
              <ul className="muted small" style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
                {files.map((f) => (
                  <li key={fileKey(f)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                    <span>{f.name} ({Math.max(1, Math.round(f.size / 1024)).toLocaleString("en-IN")} KB)</span>
                    <button type="button" onClick={() => removeFile(fileKey(f))} aria-label={`Remove ${f.name}`}
                      style={{ border: 0, background: "none", color: "#b42318", cursor: "pointer", padding: 0 }}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">Your artwork files are attached to the order email automatically (up to 10 files, 20 MB in total).</p>
          </div>
          <div className="field full">
            <label htmlFor="order-instructions">Additional instructions</label>
            <textarea id="order-instructions" rows="3" value={form.instructions} onChange={update("instructions")} placeholder="Packing, delivery, paper preferences or other instructions" />
          </div>
        </div>
        {error && <p className="alert error order-alert">{error}</p>}
        {prepared && <p className="alert ok order-alert"><Icon name="check" size={16} /> Order sent for {sentCount} item(s) with your artwork files attached.</p>}
        <div className="order-actions"><Link to="/cart" className="btn-link">Back to Cart</Link><button type="submit" className="primary" disabled={sending}><Icon name="mail" size={17} /> {sending ? "Sending..." : "Send Order"}</button></div>
      </form>
    </div>
  );
}