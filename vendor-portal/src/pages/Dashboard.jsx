import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";
import StatusChip, { fmtDate } from "../components/StatusChip";

const SLICES = [
  { key: "new", label: "New", color: "var(--amber)" },
  { key: "active", label: "In Progress", color: "var(--blue)" },
  { key: "ready", label: "Ready for Pickup", color: "var(--green)" },
  { key: "completed", label: "Completed", color: "#94a3b8" },
  { key: "overdue", label: "Overdue", color: "var(--red)" },
];

const QUICK = [
  { to: "/assigned", icon: "file", label: "View All Assignments" },
  { to: "/in-progress", icon: "play", label: "Update In Progress Work" },
  { to: "/ready", icon: "box", label: "Mark Ready for Pickup" },
  { to: "/profile", icon: "user", label: "View Profile" },
];

const stamp = (d) => ({
  day: d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" }),
  time: d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase(),
});

// 5-colour ring; each job is in exactly one slice (the API already splits overdue out)
function Donut({ donut, total }) {
  const R = 62, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg className="donut" viewBox="0 0 160 160" role="img" aria-label={`${total} works in total`}>
      <circle cx="80" cy="80" r={R} fill="none" stroke="#e6ebf2" strokeWidth="22" />
      {total > 0 && SLICES.map((s) => {
        const len = ((donut?.[s.key] ?? 0) / total) * C;
        if (len <= 0) return null;
        const el = <circle key={s.key} cx="80" cy="80" r={R} fill="none" stroke={s.color} strokeWidth="22"
          strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)" />;
        offset += len;
        return el;
      })}
      <text x="80" y="82" textAnchor="middle" className="donut-n">{total}</text>
      <text x="80" y="100" textAnchor="middle" className="donut-l">Total Works</text>
    </svg>
  );
}

