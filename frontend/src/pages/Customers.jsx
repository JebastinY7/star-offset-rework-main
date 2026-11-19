import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import CustomerForm from "../components/CustomerForm";
import Icon from "../components/Icon";
import Pagination from "../components/Pagination";
import StatCard from "../components/StatCard";
import "./billhistory.css"; // icon buttons (.bh-ico) with tooltips
import "./customers.css";
import { CATEGORIES, MEMBERSHIP_LABEL, MEMBERSHIP_PILL, fmtDate, membershipOf, money, todayStr } from "../components/customerUtils";

const PAGE_SIZE = 8; // matches CustomerPagination on the server

export default function Customers() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState(null);
  // page + filters live in the URL (?page=2&due=due ...), so View / Edit / browser Back
  // always return to exactly the same page and filters.
  const [sp, setSp] = useSearchParams();
  const location = useLocation();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const search = sp.get("search") || "";
  const category = sp.get("category") || "All";
  const membership = sp.get("membership") || "";
  const due = sp.get("due") || "";
  const [editing, setEditing] = useState(null); // null = closed, {} = new, {...} = edit
  const [msg, setMsg] = useState("");
  const [today] = useState(todayStr);

  const load = useCallback(() => {
    api.get("/customers/", { params: { page, search, category, membership, due } })
      .then((r) => { setRows(r.data.results); setCount(r.data.count); setMsg(""); })
      .catch((e) => {
        // e.g. the last customer on the last page was deleted -> step back one page
        if (e.response?.status === 404 && page > 1) {
          setSp((prev) => {
            const n = new URLSearchParams(prev);
            if (page - 1 > 1) n.set("page", String(page - 1)); else n.delete("page");
            return n;
          }, { replace: true });
        } else setMsg(errorText(e));
      });
  }, [page, search, category, membership, due, setSp]);

  const loadSummary = useCallback(() => {
    api.get("/customers/summary/").then((r) => setSummary(r.data)).catch(() => {});
  }, []);

  // debounce typing in the search box
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const remove = async (c) => {
    if (!confirm(`Delete ${c.name}?`)) return;
    try { await api.delete(`/customers/${c.id}/`); load(); loadSummary(); }
    catch (e) { setMsg(errorText(e)); }
  };

  const patch = (changes) => {
    const n = new URLSearchParams(sp);
    Object.entries(changes).forEach(([k, v]) => (v && v !== "All" ? n.set(k, v) : n.delete(k)));
    setSp(n, { replace: true });
  };
  const filter = (key) => (e) => patch({ [key]: e.target.value, page: "" }); // changing a filter -> back to page 1
  const goPage = (p) => patch({ page: p > 1 ? String(p) : "" });
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const from = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, count);

  return (
    <div className="dash cust-page">
      <div className="row between wrap">
        <div>
          <h1 style={{ marginBottom: 2 }}>Customers</h1>
          <p className="muted" style={{ margin: 0 }}>Manage customers, shops and memberships</p>
        </div>
        <button className="primary" onClick={() => setEditing({})}>+ Add Customer</button>
      </div>

      <div className="dash-stats">
        <StatCard label="Total Customers" value={summary ? summary.total : "–"} icon="users" tone="blue" />
        <StatCard label="Active Members" value={summary ? summary.active_members : "–"} icon="card" tone="green" />
        <StatCard label="Shops" value={summary ? summary.shops : "–"} icon="home" tone="purple" />
        <StatCard label="Total Due" value={summary ? money(summary.total_due) : "–"} icon="billing" tone="red" />
      </div>

      <div className="cust-filters">
        <div className="search-box">
          <Icon name="search" size={17} />
          <input placeholder="Search name / phone" value={search} onChange={filter("search")} />
        </div>
        <select value={category} onChange={filter("category")}>
          <option value="All">Customer Type</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={membership} onChange={filter("membership")}>
          <option value="">Membership</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="none">None</option>
        </select>
        <select value={due} onChange={filter("due")}>
          <option value="">Due Status</option>
          <option value="due">With due</option>
          <option value="clear">No due</option>
        </select>
      </div>

      {msg && <div className="error">{msg}</div>}

      <div>
        <div className="section-label">Customer list</div>
        <div className="card dash-card bills cust-list">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Customer</th><th>Phone</th><th>Type</th><th>Membership</th><th>Points</th><th>Due</th><th style={{ textAlign: "right" }}>Actions</th></tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7} className="muted">No customers found</td></tr>}
                {rows.map((c) => {
                  const m = membershipOf(c, today);
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/customers/${c.id}`} state={{ from: location.search }} className="dash-link"><strong>{c.name}</strong></Link>
                      </td>
                      <td>{c.phone}</td>
                      <td><span className="pill">{c.category}</span></td>
                      <td className="nowrap">
                        <span className={`pill ${MEMBERSHIP_PILL[m]}`}>{MEMBERSHIP_LABEL[m]}</span>
                        {c.is_member && c.expiry_date && <span className="muted"> till {fmtDate(c.expiry_date)}</span>}
                      </td>
                      <td>{c.points}</td>
                      <td className={Number(c.due_amount) > 0 ? "bad" : ""}>{money(c.due_amount)}</td>
                      <td>
                        <div className="bh-actions">
                          <Link to={`/customers/${c.id}`} state={{ from: location.search }} className="bh-ico view" data-tip="View customer" aria-label={`View ${c.name}`}><Icon name="eye" size={16} /></Link>
                          <button type="button" className="bh-ico edit" data-tip="Edit customer" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Icon name="edit" size={16} /></button>
                          {user.is_superuser && (
                            <button type="button" className="bh-ico delete" data-tip="Delete customer" aria-label={`Delete ${c.name}`} onClick={() => remove(c)}><Icon name="trash" size={16} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="table-foot">
            <span className="muted">Showing {from}–{to} of {count} customers</span>
            <Pagination page={page} pages={pages} onChange={goPage} />
          </div>
        </div>
      </div>

      {editing && (
        <CustomerForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); loadSummary(); }}
        />
      )}
    </div>
  );
}