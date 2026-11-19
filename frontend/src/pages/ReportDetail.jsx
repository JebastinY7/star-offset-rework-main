import { useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import Pagination from "../components/Pagination";
import ReportPeriod from "../components/ReportPeriod";
import { REPORTS, downloadReport, fmtDay, money, periodFromParams, periodQuery } from "../lib/reports";
import "./billing.css";
import "./orders.css";
import "./billhistory.css";
import "./reports.css";

const PAGE_SIZE = 15; // matches ReportPagination on the server

const CATEGORY_FILTER = ["category", "All Customers", [["Student", "Students"], ["Customer", "Customers"], ["Shop", "Shops"]]];
const MEMBER_FILTER = ["member_type", "All Users", [["member", "Members"], ["non_member", "Non Members"]]];
const STATUS_LABEL = { paid: "Paid", partial: "Partial", due: "Unpaid" };
const ORDER_LABEL = { pending: "Pending", progress: "In Progress", completed: "Completed", delivered: "Delivered", cancelled: "Cancelled" };
const TYPE_LABEL = { bill: "Bill payment", old_due: "Old due payment", advance: "Order advance", shop_wallet: "Shop wallet payment" };
const TYPE_PILL = { bill: "blue", old_due: "green", advance: "amber", shop_wallet: "blue" };
const AGEING = [["0-7", "0–7 days"], ["8-30", "8–30 days"], ["31-60", "31–60 days"], ["60+", "60+ days"], ["unknown", "Unknown"]];
const AGE_PILL = { "0-7": "green", "8-30": "amber", "31-60": "red", "60+": "red" };

// shops paying through the Shop Portal have no customer profile (id is null) - they link to Shop Payments instead
const who = (c) => (
  <>
    <Link className="rp-name" to={c.id == null ? `/shop-payments?q=${encodeURIComponent(c.name)}` : `/customers/${c.id}`}>{c.name}</Link>
    <span className="od-sub">{c.phone}</span>
  </>
);

// Everything that differs between the five reports lives here:
//   filters  [param, placeholder, [[value, label]...]]   stats  [label, value, tone, hint?, filter?]   columns  [head, cell, numeric?]
const CONFIG = {
  sales: {
    search: "Search bill / customer / phone",
    filters: [CATEGORY_FILTER, MEMBER_FILTER, ["status", "Payment Status", Object.entries(STATUS_LABEL)]],
    stats: (s) => [
      ["Total Sales", money(s.sales), "billed"],
      ["Bills", s.bills, "total"],
      ["Customers", s.customers, "total"],
      ["Discount", money(s.discount), "pending"],
      ["Outstanding", money(s.outstanding), "outstanding", "Unpaid on these bills"],
    ],
    columns: [
      ["Bill No", (r) => <Link className="bh-no" to={`/history/${r.id}`}>{r.bill_no}</Link>],
      ["Date", (r) => <span className="nowrap">{fmtDay(r.date)}</span>],
      ["Customer", (r) => who(r.customer)],
      ["Category", (r) => <span className="pill">{r.customer.category}</span>],
      ["Total", (r) => money(r.gross_total), true],
      ["Discount", (r) => money(r.discount), true],
      ["Final", (r) => <b>{money(r.final_amount)}</b>, true],
      ["Paid", (r) => money(r.paid_amount), true],
      ["Due", (r) => <span className={r.due > 0 ? "bad" : ""}>{money(r.due)}</span>, true],
      ["Status", (r) => <span className={`status ${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>],
    ],
    empty: "No bills match these filters",
  },
  collections: {
    search: "Search reference / customer / phone",
    filters: [
      ["type", "All Types", Object.entries(TYPE_LABEL)],
      ["mode", "All Modes", [["cash", "Cash"], ["upi", "UPI"], ["bank", "Bank"], ["online", "Online (Shop Portal)"]]],
    ],
    stats: (s) => [
      ["Total Received", money(s.total), "received", `${s.count} ${s.count === 1 ? "payment" : "payments"}`],
      ["Cash", money(s.cash), "billed"],
      ["UPI", money(s.upi), "progress"],
      ["Bank", money(s.bank), "total"],
      ["Online", money(s.online), "completed", "Shop Portal wallet payments"],
    ],
    columns: [
      ["Date", (r) => <span className="nowrap">{fmtDay(r.date)}</span>],
      ["Reference", (r) => <Link className="bh-no" to={r.link}>{r.reference}</Link>],
      ["Customer", (r) => who(r.customer)],
      ["Type", (r) => <span className={`pill ${TYPE_PILL[r.type]}`}>{TYPE_LABEL[r.type]}</span>],
      ["Mode", (r) => <span className="pill">{r.mode.toUpperCase() === "UPI" ? "UPI" : r.mode[0].toUpperCase() + r.mode.slice(1)}</span>],
      ["Amount", (r) => <b>{money(r.amount)}</b>, true],
    ],
    empty: "No payments match these filters",
    note: "Includes payments on bills, old dues cleared while billing, advances on orders that are not billed yet, and money shops paid into their Shop Portal wallet.",
  },
  outstanding: {
    search: "Search customer / phone",
    filters: [CATEGORY_FILTER],
    noPeriod: true,
    stats: (s) => [
      ["Total Outstanding", money(s.total_due), "outstanding"],
      ["Customers Owing", s.customers, "total"],
      ["Largest Due", s.largest || "—", "overdue"],
    ],
    columns: [
      ["Customer", (r) => who(r.customer)],
      ["Category", (r) => <span className="pill">{r.customer.category}</span>],
      ["Unpaid Bills", (r) => r.unpaid_bills || "—", true],
      ["Due Since", (r) => <span className="nowrap">{fmtDay(r.since)}</span>],
      ["Age", (r) => (r.age_days == null ? <span className="muted">—</span>
        : <span className={`pill ${AGE_PILL[r.ageing] || ""}`}>{r.age_days === 0 ? "Today" : `${r.age_days} d`}</span>)],
      ["Due Amount", (r) => <b className="bad">{money(r.due_amount)}</b>, true],
      ["Action", (r) => <Link to={`/customers/${r.customer.id}`}><button type="button">View</button></Link>],
    ],
    empty: "No customers with pending dues 🎉",
    note: "Shows everyone who owes money right now, so the date range does not apply. Age counts from the oldest bill that still makes up the due.",
  },
  orders: {
    search: "Search order / customer / work",
    filters: [],
    stats: (s) => [
      ["All Orders", s.orders, "total", `${money(s.value)} value${s.status.cancelled ? ` · ${s.status.cancelled} cancelled` : ""}`, ""],
      ["Pending", s.status.pending, "pending", "", "pending"],
      ["In Progress", s.status.progress, "progress", "", "progress"],
      ["Completed", s.status.completed, "completed", "", "completed"],
      ["Delivered", s.status.delivered, "delivered", "", "delivered"],
      ["Overdue", s.overdue, "overdue", "", "overdue"],
    ],
    statusFilter: true,
    columns: [
      ["Order", (r) => <b className="od-id">{r.order_no}</b>],
      ["Customer", (r) => who(r.customer)],
      ["Work", (r) => r.work_name],
      ["Order Date", (r) => <span className="nowrap">{fmtDay(r.order_date)}</span>],
      ["Delivery", (r) => <span className="nowrap">{fmtDay(r.delivery_date)}{r.overdue && <span className="od-tag red">Overdue</span>}</span>],
      ["Status", (r) => <span className={`status ${r.status}`}>{ORDER_LABEL[r.status] || r.status}</span>],
      ["Total", (r) => money(r.total_amount), true],
      ["Advance", (r) => money(r.advance_paid), true],
      ["Due", (r) => <span className={r.due_amount > 0 ? "bad" : ""}>{money(r.due_amount)}</span>, true],
    ],
    empty: "No orders match these filters",
  },
  shop: {
    search: "Search shop / phone",
    filters: [],
    stats: (s) => [
      ["Wallet Payments Received", money(s.received), "received", `${s.shops} ${s.shops === 1 ? "shop" : "shops"} active in this period`],
      ["Spent on Orders", money(s.spent), "progress", `${s.orders} ${s.orders === 1 ? "order" : "orders"} paid from wallets`],
      ["Pending Payments", money(s.pending), "pending", "Started but not completed"],
      ["Wallet Balance Held", money(s.balance), "total", `${s.shops_with_balance} ${s.shops_with_balance === 1 ? "shop" : "shops"} · all time`],
    ],
    columns: [
      ["Shop", (r, period) => (
        <>
          <Link className="rp-name" to={`/shop-payments?q=${encodeURIComponent(r.shop.name)}&${periodQuery(period)}`}>{r.shop.name}</Link>
          <span className="od-sub">{r.shop.phone}</span>
        </>
      )],
      ["Received", (r) => <b>{money(r.received)}</b>, true],
      ["Orders Paid", (r) => r.orders || "—", true],
      ["Spent on Orders", (r) => money(r.spent), true],
      ["Pending", (r) => (Number(r.pending) > 0 ? money(r.pending) : "—"), true],
      ["Wallet Balance", (r) => <b>{money(r.balance)}</b>, true],
      ["Last Activity", (r) => <span className="nowrap">{fmtDay(r.last_activity)}</span>],
      ["Action", (r, period) => <Link to={`/shop-payments?q=${encodeURIComponent(r.shop.name)}&${periodQuery(period)}`}><button type="button">View</button></Link>],
    ],
    empty: "No shops match your search",
    note: "Received = money shops paid into their wallet through Razorpay. Order payments are spent from that balance, so they are not counted as new income again.",
  },
  customers: {
    search: "Search customer / phone",
    filters: [CATEGORY_FILTER, MEMBER_FILTER],
    stats: (s) => [
      ["Customers Billed", s.customers, "total"],
      ["Total Purchases", money(s.purchases), "billed"],
      ["Avg per Customer", money(s.average), "progress"],
      ["New Customers", s.new_customers, "completed", "Joined in this period"],
      ["Members", s.members, "pending", `${s.expiring_soon} expiring in 30 days`],
      ["Renewals", s.renewals, "received", `${money(s.renewal_amount)} collected`],
    ],
    columns: [
      ["Customer", (r) => who(r.customer)],
      ["Category", (r) => <span className="pill">{r.customer.category}</span>],
      ["Membership", (r) => (r.customer.is_member
        ? <><span className="pill green">Member</span>{r.expiry_date && <span className="od-sub">till {fmtDay(r.expiry_date)}</span>}</>
        : <span className="muted">—</span>)],
      ["Bills", (r) => r.bills, true],
      ["Purchases", (r) => <b>{money(r.purchases)}</b>, true],
      ["Paid", (r) => money(r.paid), true],
      ["Due", (r) => <span className={r.due > 0 ? "bad" : ""}>{money(r.due)}</span>, true],
      ["Last Bill", (r) => <span className="nowrap">{fmtDay(r.last_bill)}</span>],
    ],
    empty: "No customers purchased in this period",
  },
};

function Insights({ s }) {
  const items = [
    ["Top Customer", s.top_customer ? s.top_customer.name : "—", s.top_customer && money(s.top_customer.amount)],
    ["Highest Sales Day", s.highest_day ? fmtDay(s.highest_day.date) : "—", s.highest_day && money(s.highest_day.amount)],
    ["Lowest Sales Day", s.lowest_day ? fmtDay(s.lowest_day.date) : "—", s.lowest_day && money(s.lowest_day.amount)],
    ["Average Bill", money(s.average_bill), null],
  ];
  return (
    <div className="rp-insights">
      {items.map(([label, main, sub]) => (
        <div key={label} className="card"><span className="muted">{label}</span><b>{main}</b>{sub && <small>{sub}</small>}</div>
      ))}
    </div>
  );
}

function PopularJobs({ jobs }) {
  const top = Math.max(1, ...jobs.map((j) => Number(j.revenue)));
  return (
    <section className="card od-register rp-popular">
      <div className="od-reg-head"><h3>Popular print jobs<span className="muted">by sales in this period</span></h3></div>
      <div className="od-table-wrap">
        <table className="od-table rp-table">
          <thead><tr><th>Job</th><th className="num">Quantity</th><th className="num">Bills</th><th className="num">Revenue</th><th style={{ width: "28%" }} /></tr></thead>
          <tbody>
            {jobs.length === 0 && <tr><td colSpan={5} className="od-empty">No print jobs billed in this period</td></tr>}
            {jobs.map((j) => (
              <tr key={j.name}>
                <td><b>{j.name}</b></td>
                <td className="num">{j.qty}</td>
                <td className="num">{j.bills}</td>
                <td className="num"><b>{money(j.revenue)}</b></td>
                <td><div className="rp-bar"><span style={{ width: `${(Number(j.revenue) / top) * 100}%` }} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Detail({ kind }) {
  const cfg = CONFIG[kind];
  const meta = REPORTS[kind];
  const [sp, setSp] = useSearchParams();
  const period = periodFromParams(sp);
  const { from, to } = period;

  const [q, setQ] = useState("");
  const [filters, setFilters] = useState({});   // {category: "Shop", ...}
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [res, setRes] = useState({ key: "", data: null, error: "" });

  const active = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const params = { ...active, ...(q.trim() ? { q: q.trim() } : {}), date_from: from, date_to: to };
  const paramKey = JSON.stringify(params);
  const reqKey = `${paramKey}|${page}|${tick}`;

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api.get(`/reports/${kind}/`, { params: { ...JSON.parse(paramKey), page } })
        .then((r) => { if (live) setRes({ key: reqKey, data: r.data, error: "" }); })
        .catch((e) => {
          if (!live) return;
          // asked for a page that no longer exists after the filters changed
          if (e?.response?.status === 404 && page > 1) setPage(1);
          else setRes({ key: reqKey, data: null, error: errorText(e) });
        });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [kind, paramKey, page, reqKey]);
  const { data, error } = res;
  const loading = res.key !== reqKey;

  const setFilter = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  const clearAll = () => { setQ(""); setFilters({}); setPage(1); };
  const applyPeriod = ({ from: f, to: t }) => { setSp({ date_from: f, date_to: t }); setPage(1); };
  const filtered = Boolean(q || Object.keys(active).length);

  const s = data?.summary;
  const rows = data?.results || [];
  const count = data?.count || 0;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const first = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, count);
  const exportParams = { ...active, ...(q.trim() ? { q: q.trim() } : {}), date_from: from, date_to: to };

  return (
    <>
      <div className="od-head">
        <div>
          <Link className="bd-back" to={cfg.noPeriod ? "/reports" : `/reports?${periodQuery(period)}`}><Icon name="back" size={16} />Reports</Link>
          <h1 className="rp-title">{meta.title}</h1>
          <p className="muted">{meta.blurb}</p>
        </div>
        <div className="row">
          <button type="button" className="bh-btn-ico" onClick={() => downloadReport(kind, "xlsx", exportParams)}><Icon name="sheet" size={16} />Excel</button>
          <button type="button" className="bh-btn-ico" onClick={() => downloadReport(kind, "pdf", exportParams)}><Icon name="download" size={16} />PDF</button>
          <button type="button" className="bh-btn-ico" onClick={() => setTick((t) => t + 1)}><Icon name="refresh" size={16} />Refresh</button>
        </div>
      </div>

      {cfg.noPeriod ? null : <ReportPeriod key={`${from}|${to}`} from={from} to={to} onApply={applyPeriod} />}
      {cfg.note && <p className="rp-note"><Icon name="info" size={15} />{cfg.note}</p>}
      {error && <div className="error">{error}</div>}

      {s && (
        <>
          <div className="od-stats rp-stats">
            {cfg.stats(s).map(([label, value, tone, hint, statusKey]) => {
              const body = <><b>{value}</b><span>{label}</span>{hint && <small>{hint}</small>}</>;
              if (!cfg.statusFilter) return <div key={label} className={`od-stat ${tone} rp-kpi`}>{body}</div>;
              const on = (filters.status || "") === statusKey;
              return (
                <button key={label} type="button" className={`od-stat ${tone} rp-kpi${on ? " on" : ""}`}
                  aria-pressed={on} onClick={() => setFilter("status", statusKey)}>{body}</button>
              );
            })}
          </div>

          {kind === "sales" && <Insights s={s} />}

          {kind === "collections" && (
            <div className="bl-chips rp-chips">
              <button type="button" className={`bl-chip${!filters.type ? " on" : ""}`} onClick={() => setFilter("type", "")}>All · {money(s.total)}</button>
              {Object.entries(TYPE_LABEL).map(([k, label]) => (
                <button key={k} type="button" className={`bl-chip${filters.type === k ? " on" : ""}`} onClick={() => setFilter("type", filters.type === k ? "" : k)}>{label} · {money(s[k])}</button>
              ))}
            </div>
          )}

          {kind === "outstanding" && (
            <div className="bl-chips rp-chips">
              <button type="button" className={`bl-chip${!filters.ageing ? " on" : ""}`} onClick={() => setFilter("ageing", "")}>All ages</button>
              {AGEING.filter(([k]) => k !== "unknown" || Number(s.ageing.unknown) > 0).map(([k, label]) => (
                <button key={k} type="button" className={`bl-chip${filters.ageing === k ? " on" : ""}`} onClick={() => setFilter("ageing", filters.ageing === k ? "" : k)}>{label} · {money(s.ageing[k])}</button>
              ))}
            </div>
          )}

          {kind === "orders" && <PopularJobs jobs={s.popular} />}
        </>
      )}

      <div className="card od-filters">
        <div className="rp-filter-row" style={{ gridTemplateColumns: `minmax(220px, 2fr) ${cfg.filters.length ? `repeat(${cfg.filters.length}, minmax(140px, 1fr)) ` : ""}auto` }}>
          <div className="search-box">
            <Icon name="search" size={16} />
            <input placeholder={cfg.search} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search" />
          </div>
          {cfg.filters.map(([key, placeholder, options]) => (
            <select key={key} value={filters[key] || ""} onChange={(e) => setFilter(key, e.target.value)} aria-label={placeholder}>
              <option value="">{placeholder}</option>
              {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          ))}
          <button type="button" disabled={!filtered} onClick={clearAll}>Clear</button>
        </div>
      </div>

      <div className="card od-register">
        <div className="od-reg-head">
          <h3>{kind === "orders" ? "Orders" : meta.title}<span className="muted">{count} {count === 1 ? "record" : "records"}</span></h3>
        </div>
        <div className="od-table-wrap">
          <table className={`od-table rp-table${loading ? " rp-loading" : ""}`}>
            <thead>
              <tr>{cfg.columns.map(([head, , num]) => <th key={head} className={num ? "num" : ""}>{head}</th>)}</tr>
            </thead>
            <tbody>
              {!data && loading && <tr><td colSpan={cfg.columns.length} className="od-empty">Loading…</td></tr>}
              {data && rows.length === 0 && <tr><td colSpan={cfg.columns.length} className="od-empty">{filtered || kind === "outstanding" ? cfg.empty : "Nothing in this period"}</td></tr>}
              {rows.map((r, i) => (
                <tr key={`${r.id ?? r.reference}-${r.type ?? ""}-${i}`}>
                  {cfg.columns.map(([head, cell, num]) => <td key={head} className={num ? "num" : ""}>{cell(r, period)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="od-foot-row">
          <span className="muted">Showing {first}–{last} of {count}</span>
          {pages > 1 && <Pagination page={page} pages={pages} onChange={setPage} />}
        </div>
      </div>
    </>
  );
}

export default function ReportDetail() {
  const { kind } = useParams();
  if (!CONFIG[kind]) return <Navigate to="/reports" replace />;
  return <Detail key={kind} kind={kind} />; // fresh filters / page for every report
}