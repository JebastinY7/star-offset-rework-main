import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import api, { errorText } from "../api";
import { useCart } from "../CartContext";
import { formatMoney, useWallet } from "../WalletContext";
import { payError, payOnline } from "../razorpay";
import ArtworkPicker, { MAX_FILES, MAX_TOTAL_BYTES, totalSize } from "../components/ArtworkPicker";
import Icon from "../components/Icon";
import "../orderflow.css";
import "../ordercart-pay.css";

const money = (v) => `₹${Number(v).toLocaleString("en-IN")}`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// Order Cart: review items, manage each item's artwork, then place one complete order.
export default function OrderCart() {
  const notice = useLocation().state?.notice; // e.g. after "Reorder" in Order History
  const { items, removeItem, clear, filesOf, setItemFiles } = useCart();
  const { balance, refresh: refreshWallet } = useWallet();
  const [form, setForm] = useState({ deliveryDate: "", instructions: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [pick, setPick] = useState(null); // "wallet" | "online" | null = automatic

  const priced = items.filter((i) => i.estimate != null);
  const total = priced.reduce((sum, i) => sum + Number(i.estimate || 0), 0);
  const unpriced = items.length - priced.length;
  const allFiles = items.flatMap((i) => filesOf(i.id));
  const noArtwork = items.filter((i) => filesOf(i.id).length === 0).length;

  // payment method: wallet when it covers the total, otherwise online (the shop can still switch to online)
  const walletBal = Number(balance ?? 0);
  const walletOk = balance === null || walletBal >= total;
  const method = unpriced > 0 ? "quote" : (pick === "online" || !walletOk ? "online" : "wallet");

  const placeOrder = async () => {
    setError("");
    if (allFiles.length > MAX_FILES || totalSize(allFiles) > MAX_TOTAL_BYTES) {
      setError(`An order can have at most ${MAX_FILES} files and ${MAX_TOTAL_BYTES / 1048576} MB of artwork in total. Remove some files and try again.`);
      return;
    }
    if (noArtwork > 0 && !window.confirm(`${noArtwork} item${noArtwork === 1 ? " has" : "s have"} no artwork files. Place the order anyway?`)) return;

    const fd = new FormData();
    fd.append("items", JSON.stringify(items.map((i) => ({ params: i.params, dtp_details: i.dtp_details || null }))));
    fd.append("delivery_date", form.deliveryDate);
    fd.append("instructions", form.instructions);
    items.forEach((i, n) => filesOf(i.id).forEach((f) => fd.append(`files_${n}`, f)));

    setSending(true);
    let paid = false; // online payment went through (the money is now in the wallet)
    try {
      if (method === "online") {
        try {
          if ((await payOnline(total, "order")) === "cancelled") { setError("Payment cancelled. Your order has not been placed."); return; }
          paid = true;
        } catch (e) {
          setError(payError(e));
          return;
        }
      }
      const r = await api.post("/shop/orders/email/", fd);
      setDone({ id: r.data.id, no: r.data.order_no, items: items.length, files: allFiles.length, online: paid, quoted: unpriced > 0 });
      clear();
      setForm({ deliveryDate: "", instructions: "" });
    } catch (e) {
      if (paid) {
        setError(`Your payment of ${money(total)} was received and added to your wallet, but the order could not be placed: ${errorText(e)} Choose "Pay from wallet" and try again.`);
        setPick("wallet");
      } else {
        setError(errorText(e));
      }
    } finally {
      setSending(false);
      refreshWallet(); // payment / order changes the wallet - keep the top-bar balance current
    }
  };

  if (done) {
    return (
      <div className="cart-done card">
        <span className="done-icon"><Icon name="check" size={26} /></span>
        <h1>Order placed</h1>
        <p><b>{done.no}</b></p>
        <p className="muted">Your order with {done.items} item{done.items !== 1 ? "s" : ""} and {done.files} artwork file{done.files !== 1 ? "s" : ""} has been submitted{done.quoted ? " for quotation. No wallet payment was taken." : ` and paid ${done.online ? "online" : "from your wallet"}`}.</p>
        <div className="done-actions">
          <Link to={`/orders/${done.id}`} className="btn-link primary">View Order</Link>
          <Link to="/orders" className="btn-link">My Orders</Link>
          <Link to="/orders/new" className="btn-link">Place Another Order</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cart oc">
      <div className="page-head">
        <div>
          <h1>Order Cart</h1>
          <p className="muted">Review the final prices and pay from your wallet or online to place the order.</p>
        </div>
        {items.length > 0 && <button type="button" className="link-btn danger" onClick={() => { if (window.confirm("Remove all items and their files from your order cart?")) clear(); }}>Clear cart</button>}
      </div>

      {notice && items.length > 0 && <p className="alert ok">{notice}</p>}

      {items.length === 0 ? (
        <div className="card cart-empty">
          <span className="action-icon"><Icon name="cart" size={22} /></span>
          <h3>Your order cart is empty</h3>
          <p className="muted">Choose a printing service, attach your artwork and add it to the cart.</p>
          <Link to="/orders/new" className="btn-link primary">Place an Order <Icon name="arrow" size={16} /></Link>
        </div>
      ) : (
        <div className="cart-grid">
          <section className="cart-items">
            {items.map((item, index) => (
              <article className="card oc-item" key={item.id}>
                <div className="oc-top">
                  <div className="ci-main">
                    <span className="muted small">Item {index + 1}</span>
                    <h3>{item.service_name}</h3>
                    <p className="ci-spec">
                      {(item.spec || []).map((s) => <span key={s.label}><em>{s.label}:</em> {s.value}</span>)}
                      <span><em>Quantity:</em> {Number(item.qty).toLocaleString("en-IN")}</span>
                      {item.params?.kind === "visiting" && item.params?.visiting_card?.method === "offset" && <span><em>Jobs:</em> {Number(item.params.visiting_card.jobs || 1).toLocaleString("en-IN")}</span>}
                    </p>
                  </div>
                  <div className="ci-side">
                    <b className={item.estimate == null ? "ci-quote" : ""}>{item.estimate == null ? "Price to be confirmed" : money(item.estimate)}</b>
                    <button type="button" className="link-btn danger" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.service_name}`}><Icon name="close" size={14} /> Remove</button>
                  </div>
                </div>
                <div className="oc-files">
                  <h4>Artwork files</h4>
                  <ArtworkPicker id={`files-${item.id}`} files={filesOf(item.id)} onChange={(list) => setItemFiles(item.id, list)}
                    otherBytes={totalSize(allFiles) - totalSize(filesOf(item.id))} otherCount={allFiles.length - filesOf(item.id).length} />
                </div>
              </article>
            ))}
            <Link to="/orders/new" className="btn-link keep"><Icon name="plus" size={16} /> Add another printing item</Link>
          </section>

          <aside className="card cart-summary cs">
            <div className="cs-head">
              <h3>Place Order</h3>
              <p className="muted small">{items.length} item{items.length !== 1 ? "s" : ""} · {allFiles.length} artwork file{allFiles.length !== 1 ? "s" : ""}</p>
            </div>

            <div className="cs-body">
              {unpriced > 0 && <p className="muted small">{unpriced} item{unpriced !== 1 ? "s have" : " has"} no final price and cannot be ordered until pricing is available.</p>}

              <div className="field">
                <label htmlFor="delivery">Required delivery date</label>
                <input id="delivery" type="date" min={today()} value={form.deliveryDate} onChange={(e) => setForm((f) => ({ ...f, deliveryDate: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="instructions">Additional instructions</label>
                <textarea id="instructions" className="of-textarea" rows={2} maxLength={2000} value={form.instructions}
                  onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} placeholder="Packing, delivery, paper preferences…" />
              </div>

              {unpriced > 0 ? (
                <div className="alert">This cart contains {unpriced} item(s) without a configured price. Submit the order for a quotation; no wallet or online payment will be taken now.</div>
              ) : (
              <fieldset className="pm">
                <legend>Payment method</legend>
                <div className="pm-grid">
                  <label className={`pm-opt${method === "wallet" ? " on" : ""}${walletOk ? "" : " off"}`}>
                    <input type="radio" name="pay-method" value="wallet" checked={method === "wallet"} disabled={!walletOk || sending} onChange={() => setPick("wallet")} />
                    <span className="pm-ico"><Icon name="wallet" size={17} /></span>
                    <span className="pm-dot" />
                    <span className="pm-text">
                      <b>Wallet</b>
                      {walletOk
                        ? <small>Balance {formatMoney(balance ?? 0)}</small>
                        : <small className="short">Short by {formatMoney(total - walletBal)}</small>}
                    </span>
                  </label>
                  <label className={`pm-opt${method === "online" ? " on" : ""}`}>
                    <input type="radio" name="pay-method" value="online" checked={method === "online"} disabled={sending} onChange={() => setPick("online")} />
                    <span className="pm-ico"><Icon name="lock" size={17} /></span>
                    <span className="pm-dot" />
                    <span className="pm-text">
                      <b>Pay online</b>
                      <small>UPI, cards, net banking</small>
                    </span>
                  </label>
                </div>
                {!walletOk && <Link to="/wallet" className="pm-add">Add money to wallet instead</Link>}
              </fieldset>
              )}
            </div>

            <div className="cs-foot">
              <div className="cs-total"><span>Final total</span><b>{priced.length ? money(total) : "—"}</b></div>
              {error && <p className="alert error">{error}</p>}
              <button type="button" className="primary big" disabled={sending || items.length === 0} onClick={placeOrder}>
                {sending ? (method === "online" ? "Waiting for payment…" : "Submitting order…")
                  : unpriced > 0 ? "Submit for Quotation" : method === "online" ? `Pay ${money(total)} Online & Place Order` : "Pay from Wallet & Place Order"}
              </button>
              <p className="muted small cs-note">
                {method === "online"
                  ? "Secure payment via Razorpay. It is recorded in your wallet history and applied to this order."
                  : "The final total is deducted from your wallet when the order is placed."}
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}