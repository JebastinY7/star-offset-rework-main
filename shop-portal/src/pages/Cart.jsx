import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { errorText } from "../api";
import { useCart } from "../CartContext";
import Icon from "../components/Icon";

const money = (v) => `₹${Number(v).toLocaleString("en-IN")}`;

export default function Cart() {
  const { items, removeItem, clear } = useCart();
  const nav = useNavigate();
  const [fresh, setFresh] = useState({}); // item id -> price worked out just now (prices may have changed since it was added)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null); // the submitted request

  // re-check every price when the cart opens, so the total is not out of date
  const ids = items.map((i) => i.id).join(",");
  useEffect(() => {
    let live = true;
    Promise.all(items.map((i) =>
      api.get("/shop/price/", { params: i.params })
        .then((r) => [i.id, r.data.available ? r.data.estimate : null])
        .catch(() => null)))
      .then((pairs) => live && setFresh(Object.fromEntries(pairs.filter(Boolean))));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the set of items changes
  }, [ids]);

  const priceOf = (i) => (i.id in fresh ? fresh[i.id] : i.estimate);
  const priced = items.filter((i) => priceOf(i) != null);
  const total = priced.reduce((s, i) => s + priceOf(i), 0);
  const unpriced = items.length - priced.length;

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const r = await api.post("/shop/requests/", { items: items.map((i) => ({ params: i.params })) });
      clear();
      setDone(r.data.request);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="cart-done card">
        <span className="done-icon"><Icon name="check" size={26} /></span>
        <h1>Request submitted</h1>
        <p className="muted">
          Your quotation request <b>{done.request_no}</b> with {done.items} item{done.items !== 1 ? "s" : ""} has been sent to Star Offset.
          {Number(done.amount) > 0 && <> Estimated total <b>{money(done.amount)}</b>{done.unpriced > 0 ? `, plus ${done.unpriced} item${done.unpriced !== 1 ? "s" : ""} to be quoted.` : "."}</>}
          {Number(done.amount) === 0 && " Star Offset will quote the price."}
        </p>
        <div className="done-actions">
          <button type="button" className="primary" onClick={() => nav("/")}>Go to Dashboard</button>
          <Link to="/prices" className="btn-link">Browse Printing Prices</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cart">
      <div className="page-head">
        <div>
          <h1>Quotation Cart</h1>
          <p className="muted">Review your selected printing items before submitting.</p>
        </div>
        {items.length > 0 && (
          <button type="button" className="link-btn" onClick={() => { if (window.confirm("Remove all items from your cart?")) clear(); }}>Clear cart</button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card cart-empty">
          <span className="action-icon"><Icon name="cart" size={22} /></span>
          <h3>Your cart is empty</h3>
          <p className="muted">Browse printing prices and add the items you want quoted.</p>
          <Link to="/prices" className="btn-link primary">Browse Printing Prices <Icon name="arrow" size={16} /></Link>
        </div>
      ) : (
        <div className="cart-grid">
          <section className="cart-items">
            {items.map((i) => (
              <article className="card cart-item" key={i.id}>
                <div className="ci-main">
                  <h3>{i.service_name}</h3>
                  <p className="ci-spec">{i.spec.map((s) => <span key={s.label}><em>{s.label}:</em> {s.value}</span>)}<span><em>Quantity:</em> {i.qty.toLocaleString("en-IN")}</span></p>
                </div>
                <div className="ci-side">
                  <b className={priceOf(i) == null ? "ci-quote" : ""}>{priceOf(i) == null ? "Price on request" : money(priceOf(i))}</b>
                  <button type="button" className="link-btn danger" onClick={() => removeItem(i.id)} aria-label={`Remove ${i.service_name}`}><Icon name="close" size={14} /> Remove</button>
                </div>
              </article>
            ))}
          </section>

          <aside className="card cart-summary">
            <h3>Summary</h3>
            <div className="sum-row"><span>Items</span><b>{items.length}</b></div>
            <div className="sum-row total"><span>Estimated total</span><b>{priced.length ? money(total) : "—"}</b></div>
            {unpriced > 0 && <p className="muted small">{unpriced} item{unpriced !== 1 ? "s" : ""} will be priced by Star Offset.</p>}
            <p className="muted small">Prices are estimates. Star Offset confirms the final quotation.</p>
            {error && <p className="alert error">{error}</p>}
            <button type="button" className="primary big" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit Quotation Request"}</button>
            <Link to="/prices" className="back-link keep">Continue browsing</Link>
          </aside>
        </div>
      )}
    </div>
  );
}
