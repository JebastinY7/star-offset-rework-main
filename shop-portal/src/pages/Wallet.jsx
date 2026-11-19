import { useState } from "react";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import TablePager from "../components/TablePager";
import { formatMoney, useWallet } from "../WalletContext";
import "../wallet.css";
import "../datatable.css";

const MIN = 100;
const MAX = 100000;
const QUICK = [500, 1000, 2000, 5000, 10000];
const FILTERS = [["all", "All"], ["credit", "Money in"], ["debit", "Money out"]];

const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

// Returns an error message, or "" when the amount is a valid top-up
function checkAmount(value) {
  const n = Number(value);
  if (value === "" || !Number.isFinite(n)) return "Enter the amount you want to add.";
  if (n < MIN || n > MAX) return "Enter an amount from ₹100 to ₹1,00,000.";
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return "Use at most two decimal places.";
  return "";
}

export default function Wallet() {
  const { balance, transactions, loading, error: loadError, refresh } = useWallet();
  const [amount, setAmount] = useState("500");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  const reload = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const changeAmount = (v) => { setAmount(v); setFieldError(""); };

  const addMoney = async () => {
    setError(""); setNotice("");
    const problem = checkAmount(amount);
    if (problem) { setFieldError(problem); return; }
    const n = Number(amount);
    setBusy(true);
    try {
      const { data } = await api.post("/shop/wallet/topup/create/", { amount: n.toFixed(2) });
      if (!window.Razorpay) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          s.onload = resolve; s.onerror = reject;
          document.body.appendChild(s);
        });
      }
      const checkout = new window.Razorpay({
        key: data.key_id, amount: data.amount, currency: data.currency,
        name: "Star Offset Printing", description: "Shop wallet top-up", order_id: data.razorpay_order_id,
        prefill: { name: data.shop_name, email: data.email, contact: data.phone },
        theme: { color: "#15803d" },
        handler: async (response) => {
          try {
            await api.post("/shop/wallet/topup/verify/", response);
            setNotice("Wallet credited successfully.");
            await refresh();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        },
        modal: { backdropclose: false, escape: false, ondismiss: () => setBusy(false) },
      });
      checkout.on("payment.failed", (r) => { setError(r?.error?.description || "Payment failed. Please try again."); setBusy(false); });
      checkout.open();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const shown = transactions.filter((t) => filter === "all" || t.type === filter);
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const cur = Math.min(page, pages);
  const pageRows = shown.slice((cur - 1) * size, cur * size);
  const last = transactions.find((t) => t.status === "completed");
  const balanceText = balance === null ? (loading ? "…" : "—") : formatMoney(balance);

  return (
    <div className="page wallet-page">
      <div className="page-head">
        <div>
          <h1>My Wallet</h1>
          <p className="muted">Add funds securely and pay for printing orders from your wallet.</p>
        </div>
      </div>

      {(error || loadError) && <div className="alert error wl-page-alert">{error || loadError}</div>}
      {notice && <div className="alert ok wl-page-alert" style={{ marginTop: 0 }}>{notice}</div>}

      <div className="wl-grid">
        <div className="wl-left">
          <section className="wl-hero" aria-label="Available balance">
            <div className="wl-hero-top">
              <span className="wl-hero-label"><span className="wl-hero-ico"><Icon name="wallet" size={18} /></span>Available balance</span>
              <span className="wl-cur">INR</span>
            </div>
            <h2 className="wl-balance">{balanceText}</h2>
            <p className="wl-hero-sub">Order totals are deducted from this balance when you place an order.</p>
            <div className="wl-hero-foot">
              <span>Last activity</span>
              <b>{last ? `${fmtDate(last.created_at)}, ${fmtTime(last.created_at)}` : "No activity yet"}</b>
            </div>
          </section>

          <section className="card wl-secure">
            <span className="wl-secure-ico"><Icon name="shield" size={22} /></span>
            <div>
              <h3>Secure payments</h3>
              <p>Top-ups are credited only after the backend verifies your Razorpay payment signature and confirms that the payment is captured.</p>
              <p>Wallet debits for orders are recorded in your transaction history.</p>
            </div>
          </section>
        </div>

        <section className="card wl-add">
          <h3 className="wl-card-title">Add money</h3>
          <p className="muted wl-card-sub">Top up instantly with UPI, cards or net banking.</p>

          <label className="wl-label" htmlFor="wallet-amount">Amount (₹)</label>
          <div className={`wl-amount${fieldError ? " invalid" : ""}`}>
            <span>₹</span>
            <input id="wallet-amount" type="number" inputMode="decimal" min={MIN} max={MAX} step="0.01" value={amount}
              onChange={(e) => changeAmount(e.target.value)}
              onWheel={(e) => e.currentTarget.blur()} /* scrolling must not change the amount */
              onKeyDown={(e) => { if (e.key === "Enter" && !busy && !loading) addMoney(); }} />
          </div>
          {fieldError && <p className="wl-field-err" role="alert">{fieldError}</p>}

          <div className="wl-quick" role="group" aria-label="Quick amounts">
            {QUICK.map((q) => (
              <button type="button" key={q} className={Number(amount) === q ? "active" : ""} onClick={() => changeAmount(String(q))}>
                +₹{q.toLocaleString("en-IN")}
              </button>
            ))}
          </div>

          <button type="button" className="primary wl-pay" disabled={busy || loading} onClick={addMoney}>
            <Icon name="lock" size={17} /> {busy ? "Processing…" : "Add Money with Razorpay"}
          </button>
          <p className="muted small wl-limits">Minimum ₹100 · Maximum ₹1,00,000 per top-up</p>
        </section>
      </div>

      <section className="dt-card wl-history">
        <div className="dt-head">
          <div><h2>Wallet Transactions</h2><p>Top-ups and order payments.</p></div>
          <div className="dt-tools">
            <div className="wl-tabs" role="tablist" aria-label="Filter transactions">
              {FILTERS.map(([key, label]) => (
                <button type="button" role="tab" key={key} aria-selected={filter === key} className={filter === key ? "active" : ""} onClick={() => { setFilter(key); setPage(1); }}>{label}</button>
              ))}
            </div>
            <button type="button" onClick={reload} disabled={refreshing}>
              <Icon name="refresh" size={15} className={refreshing ? "spin" : ""} /> Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="wl-empty"><p className="muted">Loading transactions…</p></div>
        ) : shown.length === 0 ? (
          <div className="wl-empty">
            <span className="wl-empty-ico"><Icon name="receipt" size={24} /></span>
            <strong>{transactions.length === 0 ? "No wallet transactions yet" : "No matching transactions"}</strong>
            <p className="muted">{transactions.length === 0 ? "Add money above and your top-ups and order payments will show up here." : "Try a different filter."}</p>
          </div>
        ) : (
          <div className="dt-wrap">
            <table className="dt-table">
              <thead>
                <tr><th>#</th><th>Transaction</th><th>Reference</th><th>Type</th><th>Date</th><th>Time</th><th>Status</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {pageRows.map((t, i) => (
                  <tr key={t.id}>
                    <td>{(cur - 1) * size + i + 1}</td>
                    <td>{t.description || (t.type === "debit" ? "Order payment" : "Wallet top-up")}</td>
                    <td className={t.reference ? "mono" : "dt-dash"}>{t.reference || "—"}</td>
                    <td>{t.type === "debit" ? "Money out" : "Money in"}</td>
                    <td>{fmtDate(t.created_at)}</td>
                    <td>{fmtTime(t.created_at)}</td>
                    <td><span className={`wl-pill ${t.status}`}>{t.status}</span></td>
                    <td className={`num wl-amt ${t.type}`}>{t.type === "debit" ? "−" : "+"}{formatMoney(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && shown.length > 0 && (
          <TablePager page={cur} pages={pages} total={shown.length} count={pageRows.length} size={size}
            onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} />
        )}
      </section>
    </div>
  );
}