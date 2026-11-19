import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import Pagination from "../components/Pagination";
import ReportPeriod from "../components/ReportPeriod";
import { REPORTS, downloadReport, fmtDay, iso, money, periodFromParams, periodQuery } from "../lib/reports";
import "./billing.css";
import "./orders.css";
import "./billhistory.css";
import "./reports.css";

const PAGE_SIZE = 15; // matches ReportPagination on the server
const GROUP_LABEL = { cost_of_sales: "Cost of sales", operating: "Operating expenses" };
const GROUP_PILL = { cost_of_sales: "blue", operating: "amber" };

// a loss is shown as -₹5,000 (money() alone would give ₹-5,000)
const signed = (n) => (Number(n) < 0 ? `-${money(-Number(n))}` : money(n));
const entries = (n) => `${n} ${n === 1 ? "entry" : "entries"}`;

// ------------------------------------------------------------------ statement
function Line({ kind, label, amount, note }) {
  const neg = Number(amount) < 0;
  return (
    <tr className={`pl-${kind}${kind === "grand" && neg ? " loss" : ""}`}>
      <td>{label}{note && <small>{note}</small>}</td>
      <td className="num">{amount == null ? "" : <span className={neg && kind !== "grand" ? "pl-neg" : ""}>{signed(amount)}</span>}</td>
    </tr>
  );
}

function Statement({ d }) {
  const spentAnything = [...d.cost_of_sales.lines, ...d.operating_expenses.lines].some((l) => l.entries > 0);
  const expLine = (l) => <Line key={l.key} kind="line" label={l.label} amount={l.amount} note={l.entries ? entries(l.entries) : ""} />;
  return (
    <section className="card pl-statement">
      {!spentAnything && (
        <p className="pl-empty-note">No expenses are entered for this period yet, so profit equals revenue. Add them in the Expenses section below.</p>
      )}
      <table className="pl-table">
        <tbody>
          <Line kind="sec" label="Revenue" />
          {d.revenue.lines.map((l) => <Line key={l.key} kind="line" label={l.label} amount={l.amount} note={l.note} />)}
          <Line kind="total" label="Total Revenue" amount={d.revenue.total} />
          <tr className="pl-gap"><td colSpan={2} /></tr>

          <Line kind="sec" label="Cost of Sales" />
          {d.cost_of_sales.lines.map(expLine)}
          <Line kind="total" label="Total Cost of Sales" amount={d.cost_of_sales.total} />
          <tr className="pl-gap"><td colSpan={2} /></tr>

          <Line kind="grand" label={Number(d.gross_profit) < 0 ? "Gross Loss" : "Gross Profit"} amount={d.gross_profit} />
          <tr className="pl-gap"><td colSpan={2} /></tr>

          <Line kind="sec" label="Operating Expenses" />
          {d.operating_expenses.lines.map(expLine)}
          <Line kind="total" label="Total Operating Expenses" amount={d.operating_expenses.total} />
          <tr className="pl-gap"><td colSpan={2} /></tr>

          <Line kind="grand" label={Number(d.net_profit) < 0 ? "Net Loss" : "Net Profit"} amount={d.net_profit} />
        </tbody>
      </table>
    </section>
  );
}

