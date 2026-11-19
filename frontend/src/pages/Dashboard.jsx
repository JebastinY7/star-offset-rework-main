import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";

const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

const ORDER_ROWS = [
  ["pending", "Pending"],
  ["progress", "In Progress"],
  ["completed", "Completed"],
  ["delivered", "Delivered"],
  ["overdue", "Overdue"],
];

const KIND_ICON = { bill: "billing", quotation: "quote", order: "cart", customer: "users" };

function greeting(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// "10:32 AM" for today, "05 Oct, 10:32 AM" for older events
function when(iso) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}, ${time}`;
}

function Stat({ label, value, icon, tone }) {
  return (
    <div className={`dash-stat ${tone}`}>
      <span className="dash-stat-icon"><Icon name={icon} size={22} /></span>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function Card({ title, to, linkText = "View All →", tone, children }) {
  return (
    <section className={`card dash-card ${tone || ""}`}>
      <div className="dash-card-head">
        <h3>{title}</h3>
        {to && <Link to={to}>{linkText}</Link>}
      </div>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [hour] = useState(() => new Date().getHours());

  useEffect(() => {
    api.get("/dashboard/").then((r) => setD(r.data)).catch(() => setError("Could not load the dashboard."));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!d) return <p className="muted">Loading…</p>;

  const days = (n) => (n === 0 ? "Today" : n === 1 ? "1 day" : `${n} days`);

  return (
    <div className="dash">
      <div className="dash-hello">
        <h1>{greeting(hour)}, {user.username} 👋</h1>
        <p className="muted">Here's what's happening with Star Offset today.</p>
      </div>

      <div className="dash-stats">
        <Stat label="Today's Sales" value={money(d.today.sales)} icon="chart" tone="gold" />
        <Stat label="Today's Bills" value={d.today.bill_count} icon="billing" tone="blue" />
        <Stat label="Today's Discount" value={money(d.today.discount)} icon="tag" tone="purple" />
        <Stat label="Outstanding Collected" value={money(d.today.collected)} icon="card" tone="green" />
      </div>

      <Card title="Customers with Due" to="/customers" tone="due">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Customer</th><th>Type</th><th>Due Amount</th><th>Last Bill</th><th>Action</th></tr>
            </thead>
            <tbody>
              {d.recent_due_customers.length === 0 && <tr><td colSpan="5" className="muted">No pending dues 🎉</td></tr>}
              {d.recent_due_customers.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong><div className="muted">{c.phone}</div></td>
                  <td><span className="pill">{c.category}</span></td>
                  <td className="bad">{money(c.due_amount)}</td>
                  <td>{c.last_bill_no || "—"}</td>
                  <td>
                    {c.last_bill_id
                      ? <Link to={`/invoice/${c.last_bill_id}`}><button>View</button></Link>
                      : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="dash-grid">
        <Card title="Order Status" to="/orders" linkText="Open Orders →" tone="orders">
          <ul className="dash-list">
            {ORDER_ROWS.map(([key, label]) => (
              <li key={key}>
                <span className="row"><span className={`dash-dot ${key}`} />{label}</span>
                <strong className={key === "overdue" && d.orders[key] > 0 ? "bad" : ""}>{d.orders[key]}</strong>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Membership Expiring Soon" to="/customers" tone="member">
          <ul className="dash-list">
            {d.expiring_customers.length === 0 && <li className="muted">No memberships expiring in the next 5 days</li>}
            {d.expiring_customers.map((c) => (
              <li key={c.id}>
                <span>{c.name}<span className="muted"> · {c.phone}</span></span>
                <span className={`pill ${c.days_left <= 1 ? "red" : "amber"}`}>{days(c.days_left)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="dash-grid">
        <Card title="Recent Bills" to="/history" tone="bills">
          <ul className="dash-list">
            {d.recent_bills.length === 0 && <li className="muted">No bills yet</li>}
            {d.recent_bills.map((b) => (
              <li key={b.id}>
                <Link to={`/invoice/${b.id}`} className="dash-link"><strong>{b.bill_no}</strong> <span>{b.customer}</span></Link>
                <strong>{money(b.final_amount)}</strong>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Recent Quotations" to="/quotations" tone="quotes">
          <ul className="dash-list">
            {d.recent_quotations.length === 0 && <li className="muted">No quotations yet</li>}
            {d.recent_quotations.map((q) => (
              <li key={q.id}>
                <Link to={`/quotations/${q.id}/bill`} className="dash-link"><strong>{q.quotation_no}</strong> <span>{q.customer}</span></Link>
                <strong>{money(q.total_amount)}</strong>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Recent Activity" tone="activity">
        <ul className="dash-activity">
          {d.activity.length === 0 && <li className="muted">Nothing yet</li>}
          {d.activity.map((a, i) => (
            <li key={i}>
              <span className={`act-icon ${a.kind}`}><Icon name={KIND_ICON[a.kind]} size={15} /></span>
              <span className="grow">{a.text}</span>
              <span className="muted">{when(a.at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}