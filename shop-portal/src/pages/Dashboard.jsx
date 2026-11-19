import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import { useCart } from "../CartContext";
import { formatMoney, useWallet } from "../WalletContext";
import Icon from "../components/Icon";
import "../orderspage.css"; // order status badges (.ord-badge)
import "../dashboard.css";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

const today = () =>
  new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const money = (v) => (Number(v) > 0 ? `₹${Number(v).toLocaleString("en-IN")}` : "—");
const niceDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const txnDate = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

// the stages an order moves through, in order (counts come from /api/shop/orders/)
const PIPELINE = [
  ["submitted", "Submitted"],
  ["awaiting_payment", "Awaiting payment"],
  ["payment_confirmed", "Payment confirmed"],
  ["in_production", "In production"],
  ["completed", "Completed"],
];

export default function Dashboard() {
  const { shop } = useAuth();
  const { count: cartCount } = useCart();
  const { balance, transactions, loading: walletLoading } = useWallet();

  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    api.get("/shop/orders/", { signal: ctrl.signal })
      .then((r) => { setData(r.data); setError(""); })
      .catch((e) => { if (e.code !== "ERR_CANCELED") setError(errorText(e)); });
    return () => ctrl.abort();
  }, [tries]);

  const counts = data?.counts;
  const n = (key) => counts?.[key] ?? 0;
  const inProgress = n("submitted") + n("awaiting_payment") + n("payment_confirmed") + n("in_production");
  const awaiting = n("awaiting_payment");
  const recent = (data?.results || []).slice(0, 5);
  const recentTxns = (transactions || []).slice(0, 4);
  const val = (x) => (counts ? x : "—");

  const KPIS = [
    { label: "Total Orders", value: val(n("total")), icon: "receipt", tone: "accent", hint: "All time" },
    { label: "In Progress", value: val(inProgress), icon: "refresh", tone: "blue", hint: "Being processed" },
    { label: "Awaiting Payment", value: val(awaiting), icon: "history", tone: "orange", hint: awaiting ? "Needs your action" : "Nothing pending" },
    { label: "Completed", value: val(n("completed")), icon: "check", tone: "green", hint: "Delivered orders" },
  ];

  const ACTIONS = [
    { to: "/orders/new", icon: "plus", title: "Place an Order", text: "Upload artwork & requirements" },
    { to: "/prices", icon: "tag", title: "Printing Prices", text: "Services & specifications" },
    { to: "/cart", icon: "cart", title: "Order Cart", text: cartCount ? `${cartCount} item${cartCount === 1 ? "" : "s"} ready to send` : "Your cart is empty", badge: cartCount || null },
    { to: "/order-history", icon: "history", title: "Order History", text: "Completed & cancelled orders" },
  ];

  const pipelineMax = Math.max(1, ...PIPELINE.map(([k]) => n(k)));

  return (
    <div className="dx">
      {/* ---------- hero ---------- */}
      <section className="dx-hero">
        <div className="dx-hero-text">
          <span className="dx-date">{today()}</span>
          <h1>{greeting()}, {shop.name}! <Icon name="wave" size={26} className="dx-wave" /></h1>
          <p>Place new printing orders, track their progress and manage payments — all in one place.</p>
          <div className="dx-hero-cta">
            <Link to="/orders/new" className="dx-btn accent"><Icon name="plus" size={17} /> Place New Order</Link>
            <Link to="/prices" className="dx-btn ghost"><Icon name="tag" size={17} /> Browse Prices</Link>
          </div>
        </div>

        <div className="dx-wallet">
          <div className="dx-wallet-top">
            <span className="dx-wallet-ico"><Icon name="wallet" size={18} /></span>
            <span>Wallet Balance</span>
          </div>
          <strong className="dx-wallet-amt">{walletLoading && balance === null ? "…" : formatMoney(balance)}</strong>
          <p>Pay for orders instantly from your wallet.</p>
          <Link to="/wallet" className="dx-btn light"><Icon name="plus" size={16} /> Add Money</Link>
        </div>
      </section>

      {/* ---------- attention banner ---------- */}
      {awaiting > 0 && (
        <Link to="/orders" className="dx-alert">
          <span className="dx-alert-ico"><Icon name="info" size={20} /></span>
          <span className="dx-alert-text">
            <b>{awaiting} order{awaiting === 1 ? " is" : "s are"} awaiting payment</b>
            <small>Complete the payment so Star Offset can start production.</small>
          </span>
          <span className="dx-alert-go">View orders <Icon name="arrow" size={15} /></span>
        </Link>
      )}

      {error && (
        <div className="alert error dx-error">
          <span>{error}</span>
          <button type="button" onClick={() => setTries((t) => t + 1)}><Icon name="refresh" size={14} /> Retry</button>
        </div>
      )}

      {/* ---------- KPI cards ---------- */}
      <section className="dx-kpis" aria-label="Order overview">
        {KPIS.map((k) => (
          <Link to="/orders" className={`dx-kpi ${k.tone}`} key={k.label}>
            <span className="dx-kpi-ico"><Icon name={k.icon} size={20} /></span>
            <span className="dx-kpi-body">
              <small>{k.label}</small>
              <b>{k.value}</b>
              <em>{k.hint}</em>
            </span>
          </Link>
        ))}
      </section>

      <div className="dx-grid">
        {/* ---------- left column ---------- */}
        <div className="dx-col">
          <section className="card dx-card dx-flush">
            <div className="dx-card-head">
              <h2>Recent Orders</h2>
              <Link to="/orders" className="link-more">View all <Icon name="arrow" size={15} /></Link>
            </div>

            {!data && !error && (
              <div className="dx-skel" aria-label="Loading orders">{[0, 1, 2, 3].map((i) => <span key={i} />)}</div>
            )}

            {data && recent.length === 0 && (
              <div className="dx-empty">
                <span className="dx-empty-ico"><Icon name="receipt" size={24} /></span>
                <b>No orders yet</b>
                <p>Choose a printing service and place your first order with Star Offset.</p>
                <Link to="/orders/new" className="dx-btn accent"><Icon name="plus" size={16} /> Place an Order</Link>
              </div>
            )}

            {recent.length > 0 && (
              <ul className="dx-orders">
                {recent.map((o) => (
                  <li key={o.id}>
                    <Link to={`/orders/${o.id}`} className="dx-order">
                      <span className="dx-order-ico"><Icon name="receipt" size={18} /></span>
                      <span className="dx-order-main">
                        <b>{o.order_no}</b>
                        <small>{o.items_text || "Printing items"} · {o.items} item{Number(o.items) === 1 ? "" : "s"}</small>
                      </span>
                      <span className="dx-order-date">{niceDate(o.date)}</span>
                      <span className="dx-order-amt">{money(o.amount)}</span>
                      <span className={`ord-badge ${o.status}`}>{o.status_label}</span>
                      <Icon name="arrow" size={15} className="dx-order-go" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card dx-card">
            <div className="dx-card-head">
              <h2>Order Pipeline</h2>
              <span className="muted">Where your orders are right now</span>
            </div>
            <ol className="dx-pipe">
              {PIPELINE.map(([key, label]) => (
                <li key={key} className={`${key}${n(key) ? " has" : ""}`}>
                  <b>{val(n(key))}</b>
                  <span className="dx-pipe-bar"><i style={{ height: `${counts ? Math.max(n(key) ? 12 : 4, (n(key) / pipelineMax) * 100) : 4}%` }} /></span>
                  <small>{label}</small>
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* ---------- right column ---------- */}
        <aside className="dx-col">
          <section className="card dx-card">
            <div className="dx-card-head"><h2>Quick Actions</h2></div>
            <div className="dx-actions">
              {ACTIONS.map((a) => (
                <Link to={a.to} className="dx-action" key={a.to}>
                  <span className="dx-action-ico"><Icon name={a.icon} size={18} />{a.badge ? <i>{a.badge}</i> : null}</span>
                  <span className="dx-action-text"><b>{a.title}</b><small>{a.text}</small></span>
                  <Icon name="arrow" size={15} className="dx-action-go" />
                </Link>
              ))}
            </div>
          </section>

          <section className="card dx-card">
            <div className="dx-card-head">
              <h2>Wallet Activity</h2>
              <Link to="/wallet" className="link-more">All <Icon name="arrow" size={15} /></Link>
            </div>
            {recentTxns.length === 0 ? (
              <p className="muted dx-mini-empty">{walletLoading ? "Loading…" : "Top-ups and order payments will show up here."}</p>
            ) : (
              <ul className="dx-txns">
                {recentTxns.map((t) => (
                  <li key={t.id}>
                    <span className={`dx-txn-ico ${t.type} ${t.status || ""}`}><Icon name={t.type === "debit" ? "arrowup" : "arrowdown"} size={15} /></span>
                    <span className="dx-txn-main">
                      <b>{t.description || (t.type === "debit" ? "Order payment" : "Wallet top-up")}</b>
                      <small>{txnDate(t.created_at)}{t.status && t.status !== "completed" ? ` · ${t.status.charAt(0).toUpperCase()}${t.status.slice(1)}` : ""}</small>
                    </span>
                    <span className={`dx-txn-amt ${t.type} ${t.status || ""}`}>{t.type === "debit" ? "−" : "+"}{formatMoney(t.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}