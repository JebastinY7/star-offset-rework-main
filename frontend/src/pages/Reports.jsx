import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import ReportPeriod from "../components/ReportPeriod";
import { REPORTS, compactMoney, downloadReport, fmtDay, money, periodFromParams, periodQuery } from "../lib/reports";
import "./orders.css";
import "./billhistory.css";
import "./reports.css";

const SERIES = {
  sales: { label: "Sales", color: "#c49b2c" },
  collected: { label: "Collections", color: "#16a34a" },
};
const VIEWS = [["sales", "Sales"], ["collected", "Collections"], ["both", "Both"]];
const CAT_COLORS = ["#c49b2c", "#2563eb", "#16a34a", "#7c3aed", "#f59e0b", "#9ca3af"];
const TYPE_PILL = { Bill: "blue", Payment: "green", Advance: "amber", Membership: "", "Shop Payment": "green" };

// order of the six cards on the page; the audit log is the existing Settings > Activity Log screen
const CARDS = [
  ["sales", "/reports/sales"],
  ["collections", "/reports/collections"],
  ["outstanding", "/reports/outstanding"],
  ["pnl", "/reports/pnl"],
  ["orders", "/reports/orders"],
  ["customers", "/reports/customers"],
  ["shop", "/reports/shop"],
  ["audit", "/settings?tab=activity"],
];
const AUDIT = { title: "Audit Log", blurb: "Staff activity and record changes", icon: "history", tone: "slate" };