// ------------------------------------------------------------------- expenses
function ExpenseModal({ form, setForm, categories, busy, error, onSave, onClose }) {
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <div className="modal-bg">
      <form className="card modal" role="dialog" aria-modal="true" aria-label={form.id ? "Edit expense" : "Add expense"}
        onClick={(e) => e.stopPropagation()} onSubmit={onSave}>
        <h2>{form.id ? "Edit expense" : "Add expense"}</h2>
        <div className="pl-form-grid">
          <label>Date
            <input type="date" value={form.expense_date} onChange={set("expense_date")} required />
          </label>
          <label>Amount (₹)
            <input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" value={form.amount}
              onChange={set("amount")} onWheel={(e) => e.currentTarget.blur()} required autoFocus />
          </label>
        </div>
        <label>Category
          <select value={form.category} onChange={set("category")} required>
            <option value="">Select category</option>
            {Object.entries(GROUP_LABEL).map(([group, label]) => (
              <optgroup key={group} label={label}>
                {categories.filter((c) => c.group === group).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>Description <span className="muted">(optional — vendor, bill no, note)</span>
          <input value={form.description} maxLength={200} onChange={set("description")} placeholder="e.g. A4 paper bundle from ABC Traders" />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : form.id ? "Save changes" : "Add expense"}</button>
        </div>
      </form>
    </div>
  );
}

function ExpensesPanel({ from, to, onChanged }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [res, setRes] = useState({ key: "", data: null, error: "" });
  const [form, setForm] = useState(null);       // expense being added / edited
  const [formError, setFormError] = useState("");
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const reqKey = `${from}|${to}|${q.trim()}|${cat}|${page}|${tick}`;
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      const params = { date_from: from, date_to: to, page, ...(q.trim() ? { q: q.trim() } : {}), ...(cat ? { category: cat } : {}) };
      api.get("/expenses/", { params })
        .then((r) => { if (live) setRes({ key: reqKey, data: r.data, error: "" }); })
        .catch((e) => {
          if (!live) return;
          if (e?.response?.status === 404 && page > 1) setPage(page - 1); // that page is gone (last row deleted)
          else setRes({ key: reqKey, data: null, error: errorText(e) });
        });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [from, to, q, cat, page, reqKey]);
  const { data, error } = res;
  const loading = res.key !== reqKey;

  const rows = data?.results || [];
  const categories = data?.categories || [];
  const count = data?.count || 0;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const first = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, count);
  const filtered = Boolean(q || cat);

  const reload = () => { setTick((t) => t + 1); onChanged(); };

  const openAdd = () => {
    const today = iso(new Date());
    setFormError("");
    setForm({ expense_date: today >= from && today <= to ? today : to, category: "", amount: "", description: "" });
  };
  const openEdit = (r) => {
    setFormError("");
    setForm({ id: r.id, expense_date: r.date, category: r.category, amount: String(r.amount), description: r.description });
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.category) return setFormError("Choose a category.");
    if (!(Number(form.amount) > 0)) return setFormError("Enter an amount greater than 0.");
    setBusy(true);
    setFormError("");
    try {
      const body = { expense_date: form.expense_date, category: form.category, amount: form.amount, description: form.description };
      if (form.id) await api.put(`/expenses/${form.id}/`, body);
      else await api.post("/expenses/", body);
      setForm(null);
      reload();
    } catch (err) {
      setFormError(errorText(err));
    }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/expenses/${toDelete.id}/`);
      setToDelete(null);
      reload();
    } catch (err) {
      setRes((r) => ({ ...r, error: errorText(err) }));
      setToDelete(null);
    }
    setBusy(false);
  };

  return (
    <>
      <section className="card od-register pl-expenses">
        <div className="od-reg-head">
          <h3>Expenses<span className="muted">{count} {count === 1 ? "entry" : "entries"}{data ? ` · ${money(data.summary.total)}` : ""}</span></h3>
          <button type="button" className="primary bh-btn-ico" disabled={!data} onClick={openAdd}><Icon name="plus" size={16} />Add Expense</button>
        </div>
        <div className="rp-filter-row" style={{ padding: "12px 18px", gridTemplateColumns: "minmax(200px, 2fr) minmax(180px, 1fr) auto" }}>
          <div className="search-box">
            <Icon name="search" size={16} />
            <input placeholder="Search description" aria-label="Search expenses" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <select value={cat} aria-label="Category" onChange={(e) => { setCat(e.target.value); setPage(1); }}>
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <button type="button" disabled={!filtered} onClick={() => { setQ(""); setCat(""); setPage(1); }}>Clear</button>
        </div>
        {error && <div className="error" style={{ margin: "0 18px 12px" }}>{error}</div>}
        <div className="od-table-wrap">
          <table className={`od-table rp-table${loading ? " rp-loading" : ""}`}>
            <thead>
              <tr><th>Date</th><th>Category</th><th>Description</th><th className="num">Amount</th><th style={{ textAlign: "right" }}>Action</th></tr>
            </thead>
            <tbody>
              {!data && !error && <tr><td colSpan={5} className="od-empty">Loading…</td></tr>}
              {data && rows.length === 0 && (
                <tr><td colSpan={5} className="od-empty">{filtered ? "No expenses match these filters" : "No expenses in this period — use Add Expense to record rent, paper, salaries and so on"}</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDay(r.date)}</td>
                  <td><span className={`pill ${GROUP_PILL[r.group] || ""}`}>{r.category_label}</span></td>
                  <td>{r.description || <span className="muted">—</span>}</td>
                  <td className="num"><b>{money(r.amount)}</b></td>
                  <td>
                    <div className="pl-act">
                      <button type="button" title="Edit" aria-label="Edit expense" onClick={() => openEdit(r)}><Icon name="edit" size={15} /></button>
                      <button type="button" className="danger" title="Delete" aria-label="Delete expense" onClick={() => setToDelete(r)}><Icon name="trash" size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="od-foot-row">
          <span className="muted">Showing {first}–{last} of {count}</span>
          {pages > 1 && <Pagination page={page} pages={pages} onChange={setPage} />}
        </div>
      </section>

      {form && <ExpenseModal form={form} setForm={setForm} categories={categories} busy={busy} error={formError} onSave={save} onClose={() => setForm(null)} />}

      {toDelete && (
        <div className="modal-bg">
          <div className="card modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Delete this expense?</h2>
            <p>{toDelete.category_label} · {money(toDelete.amount)} on {fmtDay(toDelete.date)}. It will be removed from the Profit &amp; Loss report. This cannot be undone.</p>
            <div className="row">
              <button disabled={busy} onClick={() => setToDelete(null)}>Cancel</button>
              <button className="danger" disabled={busy} onClick={remove}>{busy ? "Please wait…" : "Yes, delete"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ----------------------------------------------------------------------- page
export default function ProfitLoss() {
  const [sp, setSp] = useSearchParams();
  const period = periodFromParams(sp);
  const { from, to } = period;
  const meta = REPORTS.pnl;
  const [tick, setTick] = useState(0);
  const [res, setRes] = useState({ key: "", data: null, error: "" });
  const reqKey = `${from}|${to}|${tick}`;

  useEffect(() => {
    let live = true;
    api.get("/reports/pnl/", { params: { date_from: from, date_to: to } })
      .then((r) => { if (live) setRes({ key: reqKey, data: r.data, error: "" }); })
      .catch((e) => { if (live) setRes({ key: reqKey, data: null, error: errorText(e) }); });
    return () => { live = false; };
  }, [from, to, reqKey]);
  const { data, error } = res;
  const stale = res.key !== reqKey; // a newer period is still loading - keep the old numbers, dimmed

  const apply = useCallback(({ from: f, to: t }) => setSp({ date_from: f, date_to: t }), [setSp]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const exportParams = { date_from: from, date_to: to };
  const s = data?.summary;
  const loss = s && Number(s.net_profit) < 0;

  return (
    <>
      <div className="od-head">
        <div>
          <Link className="bd-back" to={`/reports?${periodQuery(period)}`}><Icon name="back" size={16} />Reports</Link>
          <h1 className="rp-title">{meta.title}</h1>
          <p className="muted">{meta.blurb}</p>
        </div>
        <div className="row">
          <button type="button" className="bh-btn-ico" onClick={() => downloadReport("pnl", "pdf", exportParams)}><Icon name="download" size={16} />Export PDF</button>
          <button type="button" className="bh-btn-ico" onClick={() => downloadReport("pnl", "xlsx", exportParams)}><Icon name="sheet" size={16} />Export Excel</button>
          <button type="button" className="bh-btn-ico" onClick={refresh}><Icon name="refresh" size={16} />Refresh</button>
        </div>
      </div>

      <ReportPeriod key={`${from}|${to}`} from={from} to={to} onApply={apply} />

      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <div className={stale ? "rp-loading" : ""}>
          <div className="od-stats rp-stats pl-kpis">
            <div className="od-stat billed rp-kpi">
              <b>{money(s.revenue)}</b><span>Revenue</span>
              <small>Printing sales + other income</small>
            </div>
            <div className="od-stat outstanding rp-kpi">
              <b>{money(s.total_expenses)}</b><span>Total Expenses</span>
              <small>Cost of sales {money(data.cost_of_sales.total)} · operating {money(data.operating_expenses.total)}</small>
            </div>
            <div className={`od-stat ${loss ? "loss" : "profit"} rp-kpi`}>
              <b>{signed(s.net_profit)}</b><span>{loss ? "Net Loss" : "Net Profit"}</span>
              <small>{s.net_margin == null ? "No revenue in this period" : `${s.net_margin}% net margin · ${s.gross_margin}% gross margin`}</small>
            </div>
          </div>

          <Statement d={data} />
        </div>
      )}

      <ExpensesPanel key={`${from}|${to}`} from={from} to={to} onChanged={refresh} />
    </>
  );
}