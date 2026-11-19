import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import Pagination from "../components/Pagination";
import ReportPeriod from "../components/ReportPeriod";
import { fmtDay, iso, money, periodFromParams, periodQuery } from "../lib/reports";
import "./orders.css";
import "./billhistory.css";
import "./billing.css";
import "./reports.css";
import "./shopPayments.css";

const PAGE_SIZE = 15; // matches the server

const TYPE = {
  topup: ["Wallet top-up", "green"],
  online_order: ["Online order payment", "blue"],
  order_payment: ["Order paid from wallet", "amber"],
  refund: ["Refund", ""],
  adjustment: ["Adjustment", ""],
};
const STATUS = { completed: ["Completed", "green"], pending: ["Pending", "amber"], failed: ["Failed", "red"] };

// quick filters above the table: [view, label, count key, amount key]
const CHIPS = [
  ["", "All", "all_count", null],
  ["received", "Received", "received_count", "received"],
  ["spent", "Spent on orders", "spent_count", "spent"],
  ["pending", "Pending", "pending_count", "pending"],
  ["failed", "Failed", "failed_count", null],
  ["refunds", "Refunds", "refunds_count", "refunds"],
];

const when = (at) => {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return {
    day: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", ...(sameYear ? {} : { year: "numeric" }) }),
    time: d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
  };
};

const shopCell = (s) => (
  <>
    <b className="sp-shop">{s.name}</b>
    <span className="od-sub">{s.phone}</span>
  </>
);

// shared by both tabs: load a list from the API with a short typing pause
function useList(url, params, page, tick) {
  const [res, setRes] = useState({ key: "", data: null, error: "" });
  const paramKey = JSON.stringify(params);
  const reqKey = `${paramKey}|${page}|${tick}`;
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api.get(url, { params: { ...JSON.parse(paramKey), page } })
        .then((r) => { if (live) setRes({ key: reqKey, data: r.data, error: "" }); })
        .catch((e) => { if (live) setRes({ key: reqKey, data: null, error: errorText(e) }); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [url, paramKey, page, reqKey]);
  return { data: res.data, error: res.error, loading: res.key !== reqKey };
}

function Foot({ count, page, setPage }) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const first = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, count);
  return (
    <div className="od-foot-row">
      <span className="muted">Showing {first}–{last} of {count}</span>
      {pages > 1 && <Pagination page={page} pages={pages} onChange={setPage} />}
    </div>
  );
}