export default function Dashboard() {
  const { vendor } = useAuth();
  const { data, error, reload } = useOutletContext();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  const s = data?.stats;
  const n = (k) => s?.[k] ?? 0;
  const val = (x) => (s ? x : "—");
  const recent = data?.recent || [];
  const upcoming = data?.upcoming || [];
  const perf = data?.performance;
  const total = s?.work_total ?? 0;
  const when = stamp(now);

  const CARDS = [
    { cls: "new", icon: "file", value: n("new"), label: "New Assignments", hint: "Need your action", to: "/assigned" },
    { cls: "active", icon: "gear", value: n("active"), label: "In Progress", hint: "Currently working", to: "/in-progress" },
    { cls: "ready", icon: "box", value: n("ready"), label: "Ready for Pickup", hint: "Completed from your side", to: "/ready" },
    { cls: "late", icon: "alert", value: n("overdue"), label: "Overdue", hint: "Past expected date", to: "/assigned" },
  ];

  const PERF = [
    { cls: "p-done", icon: "checklist", value: val(perf?.completed_month ?? 0), label: "Works Completed",
      sub: perf?.change_pct != null && <span className={perf.change_pct >= 0 ? "up" : "down"}>{perf.change_pct >= 0 ? "↑ +" : "↓ "}{perf.change_pct}%</span> },
    { cls: "p-time", icon: "clock", value: val(perf?.on_time ?? 0), label: "On Time",
      sub: perf?.on_time_pct != null && <span>{perf.on_time_pct}%</span> },
    { cls: "p-pick", icon: "box", value: val(perf?.pending_pickup ?? 0), label: "Pending Pickup" },
    { cls: "p-rate", icon: "percent", value: perf?.completion_rate != null ? `${perf.completion_rate}%` : "—", label: "Completion Rate" },
  ];

  return (
    <div className="vd">
      <div className="vd-head">
        <div>
          <h1>Welcome, {vendor.owner_name || vendor.name} !</h1>
          <p>Here&rsquo;s your work summary and latest updates.</p>
        </div>
        <div className="vd-date"><span>{when.day}</span><span>{when.time}</span></div>
      </div>

      {error && (
        <div className="alert error">
          <span>{error}</span>
          <button type="button" onClick={reload}><Icon name="refresh" size={14} /> Retry</button>
        </div>
      )}

      {/* ---------- 4 count cards ---------- */}
      <section className="vd-cards" aria-label="Job overview">
        {CARDS.map((c) => (
          <Link to={c.to} className={`vd-card-stat ${c.cls}`} key={c.cls}>
            <span className="cs-ico"><Icon name={c.icon} size={26} /></span>
            <span className="cs-text"><b>{val(c.value)}</b><strong>{c.label}</strong><small>{c.hint}</small></span>
            <Icon name="chevright" size={16} className="cs-go" />
          </Link>
        ))}
      </section>

      {/* ---------- recent assignments + upcoming deadlines ---------- */}
      <div className="vd-cols">
        <section className="vd-card">
          <div className="vd-card-head"><h2>Recent Assignments</h2><Link to="/assigned" className="btn-line">View All</Link></div>

          {!data && !error && <div className="vd-skel" aria-label="Loading jobs">{[0, 1, 2, 3].map((i) => <span key={i} />)}</div>}

          {data && recent.length === 0 && (
            <div className="vd-empty">
              <span className="vd-empty-ico"><Icon name="receipt" size={26} /></span>
              <b>No jobs yet</b>
              <p>When Star Offset gives you printing work, it will show up here.</p>
            </div>
          )}

          {recent.length > 0 && (
            <div className="vd-table-wrap">
              <table className="vd-table">
                <thead><tr><th>Order No.</th><th>Work Type</th><th>Quantity</th><th>Due Date</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                  {recent.map((j) => (
                    <tr key={j.id}>
                      <td>{j.order_no}</td>
                      <td>{j.items_text || "Printing items"}</td>
                      <td>{Number(j.qty).toLocaleString("en-IN")} pcs</td>
                      <td>{fmtDate(j.due_date)}</td>
                      <td><StatusChip status={j.status} label={j.status_label} overdue={j.is_overdue} /></td>
                      <td><Link to={`/assigned/${j.id}`} className="btn-dark">View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="vd-card">
          <div className="vd-card-head"><h2>Upcoming Deadlines</h2><Link to="/assigned" className="btn-line">View All</Link></div>
          {data && upcoming.length === 0 && <p className="vd-none">No upcoming deadlines.</p>}
          <ul className="vd-deadlines">
            {upcoming.map((j) => {
              const d = new Date(`${j.due_date}T00:00:00`);
              return (
                <li key={j.id}>
                  <Link to={`/assigned/${j.id}`}>
                    <span className="dl-date"><small>{d.toLocaleDateString("en-IN", { month: "short" })}</small><b>{d.getDate()}</b></span>
                    <span className="dl-text"><b>{j.order_no}</b><small>{Number(j.qty).toLocaleString("en-IN")} pcs - {j.items_text}</small></span>
                    <Icon name="chevright" size={16} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* ---------- status ring, performance, quick actions ---------- */}
      <div className="vd-trio">
        <section className="vd-card">
          <div className="vd-card-head"><h2>Work Status Overview</h2></div>
          <div className="vd-status">
            <Donut donut={data?.donut} total={total} />
            <ul className="vd-legend">
              {SLICES.map((x) => <li key={x.key}><i style={{ background: x.color }} /><span>{x.label}</span><b>{val(data?.donut?.[x.key] ?? 0)}</b></li>)}
            </ul>
          </div>
        </section>

        <section className="vd-card">
          <div className="vd-card-head"><h2>Your Performance <small>(This Month)</small></h2></div>
          <div className="vd-perf">
            {PERF.map((p) => (
              <div className={`perf ${p.cls}`} key={p.label}>
                <span className="perf-ico"><Icon name={p.icon} size={24} /></span>
                <span><b>{p.value}</b><strong>{p.label}</strong>{p.sub && <em>{p.sub}</em>}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="vd-card">
          <div className="vd-card-head"><h2>Quick Actions</h2></div>
          <ul className="vd-quick">
            {QUICK.map((q) => (
              <li key={q.label}>
                <Link to={q.to}><span className="q-ico"><Icon name={q.icon} size={20} /></span><span>{q.label}</span><Icon name="chevright" size={15} /></Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