// round the top of the y axis up to a "nice" number so the grid lines are readable
function niceMax(max) {
  if (max <= 0) return 100;
  const exp = 10 ** Math.floor(Math.log10(max));
  const f = max / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

function SalesChart({ points, view }) {
  const [hover, setHover] = useState(null);
  const W = 720, H = 280, L = 56, R = 18, T = 16, B = 34;
  const keys = view === "both" ? ["sales", "collected"] : [view];
  const n = points.length;
  const yMax = niceMax(Math.max(0, ...points.flatMap((p) => keys.map((k) => Number(p[k])))));
  const x = (i) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (1 - Number(v) / yMax) * (H - T - B);
  const line = (k) => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(" ");
  const empty = points.every((p) => keys.every((k) => Number(p[k]) === 0));
  const step = Math.max(1, Math.ceil(n / 8));

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = n === 1 ? 0 : Math.round(((px - L) / (W - L - R)) * (n - 1));
    setHover(Math.min(Math.max(i, 0), n - 1));
  };

  return (
    <div className="rp-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sales and collections over the selected period"
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map((t) => {
          const v = (yMax / 4) * t;
          return (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="rp-grid" />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" className="rp-axis">{compactMoney(v)}</text>
            </g>
          );
        })}
        {points.map((p, i) => i % step === 0 && (
          <text key={p.date} x={x(i)} y={H - 10} textAnchor="middle" className="rp-axis">{p.label}</text>
        ))}
        {keys.length === 1 && n > 1 && (
          <path d={`${line(keys[0])} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill={SERIES[keys[0]].color} opacity="0.12" />
        )}
        {keys.map((k) => (
          <g key={k}>
            {n > 1 && <path d={line(k)} fill="none" stroke={SERIES[k].color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
            {points.map((p, i) => (n <= 31 || i === hover) && (
              <circle key={p.date} cx={x(i)} cy={y(p[k])} r={i === hover ? 5 : 3} fill="#fff" stroke={SERIES[k].color} strokeWidth="2" />
            ))}
          </g>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="rp-guide" />}
        {empty && <text x={W / 2} y={H / 2} textAnchor="middle" className="rp-empty-text">No data in this period</text>}
      </svg>
      {hover != null && (
        <div className="rp-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{points[hover].label}</b>
          {keys.map((k) => (
            <span key={k}><i style={{ background: SERIES[k].color }} />{SERIES[k].label}: {money(points[hover][k])}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportMenu({ params }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  return (
    <div className="rp-menu-wrap" ref={ref}>
      <button type="button" className="bh-btn-ico" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="download" size={16} />Export Report<Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="rp-menu" role="menu">
          {Object.entries(REPORTS).map(([kind, r]) => (
            <div key={kind} className="rp-menu-row" role="none">
              <span>{r.title}</span>
              <span className="rp-menu-btns">
                <button type="button" role="menuitem" onClick={() => { downloadReport(kind, "xlsx", params); setOpen(false); }}>Excel</button>
                <button type="button" role="menuitem" onClick={() => { downloadReport(kind, "pdf", params); setOpen(false); }}>PDF</button>
              </span>
            </div>
          ))}
          <div className="rp-menu-note">Uses the report period selected on this page.</div>
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const [sp, setSp] = useSearchParams();
  const period = periodFromParams(sp);
  const { from, to } = period;
  const [view, setView] = useState("both");
  const [tick, setTick] = useState(0);
  const [res, setRes] = useState({ key: "", data: null, error: "" });
  const reqKey = `${from}|${to}|${tick}`;

  useEffect(() => {
    let live = true;
    api.get("/reports/overview/", { params: { date_from: from, date_to: to } })
      .then((r) => { if (live) setRes({ key: reqKey, data: r.data, error: "" }); })
      .catch((e) => { if (live) setRes({ key: reqKey, data: null, error: errorText(e) }); });
    return () => { live = false; };
  }, [from, to, reqKey]);
  const { data, error } = res;
  const stale = res.key !== reqKey; // a newer period is still loading - keep showing the old numbers, dimmed

  const apply = useCallback(({ from: f, to: t }) => setSp({ date_from: f, date_to: t }), [setSp]);
  const query = periodQuery(period);
  const s = data?.summary;

  const stats = s && [
    ["Total Sales", money(s.sales), "billed", ""],
    ["Collected", money(s.collected), "received",
      s.collected_parts.old_dues > 0 || s.collected_parts.advances > 0 || s.collected_parts.shop_wallet > 0
        ? `Bills ${money(s.collected_parts.bills)}${s.collected_parts.old_dues > 0 ? ` · old dues ${money(s.collected_parts.old_dues)}` : ""}${s.collected_parts.advances > 0 ? ` · advances ${money(s.collected_parts.advances)}` : ""}${s.collected_parts.shop_wallet > 0 ? ` · shop wallets ${money(s.collected_parts.shop_wallet)}` : ""}`
        : ""],
    ["Outstanding", money(s.outstanding), "outstanding", "Unpaid on bills in this period"],
    ["Bills Created", s.bills, "total", `${s.customers} ${s.customers === 1 ? "customer" : "customers"}${s.discount > 0 ? ` · ${money(s.discount)} discount` : ""}`],
  ];

  return (
    <>
      <div className="od-head">
        <div>
          <h1>Reports</h1>
          <p className="muted">View sales, collections, outstanding dues and business performance.</p>
        </div>
        <div className="row">
          <ExportMenu params={{ date_from: from, date_to: to }} />
          <button type="button" className="bh-btn-ico" onClick={() => setTick((t) => t + 1)}><Icon name="refresh" size={16} />Refresh</button>
        </div>
      </div>

      <ReportPeriod key={`${from}|${to}`} from={from} to={to} onApply={apply} />

      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <div className={stale ? "rp-loading" : ""}>
          <div className="od-stats rp-kpis">
            {stats.map(([label, value, tone, hint]) => (
              <div key={label} className={`od-stat ${tone} rp-kpi`}>
                <b>{value}</b><span>{label}</span>
                {hint && <small>{hint}</small>}
              </div>
            ))}
          </div>

          <div className="rp-grid2">
            <section className="card rp-panel">
              <div className="rp-panel-head">
                <h3>Sales Overview</h3>
                <div className="rp-seg" role="group" aria-label="Chart data">
                  {VIEWS.map(([k, label]) => (
                    <button key={k} type="button" className={view === k ? "on" : ""} aria-pressed={view === k} onClick={() => setView(k)}>{label}</button>
                  ))}
                </div>
              </div>
              <SalesChart points={data.chart.points} view={view} />
              <div className="rp-legend">
                {(view === "both" ? ["sales", "collected"] : [view]).map((k) => (
                  <span key={k}><i style={{ background: SERIES[k].color }} />{SERIES[k].label}</span>
                ))}
                <span className="muted">{data.chart.mode === "month" ? "Per month" : "Per day"}</span>
              </div>
            </section>

            <section className="card rp-panel">
              <div className="rp-panel-head"><h3>Sales by Category</h3></div>
              {data.by_category.length === 0 && <p className="muted">No sales in this period.</p>}
              <ul className="rp-cats">
                {data.by_category.map((c, i) => (
                  <li key={c.name} title={`${c.name}: ${money(c.amount)}`}>
                    <div className="rp-cat-top">
                      <span><i style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />{c.name}</span>
                      <b>{c.percent}%</b>
                    </div>
                    <div className="rp-bar"><span style={{ width: `${c.percent}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} /></div>
                    <small className="muted">{money(c.amount)}</small>
                  </li>
                ))}
              </ul>
              <Link className="rp-link" to={`/reports/sales?${query}`}>View Details →</Link>
            </section>
          </div>

          <h2 className="rp-h2">Report Categories</h2>
          <div className="rp-cards">
            {CARDS.map(([kind, to_]) => {
              const r = kind === "audit" ? AUDIT : REPORTS[kind];
              const link = kind === "audit" ? to_ : `${to_}?${query}`;
              return (
                <Link key={kind} to={link} className={`card rp-card ${r.tone}`}>
                  <span className="rp-card-icon"><Icon name={r.icon} size={22} /></span>
                  <div>
                    <b>{r.title}</b>
                    <p>{r.blurb}</p>
                    <span className="rp-link">{kind === "audit" ? "View Log →" : kind === "pnl" ? "View P&L →" : "View Report →"}</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <section className="card od-register rp-recent">
            <div className="od-reg-head">
              <h3>Recent Transactions</h3>
              <Link className="rp-link" to={`/reports/sales?${query}`}>View All →</Link>
            </div>
            <div className="od-table-wrap">
              <table className="od-table rp-table">
                <thead>
                  <tr><th>Date</th><th>Reference</th><th>Customer</th><th>Type</th><th className="num">Amount</th><th style={{ textAlign: "right" }}>Action</th></tr>
                </thead>
                <tbody>
                  {data.recent.length === 0 && <tr><td colSpan={6} className="od-empty">No transactions in this period</td></tr>}
                  {data.recent.map((t, i) => (
                    <tr key={`${t.type}-${t.reference}-${i}`}>
                      <td className="nowrap">{fmtDay(t.date)}</td>
                      <td><b>{t.reference}</b></td>
                      <td>{t.customer}</td>
                      <td><span className={`pill ${TYPE_PILL[t.type] || ""}`}>{t.type}</span></td>
                      <td className="num"><b>{money(t.amount)}</b></td>
                      <td style={{ textAlign: "right" }}><Link to={t.link}><button type="button">View</button></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </>
  );
}