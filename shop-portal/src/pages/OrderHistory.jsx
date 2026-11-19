import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { errorText } from "../api";
import { useCart } from "../CartContext";
import Icon from "../components/Icon";
import TablePager from "../components/TablePager";
import { StatusBadge, money, niceDate } from "./MyOrders";
import "../orderspage.css";
import "../history.css";
import "../datatable.css";

const STATUS_OPTIONS = [
  { value: "", label: "All History" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthRange = (offset) => {
  const now = new Date();
  return { from: iso(new Date(now.getFullYear(), now.getMonth() + offset, 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)) };
};
// each quick filter is just a ready-made set of filters
const QUICK = [
  { key: "all", label: "All", set: () => ({ status: "", from: "", to: "" }) },
  { key: "completed", label: "Completed", set: () => ({ status: "completed", from: "", to: "" }) },
  { key: "cancelled", label: "Cancelled", set: () => ({ status: "cancelled", from: "", to: "" }) },
  { key: "this", label: "This Month", set: () => ({ status: "", ...monthRange(0) }) },
  { key: "last", label: "Last Month", set: () => ({ status: "", ...monthRange(-1) }) },
];
// summary cards - clicking one filters the history by status
const KPIS = [
  ["", "Total Past Orders", "history", "total", "total"],
  ["completed", "Completed Orders", "check", "completed", "completed"],
  ["cancelled", "Cancelled Orders", "close", "cancelled", "cancelled"],
];
const NONE = { status: "", from: "", to: "" };
const same = (a, b) => a.status === b.status && a.from === b.from && a.to === b.to;

export default function OrderHistory() {
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");        // search text after the typing pause
  const [draft, setDraft] = useState(NONE);       // what the filter boxes show
  const [applied, setApplied] = useState(NONE);   // what the list is using (dates change only on Apply)
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");           // "export" or the id of the order being re-ordered

  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    api.get("/shop/orders/history/", { params: { q: query, status: applied.status, date_from: applied.from, date_to: applied.to, page, per_page: size }, signal: ctrl.signal })
      .then((r) => { setData(r.data); setError(""); setLoading(false); })
      .catch((e) => { if (e.code !== "ERR_CANCELED") { setError(errorText(e)); setLoading(false); } });
    return () => ctrl.abort();
  }, [query, applied, page, size, refresh]);

  const choose = (next) => { setDraft(next); setApplied(next); setPage(1); };
  const filtered = search || !same(applied, NONE);
  const counts = data?.counts;
  const rows = data?.results || [];

  const exportCsv = async () => {
    setBusy("export");
    try {
      const r = await api.get("/shop/orders/history/export/", { params: { q: query, status: applied.status, date_from: applied.from, date_to: applied.to }, responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = Object.assign(document.createElement("a"), { href: url, download: "order-history.csv" });
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not export your order history. Please try again.");
    } finally {
      setBusy("");
    }
  };

  const reorder = async (o) => {
    setBusy(o.id);
    setError("");
    try {
      const { data: res } = await api.post(`/shop/orders/${o.id}/reorder/`);
      if (!res.items.length) {
        setError(`None of the items in ${o.order_no} are available any more, so it cannot be ordered again.`);
        return;
      }
      res.items.forEach((item) => addItem(item));
      const skipped = res.skipped ? ` ${res.skipped} item${res.skipped > 1 ? "s were" : " was"} no longer available and left out.` : "";
      navigate("/cart", { state: { notice: `Items from ${res.order_no} were added to your cart.${skipped} Artwork files are not copied, so attach them again for each item.` } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="ord oh">
      <div className="page-head">
        <div>
          <h1>Order History</h1>
          <p className="muted">View your completed and past printing orders.</p>
        </div>
        <button type="button" className="oh-export" onClick={exportCsv} disabled={busy === "export" || !data?.total_count}>
          <Icon name="arrowdown" size={16} /> {busy === "export" ? "Exporting…" : "Export History"}
        </button>
      </div>

      <section className="ord-stats three" aria-label="History summary">
        {KPIS.map(([key, label, icon, tone]) => {
          const active = key === "" ? !applied.status : applied.status === key;
          return (
            <button type="button" key={label} className={`ord-stat ${tone}${active ? " active" : ""}`} aria-pressed={active}
              onClick={() => choose({ ...applied, status: key === "" || active ? "" : key })}>
              <span className="ord-stat-ico"><Icon name={icon} size={18} /></span>
              <span className="ord-stat-text"><small>{label}</small><b>{counts ? (counts[key === "" ? "total" : key] ?? 0) : "—"}</b></span>
            </button>
          );
        })}
      </section>

      <section className="card ord-filters oh-filters">
        <div className="ord-search">
          <Icon name="search" size={18} />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by order no. or printing item…" aria-label="Search order history" />
        </div>
        <label className="ord-fld">Status
          <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="ord-fld">From
          <input type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
        </label>
        <label className="ord-fld">To
          <input type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
        </label>
        <button type="button" className="primary oh-apply" disabled={same(draft, applied)} onClick={() => { setApplied(draft); setPage(1); }}>Apply</button>
        <button type="button" className="ord-reset" disabled={!filtered && same(draft, NONE)} onClick={() => { setSearch(""); setQuery(""); choose(NONE); }}>Reset</button>

        <div className="oh-quick">
          <span>Quick filters</span>
          {QUICK.map((qf) => (
            <button type="button" key={qf.key} className={`oh-chip${same(applied, qf.set()) ? " on" : ""}`} onClick={() => choose(qf.set())}>{qf.label}</button>
          ))}
        </div>
      </section>

      {error && <p className="alert error">{error}</p>}

      <section className={`dt-card${loading && data ? " is-loading" : ""}`}>
        <div className="dt-head">
          <div><h2>Order History</h2><p>Completed and cancelled orders.</p></div>
          <div className="dt-tools">
            {data && <span className="dt-count">{data.total_count} order{data.total_count === 1 ? "" : "s"}</span>}
            <button type="button" onClick={() => setRefresh((n) => n + 1)} disabled={loading}>
              <Icon name="refresh" size={15} className={loading ? "oh-spin" : ""} /> Refresh
            </button>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="dt-wrap">
            <table className="dt-table">
              <thead>
                <tr><th>#</th><th>Order No.</th><th>Work Type</th><th>Quantity</th><th>Order Date</th><th className="num">Amount</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {rows.map((o, i) => (
                  <tr key={o.id}>
                    <td>{(data.page - 1) * data.page_size + i + 1}</td>
                    <td><Link to={`/orders/${o.id}`} className="dt-link">{o.order_no}</Link></td>
                    <td><span className="dt-clip" title={o.items_text}>{o.items_text || "Printing items"}</span></td>
                    <td>{Number(o.qty || 0).toLocaleString("en-IN")} pcs</td>
                    <td>{niceDate(o.date)}</td>
                    <td className="num">{money(o.amount)}</td>
                    <td><StatusBadge status={o.status} label={o.status_label} /></td>
                    <td>
                      <div className="dt-actions">
                        <Link to={`/orders/${o.id}`} className="dt-view">View</Link>
                        {o.invoice_available && (
                            <Link to={`/orders/${o.id}/invoice`} className="dt-view alt" title="View invoice"><Icon name="receipt" size={14} /> Invoice</Link>
                        )}
                        {o.status === "completed" && (
                          <button type="button" className="dt-view alt" disabled={busy === o.id} onClick={() => reorder(o)}>
                            <Icon name="refresh" size={14} /> {busy === o.id ? "Adding…" : "Reorder"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!data && loading && <div className="dt-skel" aria-label="Loading order history">{[0, 1, 2, 3].map((n) => <span key={n} />)}</div>}

        {data && rows.length === 0 && (
          <div className="dt-empty">
            <span className="dt-empty-ico"><Icon name="history" size={24} /></span>
            <b>{filtered ? "No past orders match your filters" : "No order history yet"}</b>
            <p>{filtered ? "Try a different search or clear the filters." : "Completed and cancelled orders will appear here."}</p>
          </div>
        )}

        {data && (
          <TablePager page={data.page} pages={data.pages} total={data.total_count} count={rows.length} size={size}
            onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} />
        )}
      </section>
    </div>
  );
}