/* ---------------------------------------------------------------- payments */
function Payments({ initialQ, tick }) {
  const [sp, setSp] = useSearchParams();
  const period = periodFromParams(sp);
  const { from, to } = period;
  const [q, setQ] = useState(initialQ);
  const [view, setView] = useState("");
  const [page, setPage] = useState(1);

  const params = { date_from: from, date_to: to, ...(view ? { view } : {}), ...(q.trim() ? { q: q.trim() } : {}) };
  const { data, error, loading } = useList("/admin/shop-payments/", params, page, tick);
  const s = data?.summary;
  const rows = data?.results || [];
  const filtered = Boolean(q || view);

  const applyPeriod = ({ from: f, to: t }) => { setSp({ date_from: f, date_to: t }); setPage(1); };

  const stats = s && [
    ["Payments Received", money(s.received), "recv", `${s.received_count} ${s.received_count === 1 ? "payment" : "payments"} via Razorpay`],
    ["Spent on Orders", money(s.spent), "spent", `${s.spent_count} ${s.spent_count === 1 ? "order" : "orders"} paid from wallets`],
    ["Pending Payments", money(s.pending), "wait", s.failed_count ? `${s.failed_count} failed` : "Started, not completed"],
    ["Wallet Balance Held", money(s.balance), "held", `${s.shops_with_balance} ${s.shops_with_balance === 1 ? "shop" : "shops"} · all time`],
  ];

  return (
    <>
      <ReportPeriod key={`${from}|${to}`} from={from} to={to} onApply={applyPeriod} />
      {error && <div className="error">{error}</div>}

      {stats && (
        <div className="od-stats rp-kpis">
          {stats.map(([label, value, tone, hint]) => (
            <div key={label} className={`od-stat ${tone} rp-kpi`}><b>{value}</b><span>{label}</span><small>{hint}</small></div>
          ))}
        </div>
      )}

      {s && (
        <div className="bl-chips rp-chips">
          {CHIPS.filter(([v, , countKey]) => v !== "refunds" || s[countKey] > 0 || view === "refunds").map(([v, label, countKey, amountKey]) => (
            <button key={v || "all"} type="button" className={`bl-chip${view === v ? " on" : ""}`}
              onClick={() => { setView(view === v ? "" : v); setPage(1); }}>
              {label} · {amountKey ? money(s[amountKey]) : s[countKey]}
            </button>
          ))}
        </div>
      )}

      <div className="card od-filters">
        <div className="rp-filter-row" style={{ gridTemplateColumns: "minmax(220px, 1fr) auto" }}>
          <div className="search-box">
            <Icon name="search" size={16} />
            <input placeholder="Search shop / phone / payment ID / order no." value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search" />
          </div>
          <button type="button" disabled={!filtered} onClick={() => { setQ(""); setView(""); setPage(1); }}>Clear</button>
        </div>
      </div>

      <div className="card od-register">
        <div className="od-reg-head">
          <h3>Shop Portal Transactions<span className="muted">{data?.count ?? 0} {data?.count === 1 ? "record" : "records"}</span></h3>
        </div>
        <div className="od-table-wrap">
          <table className={`od-table rp-table${loading ? " rp-loading" : ""}`}>
            <thead>
              <tr><th>Date</th><th>Shop</th><th>Type</th><th>Details</th><th>Status</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {!data && loading && <tr><td colSpan={6} className="od-empty">Loading…</td></tr>}
              {data && rows.length === 0 && (
                <tr><td colSpan={6} className="od-empty">{filtered ? "No transactions match these filters" : "No shop payments in this period"}</td></tr>
              )}
              {rows.map((r) => {
                const [typeLabel, typeTone] = TYPE[r.type] || [r.type, ""];
                const [statusLabel, statusTone] = STATUS[r.status] || [r.status, ""];
                const w = when(r.at);
                const out = r.kind === "debit";
                const live = r.status === "completed";
                return (
                  <tr key={r.id}>
                    <td className="nowrap">{w.day}<span className="od-sub">{w.time}</span></td>
                    <td>{shopCell(r.shop)}</td>
                    <td><span className={`pill ${typeTone}`}>{typeLabel}</span></td>
                    <td className="sp-details">
                      <span>{r.description || "—"}</span>
                      {r.order_id
                        ? <Link className="sp-ref link" to={`/shop-orders/${r.order_id}`}>{r.order_no}</Link>
                        : (r.reference || r.razorpay_order_id) && <span className="sp-ref">{r.reference || r.razorpay_order_id}</span>}
                    </td>
                    <td><span className={`pill ${statusTone}`}>{statusLabel}</span></td>
                    <td className={`num sp-amt ${live ? (out ? "out" : "in") : "dim"}`}>
                      <b>{live ? (out ? "−" : "+") : ""}{money(r.amount)}</b>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Foot count={data?.count || 0} page={page} setPage={setPage} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ wallets */
function Wallets({ tick, onOpen }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading } = useList("/admin/shop-payments/wallets/", q.trim() ? { q: q.trim() } : {}, page, tick);
  const s = data?.summary;
  const rows = data?.results || [];

  return (
    <>
      {error && <div className="error">{error}</div>}
      {s && (
        <div className="od-stats rp-kpis">
          <div className="od-stat held rp-kpi"><b>{money(s.balance)}</b><span>Wallet Balance Held</span><small>Paid in advance, not yet spent</small></div>
          <div className="od-stat recv rp-kpi"><b>{s.shops_with_balance}</b><span>Shops with Balance</span></div>
          <div className="od-stat total rp-kpi"><b>{s.shops}</b><span>Total Shops</span></div>
        </div>
      )}

      <div className="card od-filters">
        <div className="rp-filter-row" style={{ gridTemplateColumns: "minmax(220px, 1fr) auto" }}>
          <div className="search-box">
            <Icon name="search" size={16} />
            <input placeholder="Search shop / phone / email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search shops" />
          </div>
          <button type="button" disabled={!q} onClick={() => { setQ(""); setPage(1); }}>Clear</button>
        </div>
      </div>

      <div className="card od-register">
        <div className="od-reg-head">
          <h3>Shop Wallets<span className="muted">{data?.count ?? 0} {data?.count === 1 ? "shop" : "shops"}</span></h3>
        </div>
        <div className="od-table-wrap">
          <table className={`od-table rp-table${loading ? " rp-loading" : ""}`}>
            <thead>
              <tr>
                <th>Shop</th><th className="num">Wallet Balance</th><th className="num">Total Paid In</th>
                <th className="num">Spent on Orders</th><th className="num">Orders Paid</th><th>Last Payment</th><th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {!data && loading && <tr><td colSpan={7} className="od-empty">Loading…</td></tr>}
              {data && rows.length === 0 && <tr><td colSpan={7} className="od-empty">{q ? "No shops match your search" : "No shops yet"}</td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{shopCell(r.shop)}{!r.portal_access && <span className="od-tag red">Portal off</span>}</td>
                  <td className="num"><b>{money(r.balance)}</b></td>
                  <td className="num">{money(r.topped_up)}</td>
                  <td className="num">{money(r.spent)}</td>
                  <td className="num">{r.orders}</td>
                  <td className="nowrap">{r.last_payment ? fmtDay(iso(new Date(r.last_payment))) : <span className="muted">—</span>}</td>
                  <td style={{ textAlign: "right" }}><button type="button" onClick={() => onOpen(r.shop.name)}>View payments</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Foot count={data?.count || 0} page={page} setPage={setPage} />
      </div>
    </>
  );
}

/* --------------------------------------------------------------------- page */
export default function ShopPayments() {
  const [sp] = useSearchParams();
  const [tab, setTab] = useState(sp.get("tab") === "wallets" ? "wallets" : "payments");
  const [jump, setJump] = useState({ q: sp.get("q") || "", n: 0 }); // n changes -> the payments tab starts fresh with this search
  const [tick, setTick] = useState(0);

  const openShop = (name) => { setJump((j) => ({ q: name, n: j.n + 1 })); setTab("payments"); };

  return (
    <>
      <div className="od-head">
        <div>
          <h1>Shop Payments</h1>
          <p className="muted">Wallet payments and order payments received from the Shop Portal.</p>
        </div>
        <div className="row">
          <Link to={`/reports/shop?${periodQuery(periodFromParams(sp))}`}><button type="button" className="bh-btn-ico"><Icon name="chart" size={16} />Shop Report</button></Link>
          <button type="button" className="bh-btn-ico" onClick={() => setTick((t) => t + 1)}><Icon name="refresh" size={16} />Refresh</button>
        </div>
      </div>

      <div className="rp-seg sp-tabs" role="tablist" aria-label="Shop payments views">
        <button type="button" role="tab" aria-selected={tab === "payments"} className={tab === "payments" ? "on" : ""} onClick={() => setTab("payments")}>Transactions</button>
        <button type="button" role="tab" aria-selected={tab === "wallets"} className={tab === "wallets" ? "on" : ""} onClick={() => setTab("wallets")}>Shop Wallets</button>
      </div>

      {tab === "payments"
        ? <Payments key={jump.n} initialQ={jump.q} tick={tick} />
        : <Wallets tick={tick} onOpen={openShop} />}
    </>
  );
}