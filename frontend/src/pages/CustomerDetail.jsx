import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import api, { errorText } from "../api";
import CustomerForm from "../components/CustomerForm";
import Icon from "../components/Icon";
import StatCard from "../components/StatCard";
import {
  MEMBERSHIP_LABEL, MEMBERSHIP_PILL, fmtDate, fmtDateTime, initials, money,
} from "../components/customerUtils";

const TABS = [["overview", "Overview"], ["billing", "Billing"], ["payments", "Payments"], ["membership", "Membership"], ["activity", "Activity"]];
const STATUS_PILL = { paid: "green", partial: "amber", due: "red" };
const ORDER_PILL = { pending: "amber", progress: "blue", completed: "green", delivered: "", cancelled: "red" };
const ORDER_LABEL = { pending: "Pending", progress: "In Progress", completed: "Completed", delivered: "Delivered", cancelled: "Cancelled" };
const KIND_ICON = { bill: "billing", order: "cart", membership: "card", points: "gift", customer: "users" };

function Empty({ children }) { return <p className="muted" style={{ margin: "8px 0" }}>{children}</p>; }

function BillsTable({ bills }) {
  if (bills.length === 0) return <Empty>No bills yet</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Bill No</th><th>Date</th><th>Amount</th><th>Paid</th><th>Due</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.id}>
              <td><strong>{b.bill_no}</strong></td>
              <td>{fmtDate(b.bill_date)}</td>
              <td>{money(b.final_amount)}</td>
              <td>{money(b.paid_amount)}</td>
              <td className={Number(b.due_amount) > 0 ? "bad" : ""}>{money(b.due_amount)}</td>
              <td><span className={`pill ${STATUS_PILL[b.payment_status] || ""}`}>{b.payment_status}</span></td>
              <td><Link to={`/invoice/${b.id}`}><button>View</button></Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Overview({ data, setTab }) {
  const { orders, bills, customer, totals } = data;
  return (
    <>
      <div className="dash-grid">
        <section className="card dash-card orders">
          <div className="dash-card-head"><h3>Order Summary</h3><Link to="/orders">Open Orders →</Link></div>
          <ul className="dash-list">
            {Object.entries(orders.counts).map(([k, n]) => (
              <li key={k}><span className="row"><span className={`dash-dot ${k === "cancelled" ? "overdue" : k}`} />{ORDER_LABEL[k]}</span><strong>{n}</strong></li>
            ))}
          </ul>
        </section>

        <section className="card dash-card bills">
          <div className="dash-card-head"><h3>Customer Details</h3></div>
          <div className="kv-grid">
            <div><span>Customer ID</span><strong>{customer.Customer_code || "—"}</strong></div>
            <div><span>Phone</span><strong>{customer.phone}</strong></div>
            <div><span>Customer since</span><strong>{fmtDate(customer.created_at)}</strong></div>
            <div><span>Total bills</span><strong>{totals.bill_count}</strong></div>
            <div><span>Last bill</span><strong>{bills[0] ? `${bills[0].bill_no} · ${fmtDate(bills[0].bill_date)}` : "—"}</strong></div>
          </div>
        </section>
      </div>

      <section className="card dash-card quotes">
        <div className="dash-card-head"><h3>Recent Bills</h3><button className="link-btn" onClick={() => setTab("billing")}>View All →</button></div>
        <BillsTable bills={bills.slice(0, 5)} />
      </section>

      <section className="card dash-card member">
        <div className="dash-card-head"><h3>Recent Orders</h3><Link to="/orders">View All →</Link></div>
        {orders.recent.length === 0 ? <Empty>No orders yet</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Work</th><th>Delivery</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {orders.recent.map((o) => (
                  <tr key={o.id}>
                    <td><strong>{o.work_name}</strong></td><td>{fmtDate(o.delivery_date)}</td><td>{money(o.total_amount)}</td>
                    <td><span className={`pill ${ORDER_PILL[o.status] || ""}`}>{ORDER_LABEL[o.status] || o.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Payments({ bills }) {
  const paid = bills.filter((b) => Number(b.paid_amount) > 0 || Number(b.old_due_paid) > 0);
  if (paid.length === 0) return <Empty>No payments recorded yet</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Bill No</th><th>Paid on bill</th><th>Old due cleared</th><th>Total received</th></tr></thead>
        <tbody>
          {paid.map((b) => (
            <tr key={b.id}>
              <td>{fmtDate(b.bill_date)}</td><td><strong>{b.bill_no}</strong></td>
              <td>{money(b.paid_amount)}</td><td>{money(b.old_due_paid)}</td>
              <td className="ok">{money(Number(b.paid_amount) + Number(b.old_due_paid))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Membership({ data }) {
  const c = data.customer;
  const state = c.membership_status;
  const dl = c.days_left;
  const note = state === "none" ? "" : dl === null ? "No expiry date" : dl < 0 ? `Expired ${-dl} day${-dl === 1 ? "" : "s"} ago` : dl === 0 ? "Expires today" : `${dl} day${dl === 1 ? "" : "s"} left`;
  return (
    <>
      <div className="kv-grid">
        <div><span>Status</span><span className={`pill ${MEMBERSHIP_PILL[state]}`} style={{ alignSelf: "flex-start" }}>{MEMBERSHIP_LABEL[state]}</span></div>
        <div><span>Membership ID</span><strong>{c.member_id || "—"}</strong></div>
        <div><span>Joined</span><strong>{fmtDate(c.join_date)}</strong></div>
        <div><span>Expiry</span><strong>{fmtDate(c.expiry_date)}</strong>{note && <small className="muted">{note}</small>}</div>
        <div><span>Points balance</span><strong>{c.points}</strong></div>
      </div>

      <div className="section-label" style={{ marginTop: 18 }}>Renewal history</div>
      {data.renewals.length === 0 ? <Empty>No membership payments yet</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Method</th><th>Amount</th><th>From</th><th>To</th></tr></thead>
            <tbody>
              {data.renewals.map((m) => (
                <tr key={m.id}><td style={{ textTransform: "capitalize" }}>{m.type}</td><td style={{ textTransform: "uppercase" }}>{m.payment_method}</td>
                  <td>{money(m.amount)}</td><td>{fmtDate(m.start_date)}</td><td>{fmtDate(m.end_date)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-label" style={{ marginTop: 18 }}>Points history</div>
      {data.points.length === 0 ? <Empty>No points activity yet</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Points</th><th>Bill</th></tr></thead>
            <tbody>
              {data.points.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDateTime(t.date)}</td>
                  <td><span className={`pill ${t.type === "earn" ? "green" : "amber"}`}>{t.type === "earn" ? "Earned" : "Redeemed"}</span></td>
                  <td>{t.type === "earn" ? `+${t.points_added}` : `-${t.points_used}`}</td>
                  <td>{t.bill_no || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Activity({ items }) {
  if (items.length === 0) return <Empty>No activity yet</Empty>;
  return (
    <ul className="dash-activity">
      {items.map((a, i) => (
        <li key={i}>
          <span className={`act-icon ${a.kind}`}><Icon name={KIND_ICON[a.kind] || "history"} size={15} /></span>
          <span className="grow">{a.text}</span>
          <span className="muted">{fmtDateTime(a.at)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function CustomerDetail() {
  const { id } = useParams();
  const { state: navState } = useLocation(); // { from: "?page=2&due=due" } sent by the list
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    api.get(`/customers/${id}/profile/`)
      .then((r) => { setData(r.data); setError(""); })
      .catch((e) => setError(e.response?.status === 404 ? "Customer not found." : errorText(e)));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const back = <Link to={`/customers${navState?.from || ""}`} className="back-link">← Back to Customers</Link>;
  if (error) return <div className="dash">{back}<div className="error">{error}</div></div>;
  if (!data) return <p className="muted">Loading…</p>;

  const { customer: c, totals } = data;
  const state = c.membership_status;

  return (
    <div className="dash">
      <div className="row between wrap">
        {back}
        <button className="primary" onClick={() => setEditing(true)}>Edit Customer</button>
      </div>

      <div>
        <div className="section-label">Customer profile</div>
        <section className="card dash-card bills cust-profile">
          <div className="avatar-lg">{initials(c.name)}</div>
          <div className="cust-profile-main">
            <div className="row between wrap">
              <h2 style={{ margin: 0 }}>{c.name}</h2>
              <span className="pill">{c.category}</span>
            </div>
            <div className="cust-info">
              <span><span className="muted">Customer ID:</span> <strong>{c.Customer_code}</strong></span>
              <span><span className="muted">Phone:</span> <strong>{c.phone}</strong></span>
              <span><span className="muted">Membership:</span> <span className={`pill ${MEMBERSHIP_PILL[state]}`}>{MEMBERSHIP_LABEL[state]}</span></span>
              <span><span className="muted">Customer since:</span> <strong>{fmtDate(c.created_at)}</strong></span>
            </div>
          </div>
        </section>
      </div>

      <div className="dash-stats">
        <StatCard label="Outstanding" value={money(totals.outstanding)} icon="billing" tone="red" />
        <StatCard label="Total Billed" value={money(totals.billed)} icon="chart" tone="gold" />
        <StatCard label="Total Paid" value={money(totals.paid)} icon="card" tone="green" />
        <StatCard label="Points" value={totals.points} icon="gift" tone="purple" />
      </div>

      <div className="cust-tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === "overview" && <Overview data={data} setTab={setTab} />}
      {tab === "billing" && <section className="card dash-card quotes"><BillsTable bills={data.bills} /></section>}
      {tab === "payments" && <section className="card dash-card activity"><Payments bills={data.bills} /></section>}
      {tab === "membership" && <section className="card dash-card member"><Membership data={data} /></section>}
      {tab === "activity" && <section className="card dash-card orders"><Activity items={data.activity} /></section>}

      {editing && (
        <CustomerForm initial={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      )}
    </div>
  );
}