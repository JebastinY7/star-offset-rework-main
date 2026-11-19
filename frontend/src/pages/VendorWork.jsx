import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import "./billhistory.css"; // icon buttons (.bh-ico) with tooltips
import "./vendorWork.css";
import "./vendorQuotes.css"; // price requests / quotes (loaded after vendorWork.css on purpose)

// Admin > Vendor Work
//   /vendor-work                   Assign work: pick a shop order -> items -> vendor -> price / due date
//   /vendor-work?order=12          same, with shop order 12 already opened (linked from Shop Orders)
//   /vendor-work?src=manual&order=5  same for manual order W005 (Admin > Orders)
//   /vendor-work?tab=jobs          every job given to vendors, with status + actions
// API: /admin/shop-orders/(<id>/jobs/), /admin/manual-orders/(<id>/jobs/), /admin/vendor-jobs/, /settings/vendors/
// PRICE REQUESTS (quotes): the normal way to give work out. Tick items -> tick one or more vendors -> "Ask for price". Each vendor
// gets a price request (status "enquiry") and answers with ONE total price in the Vendor Portal > Price Requests (status "quoted").
// The "Price quotes" card of the order then shows every answer: "Assign" accepts that quote (the job goes to that vendor at the
// quoted price, the artwork is e-mailed, the other requests for the same items are closed) and "Not suitable" turns it down.
// NEGOTIATION: on a received quote, "Counter offer" lets Star Offset propose its own price (status "countered"). The vendor accepts it,
// sends a new price or declines in the Vendor Portal; the card keeps the whole price history. "Assign" works once the vendor is back to
// "quoted" (= priced / agreed), at that price.
// "Assign directly" (price already agreed) is still there as the second mode of step 3. payload.rates = what each vendor was paid
// on earlier jobs for the same work (source "history"); it is only a reference for judging a quote.

const ORDER_CHIPS = [["payment_confirmed", "Payment confirmed"], ["in_production", "In production"], ["", "All orders"]];
// manual orders (made in Admin > Orders): "open" = not delivered / cancelled
const MANUAL_CHIPS = [["open", "Open orders"], ["pending", "Pending"], ["progress", "In progress"], ["", "All orders"]];
const ASSIGN_CHIPS = [["", "Any"], ["open", "Needs work"], ["done", "Fully assigned"]];
const SRC = { shop: { label: "Shop order", base: "/admin/shop-orders" }, manual: { label: "Manual order", base: "/admin/manual-orders" } };
// same rule as the server's rate_key: "Bill  BOOK" and "bill book" are the same work.
// Order items are named after the price-list work (service_name); vendors tick the same works in Vendor Management.
const norm = (s) => String(s || "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");

const orderLink = (source, id) => (source === "manual" ? `/vendor-work?src=manual&order=${id}` : `/shop-orders/${id}`);
const ORDER_LABEL = {
  submitted: "Submitted", awaiting_payment: "Awaiting Payment", payment_confirmed: "Payment Confirmed",
  in_production: "In Production", ready: "Ready for Pickup", completed: "Completed", cancelled: "Cancelled",
};
const JOB_STATUS = [
  ["enquiry", "Quote requested"], ["quoted", "Quoted"], ["countered", "Counter offer sent"], ["assigned", "New"], ["accepted", "Accepted"], ["in_progress", "In Production"],
  ["ready", "Ready"], ["completed", "Completed"], ["rejected", "Rejected"], ["cancelled", "Cancelled"],
  ["declined", "Declined to quote"], ["not_selected", "Not selected"],
];
const JOB_LABEL = Object.fromEntries(JOB_STATUS);
const QUOTE_OPEN = ["enquiry", "quoted", "countered"];                              // price request still undecided
const QUOTE_ALL = [...QUOTE_OPEN, "declined", "not_selected"];        // every price request (not a job yet)
const ACTIVE = ["assigned", "accepted", "in_progress", "ready"];
const WITH_VENDOR = ["assigned", "accepted", "in_progress"]; // still with the vendor: past due date = overdue
const CANCELLABLE = [...ACTIVE, "rejected"];
const PAGE_SIZE = 10;

// [job status or "overdue", label, icon] - each card filters the Vendor jobs tab
const KPIS = [
  ["enquiry", "Waiting for price", "mail"],
  ["quoted", "Quotes to review", "tag"],
  ["assigned", "New (waiting)", "send"],
  ["accepted", "Accepted", "check"],
  ["in_progress", "In production", "printer"],
  ["ready", "Ready to collect", "store"],
  ["overdue", "Overdue", "alert"],
  ["completed", "Completed", "truck"],
];

const money = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) ? "—"
  : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtDate = (v) => v ? new Date(`${String(v).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const party = (o) => o?.party_name ?? o?.shop_name ?? ""; // manual orders: customer, shop orders: shop
const initials = (name) => (name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const todayStr = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
const isOverdue = (j) => Boolean(j.due_date) && WITH_VENDOR.includes(j.status) && j.due_date < todayStr();
const fileSize = (b) => { const n = Number(b || 0); return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`; };
const timeOf = (v) => v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "";
const specLines = (spec) => (Array.isArray(spec) ? spec.map((s) => `${s.label}: ${s.value}`) : []);

function Badge({ kind = "job", status, label }) {
  return <span className={`vw-badge ${kind}-${status}`}>{label}</span>;
}

// where the order came from: shop portal order or manual order
function SourceTag({ source }) {
  const manual = source === "manual";
  return <span className={`vw-src ${manual ? "manual" : "shop"}`}>{manual ? "Manual" : "Shop"}</span>;
}

// "is this order already with a vendor?" at one look: Not assigned / 1 of 3 assigned / Assigned
function AssignTag({ assign, full = false }) {
  if (!assign) return null;
  const { state, assigned, total, vendors = [], declined, quotes } = assign;
  return <span className="vw-assign-wrap">
    {state === "all" && <span className="vw-atag all"><Icon name="check" size={12} /> Assigned{full && vendors.length ? ` · ${vendors.join(", ")}` : ""}</span>}
    {state === "partial" && <span className="vw-atag partial">{assigned} of {total} assigned</span>}
    {state === "none" && <span className="vw-atag none">Not assigned</span>}
    {declined && <span className="vw-atag declined" title="A vendor declined; assign the items again">Vendor declined</span>}
    {state !== "all" && quotes?.received > 0 && <span className="vw-atag quote got" title="Open the order to accept a quote"><Icon name="tag" size={11} /> {quotes.received} quote{quotes.received !== 1 ? "s" : ""} received</span>}
    {state !== "all" && quotes?.countered > 0 && <span className="vw-atag quote" title="Waiting for the vendor to answer your counter offer">Counter offer sent · {quotes.countered}</span>}
    {state !== "all" && quotes?.waiting > 0 && <span className="vw-atag quote">Waiting for {quotes.waiting} price{quotes.waiting !== 1 ? "s" : ""}</span>}
  </span>;
}

/* ------------------------------------------------------------------ artwork file chips */
// itemId + file.idx identify the file for the download endpoint; files placed before storage was added are "email only"
function FileChips({ itemId, files }) {
  if (!files?.length) return <span className="vw-nofile">No artwork files</span>;
  return <span className="vw-files">
    {files.map((f) => f.stored
      ? <a key={`${itemId}-${f.idx}`} className="vw-file" href={`/api/admin/order-files/${itemId}/${f.idx}/`} title={`Download ${f.name}`}><Icon name="download" size={13} />{f.name}<small>{fileSize(f.size)}</small></a>
      : <span key={`${itemId}-${f.idx}`} className="vw-file off" title="Only in the order e-mail (placed before file storage was added)"><Icon name="mail" size={13} />{f.name}<small>e-mail only</small></span>)}
  </span>;
}

/* ------------------------------------------------------------------ job action icons */
function JobActions({ job, onEdit, onAct, onResend, onCounter, showReassign }) {
  if (QUOTE_OPEN.includes(job.status)) {  // a price request: accept the quote / turn it down / ask again
    return <div className="vw-acts">
      {job.status === "quoted" &&
        <button type="button" className="bh-ico done" data-tip="Quote is OK - assign the work" aria-label={`Assign ${job.job_no} at the quoted price`} onClick={() => onAct(job, "assigned")}><Icon name="check" size={16} /></button>}
      {(job.status === "quoted" || job.status === "countered") && onCounter &&
        <button type="button" className="bh-ico edit" data-tip={job.status === "quoted" ? "Counter offer - propose your price" : "Change your counter offer"} aria-label={`Counter offer for ${job.job_no}`} onClick={() => onCounter(job)}><Icon name="reply" size={16} /></button>}
      {job.status === "enquiry" &&
        <button type="button" className="bh-ico view" data-tip="E-mail the price request again" aria-label={`E-mail price request ${job.job_no}`} onClick={() => onResend(job)}><Icon name="mail" size={16} /></button>}
      <button type="button" className="bh-ico delete" data-tip={job.status === "quoted" ? "Quote not suitable" : job.status === "countered" ? "Close - no deal" : "Withdraw price request"} aria-label={`Close ${job.job_no}`} onClick={() => onAct(job, "not_selected")}><Icon name="block" size={16} /></button>
    </div>;
  }
  if (QUOTE_ALL.includes(job.status)) return <div className="vw-acts" />;
  return <div className="vw-acts">
    {showReassign && job.status === "rejected" &&
      <Link to={`/vendor-work?${job.source === "manual" ? "src=manual&" : ""}order=${job.order_id}`} className="bh-ico edit" data-tip="Reassign to another vendor" aria-label={`Reassign ${job.job_no}`}><Icon name="refresh" size={16} /></Link>}
    {ACTIVE.includes(job.status) &&
      <button type="button" className="bh-ico view" data-tip="E-mail job and files to vendor" aria-label={`E-mail ${job.job_no} to vendor`} onClick={() => onResend(job)}><Icon name="mail" size={16} /></button>}
    {ACTIVE.includes(job.status) &&
      <button type="button" className="bh-ico edit" data-tip="Edit price / due date" aria-label={`Edit ${job.job_no}`} onClick={() => onEdit(job)}><Icon name="edit" size={16} /></button>}
    {job.status === "ready" &&
      <button type="button" className="bh-ico done" data-tip="Mark completed (collected)" aria-label={`Complete ${job.job_no}`} onClick={() => onAct(job, "completed")}><Icon name="check" size={16} /></button>}
    {CANCELLABLE.includes(job.status) &&
      <button type="button" className="bh-ico delete" data-tip="Cancel job" aria-label={`Cancel ${job.job_no}`} onClick={() => onAct(job, "cancelled")}><Icon name="block" size={16} /></button>}
  </div>;
}

/* ------------------------------------------------------------------ edit job modal */
function EditJobModal({ job, onClose, onSaved }) {
  const [price, setPrice] = useState(job.vendor_price ?? "");
  const [due, setDue] = useState(job.due_date || "");
  const [note, setNote] = useState(job.instructions || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (e) => {
    e.preventDefault();
    if (price !== "" && !(Number(price) >= 0)) { setError("Enter a valid vendor price."); return; }
    setBusy(true); setError("");
    try {
      await api.patch(`/admin/vendor-jobs/${job.id}/`, { vendor_price: price === "" ? null : price, due_date: due || null, instructions: note });
      onSaved(`${job.job_no} updated.`);
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };

  return <div className="vw-overlay">
    <form className="vw-modal" onSubmit={save} role="dialog" aria-modal="true" aria-label={`Edit ${job.job_no}`}>
      <div className="vw-modal-head">
        <div><h2>Edit {job.job_no}</h2><p>{job.vendor_name} · {job.order_no}</p></div>
        <button type="button" className="vw-x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
      </div>
      {error && <div className="vw-alert error">{error}</div>}
      <div className="vw-grid2">
        <label className="vw-field">Vendor price (₹)
          <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} onWheel={(e) => e.currentTarget.blur()} placeholder="What you pay the vendor" /></label>
        <label className="vw-field">Due date
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      </div>
      <label className="vw-field">Instructions for vendor
        <textarea rows={4} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Paper, finishing, packing, pickup time…" /></label>
      <div className="vw-modal-foot">
        <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  </div>;
}

/* ------------------------------------------------------------------ counter offer modal */
// Star Offset answers a vendor's quote with its own price. The vendor sees it under Price Requests and accepts / re-quotes / declines.
function CounterModal({ job, onClose, onSaved }) {
  const [price, setPrice] = useState(job.status === "countered" ? job.counter_price ?? "" : "");
  const [note, setNote] = useState(job.status === "countered" ? job.counter_note || "" : "");
  const [mail, setMail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const asked = Number(job.quoted_price);
  const offer = Number(price);
  const per = job.qty && offer > 0 ? offer / job.qty : null;
  const diff = offer > 0 && asked > 0 ? Math.round(((offer - asked) / asked) * 100) : null;

  const save = async (e) => {
    e.preventDefault();
    if (!(offer > 0)) { setError("Enter the price you want to offer (more than 0)."); return; }
    setBusy(true); setError("");
    try {
      const r = await api.patch(`/admin/vendor-jobs/${job.id}/`, { status: "countered", counter_price: price, counter_note: note, send_email: mail });
      onSaved(`Counter offer of ${money(offer)} sent to ${job.vendor_name}. They can accept it or send a new price.`, r.data.email);
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };

  return <div className="vw-overlay">
    <form className="vw-modal" onSubmit={save} role="dialog" aria-modal="true" aria-label={`Counter offer for ${job.job_no}`}>
      <div className="vw-modal-head">
        <div><h2>Counter offer</h2><p>{job.vendor_name} · {job.order_no} · {job.job_no}</p></div>
        <button type="button" className="vw-x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
      </div>
      {error && <div className="vw-alert error">{error}</div>}
      <div className="vq-neg-box">
        <span>{job.vendor_name} quoted</span><b>{money(asked)}</b>
        <small>total for {job.qty} pcs{job.qty && asked > 0 ? ` · ${money(Math.round((asked / job.qty) * 100) / 100)} per piece` : ""}</small>
      </div>
      <NegotiationLog steps={job.negotiation} />
      <label className="vw-field">Your price for the whole job (₹) <b className="req">*</b>
        <input type="number" min="0" step="0.01" autoFocus value={price} onChange={(e) => setPrice(e.target.value)} onWheel={(e) => e.currentTarget.blur()} placeholder="The price you want to pay" />
        <small className="vq-per">{per ? `= ${money(Math.round(per * 100) / 100)} per piece${diff !== null ? ` · ${diff > 0 ? "+" : ""}${diff}% vs their quote` : ""}` : "One price for everything in this job."}</small>
      </label>
      <label className="vw-field">Message to vendor <small>optional</small>
        <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Can you do it at this price? Bulk order, repeat work coming." /></label>
      <label className="vq-check"><input type="checkbox" checked={mail} onChange={(e) => setMail(e.target.checked)} /> E-mail the vendor about this offer</label>
      <div className="vw-modal-foot">
        <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? "Sending…" : job.status === "countered" ? "Update offer" : "Send counter offer"}</button>
      </div>
    </form>
  </div>;
}

// how the price moved: vendor quoted -> we offered -> vendor accepted / quoted again ...
const NEG_TEXT = {
  "vendor-quote": (p) => <>Vendor quoted <b>{money(p)}</b></>,
  "admin-counter": (p) => <>You offered <b>{money(p)}</b></>,
  "vendor-accept": (p) => <>Vendor accepted <b>{money(p)}</b></>,
};
function NegotiationLog({ steps }) {
  const rows = (steps || []).filter((s) => NEG_TEXT[`${s.by}-${s.kind}`]);
  if (rows.length < 2) return null;  // one quote is not a negotiation yet
  return <ol className="vq-neg">
    {rows.map((s, i) => <li key={i} className={s.by}><span>{NEG_TEXT[`${s.by}-${s.kind}`](s.price)}</span><em>{timeOf(s.at)}</em>{s.note && <p>“{s.note}”</p>}</li>)}
  </ol>;
}

/* ------------------------------------------------------------------ left: pick an order */
function OrderPicker({ source, selectedId, onSelect, onSource, refreshKey }) {
  const manual = source === "manual";
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [status, setStatus] = useState(manual ? "open" : "payment_confirmed");
  const [assign, setAssign] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { const t = setTimeout(() => { setDq(q.trim()); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);

  // switching between shop orders and manual orders starts a fresh list
  useEffect(() => { setStatus(manual ? "open" : "payment_confirmed"); setAssign(""); setPage(1); setRows([]); setQ(""); setDq(""); }, [manual]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(`${SRC[source].base}/`, { params: { q: dq, status, assign, page } })
      .then((r) => { if (!alive) return; setRows(r.data.results || []); setCounts(r.data.counts || {}); setTotal(r.data.total_count || 0); setError(""); })
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [source, dq, status, assign, page, refreshKey]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <section className="card vw-picker">
    <div className="vw-card-head"><h2>1 · Choose an order</h2><span>{total} order{total !== 1 ? "s" : ""}</span></div>
    <div className="vw-switch" role="tablist" aria-label="Order type">
      <button type="button" role="tab" aria-selected={!manual} className={!manual ? "on" : ""} onClick={() => onSource("shop")}>Shop orders</button>
      <button type="button" role="tab" aria-selected={manual} className={manual ? "on" : ""} onClick={() => onSource("manual")}>Manual orders</button>
    </div>
    <div className="vw-search"><Icon name="search" size={17} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={manual ? "Order no (W012), customer, phone or work…" : "Order no, shop, phone or item…"} /></div>
    <div className="vw-chips">
      {(manual ? MANUAL_CHIPS : ORDER_CHIPS).map(([key, label]) => {
        const n = key === "" ? counts.total : counts[key];
        return <button type="button" key={label} className={`vw-chip${status === key ? " on" : ""}`} onClick={() => { setStatus(key); setPage(1); }}>
          {label}{n !== undefined && <em>{n}</em>}
        </button>;
      })}
    </div>
    <div className="vw-chips vw-achips" aria-label="Assignment">
      <span className="vw-chips-label">Vendor work</span>
      {ASSIGN_CHIPS.map(([key, label]) => <button type="button" key={label} className={`vw-chip sm${assign === key ? " on" : ""}`} onClick={() => { setAssign(key); setPage(1); }}>{label}</button>)}
    </div>
    {error && <div className="vw-alert error">{error}</div>}
    <div className="vw-order-list">
      {loading && rows.length === 0 && [0, 1, 2, 3].map((n) => <div key={n} className="vw-skel" />)}
      {rows.map((o) => <button type="button" key={o.id} className={`vw-order ${o.source === "manual" ? "is-manual" : "is-shop"} assign-${o.assign?.state || "none"}${String(o.id) === String(selectedId) ? " on" : ""}`} onClick={() => onSelect(o.id)}>
        <span className="vw-avatar">{initials(party(o))}</span>
        <span className="vw-order-main">
          <span className="vw-order-top"><span className="vw-order-no"><b>{o.order_no}</b><SourceTag source={o.source} /></span><Badge kind="order" status={o.status} label={o.status_label} /></span>
          <span className="vw-order-shop">{party(o)}</span>
          <small>{o.source === "manual" && o.work_name ? `${o.work_name} · ` : ""}{o.items} item{Number(o.items) !== 1 ? "s" : ""} · {o.items_text || "Printing items"}</small>
          <AssignTag assign={o.assign} full />
        </span>
      </button>)}
      {!loading && rows.length === 0 && <div className="vw-empty small">
        <span className="vw-empty-ico"><Icon name="store" size={22} /></span>
        <b>No orders found</b><p>{status || assign ? "Try another filter above, or " : ""}clear the search.</p>
      </div>}
    </div>
    {total > PAGE_SIZE && <div className="vw-pager">
      <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
    </div>}
  </section>;
}

/* ------------------------------------------------------------------ price quotes of one order */
// quotes = the order's price requests (enquiry / quoted / declined / not_selected); free = its unassigned items (for the quantities);
// rateMap = what each vendor was paid before for the same work (reference only)
function QuoteList({ quotes, free, rateMap, closed, onAct, onResend, onCounter }) {
  const qtyOf = useMemo(() => Object.fromEntries(free.map((i) => [i.id, Number(i.qty || 0)])), [free]);
  const keyOf = (j) => [...j.item_ids].sort((a, b) => a - b).join(",");
  // cheapest received quote for each set of items (several vendors may be asked about the same items)
  const lowest = useMemo(() => {
    const m = {};
    quotes.filter((j) => j.status === "quoted").forEach((j) => { const k = keyOf(j); const p = Number(j.quoted_price); if (!(k in m) || p < m[k]) m[k] = p; });
    return m;
  }, [quotes]);
  const compete = (j) => quotes.filter((x) => x.status === "quoted" && keyOf(x) === keyOf(j)).length > 1;
  // what this vendor was paid before for the same work, when every item has a past rate
  const lastPaid = (j) => {
    const known = rateMap[j.vendor_id] || {};
    if (!j.item_ids.every((id) => known[id] && qtyOf[id] !== undefined)) return null;
    return Math.round(j.item_ids.reduce((s, id) => s + known[id].per_piece * qtyOf[id], 0) * 100) / 100;
  };
  const sorted = [...quotes].sort((a, b) => (QUOTE_OPEN.includes(b.status) - QUOTE_OPEN.includes(a.status)) || (a.status === "quoted" ? -1 : 0) - (b.status === "quoted" ? -1 : 0) || Number(a.quoted_price || 0) - Number(b.quoted_price || 0));

  return <ul className="vq-list">
    {sorted.map((j) => {
      const open = QUOTE_OPEN.includes(j.status);
      const price = Number(j.quoted_price);
      const perPiece = j.qty ? price / j.qty : null;
      const past = j.status === "quoted" ? lastPaid(j) : null;
      const isLowest = j.status === "quoted" && compete(j) && price === lowest[keyOf(j)];
      return <li key={j.id} className={`vq-card ${j.status}${open ? "" : " dim"}`}>
        <span className="vw-avatar">{initials(j.vendor_name)}</span>
        <div className="vq-main">
          <div className="vq-top"><b>{j.vendor_name}</b><span className="vq-job">{j.job_no}</span><Badge status={j.status} label={JOB_LABEL[j.status]} />{isLowest && <em className="vq-low">Lowest</em>}</div>
          <p className="vq-items">{j.items.join(", ")}</p>
          <div className="vq-foot">
            <div className="vq-info">
              {j.status === "quoted" && <div className="vq-price">
                <b>{money(price)}</b><span>total{perPiece ? ` · ${money(Math.round(perPiece * 100) / 100)} per piece` : ""} · quoted {fmtDate(j.quoted_at)}</span>
                {past !== null && <small className={past > 0 && price > past ? "up" : "down"}>Last similar job with this vendor ≈ {money(past)}{past > 0 ? ` (${price > past ? "+" : ""}${Math.round(((price - past) / past) * 100)}%)` : ""}</small>}
              </div>}
              {j.status === "countered" && <div className="vq-offer">
                <span>You offered</span><b>{money(j.counter_price)}</b>
                <small>{j.qty ? `${money(Math.round((Number(j.counter_price) / j.qty) * 100) / 100)} per piece · ` : ""}sent {fmtDate(j.countered_at)} · vendor quoted {money(price)}</small>
                <p className="vq-wait"><Icon name="mail" size={13} /> Waiting for the vendor to accept or send a new price</p>
              </div>}
              {j.status === "enquiry" && <p className="vq-wait"><Icon name="mail" size={13} /> Asked on {fmtDate(j.created_at)} · waiting for the vendor's price</p>}
              {j.status !== "enquiry" && <NegotiationLog steps={j.negotiation} />}
              {j.vendor_note && <p className="vw-vnote"><Icon name="message" size={13} /> {j.vendor_note}</p>}
              {j.status === "declined" && <p className="vw-vnote bad">This vendor cannot do the work.</p>}
              {j.status === "not_selected" && j.quoted_price && <p className="vq-wait">Quoted {money(price)} · not selected</p>}
            </div>
            {open && !closed && <div className="vq-acts">
              {j.status === "quoted" && <button type="button" className="primary vq-accept" onClick={() => onAct(j, "assigned")}><Icon name="check" size={15} /> Assign</button>}
              {(j.status === "quoted" || j.status === "countered") && onCounter && <button type="button" className="vq-ghost" onClick={() => onCounter(j)}><Icon name="reply" size={14} /> {j.status === "quoted" ? "Counter offer" : "Change offer"}</button>}
              {j.status === "enquiry" && <button type="button" className="vq-ghost" onClick={() => onResend(j)}><Icon name="mail" size={14} /> Remind</button>}
              <button type="button" className="vq-ghost no" onClick={() => onAct(j, "not_selected")}>{j.status === "quoted" ? "Not suitable" : j.status === "countered" ? "No deal" : "Withdraw"}</button>
            </div>}
          </div>
        </div>
      </li>;
    })}
  </ul>;
}

/* ------------------------------------------------------------------ right: split the order */
function OrderPanel({ source, orderId, vendors, refreshKey, onChanged, onEdit, onAct, onResend, onCounter, setFlash, emailFlash }) {
  const [order, setOrder] = useState(null);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState([]);
  const [mode, setMode] = useState("quote");        // "quote" = ask for a price first | "assign" = price already agreed
  const [vendorIds, setVendorIds] = useState([]);   // quote mode: any number of vendors; assign mode: exactly one
  const [vq, setVq] = useState("");
  const [showAll, setShowAll] = useState(false);   // false = only the vendors who do the work of the ticked items
  const [price, setPrice] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailOn, setEmailOn] = useState(true);
  const [formError, setFormError] = useState("");
  const [view, setView] = useState("request");   // "request" | "quotes" | "jobs": which part of the order is on screen
  const loadedFor = useRef(null);
  const viewFor = useRef(null);
  const manual = source === "manual";
  const key = `${source}:${orderId}`;

  // new order opened -> clear the form
  useEffect(() => { setPicked([]); setVendorIds([]); setVq(""); setShowAll(false); setPrice(""); setDue(""); setNote(""); setFormError(""); }, [key]);

  useEffect(() => {
    let alive = true;
    if (loadedFor.current !== key) { setLoading(true); setOrder(null); setPayload(null); }
    Promise.all([api.get(`${SRC[source].base}/${orderId}/`), api.get(`${SRC[source].base}/${orderId}/jobs/`)])
      .then(([o, j]) => {
        if (!alive) return;
        setOrder(o.data.order); setPayload(j.data); setError("");
        // open the part that needs attention: received quotes first, then jobs when nothing is left to give out
        const all = j.data.jobs || [];
        const open = all.filter((x) => QUOTE_OPEN.includes(x.status));
        const real = all.filter((x) => !QUOTE_ALL.includes(x.status));
        const got = open.filter((x) => x.status === "quoted").length;
        if (viewFor.current !== key) {
          viewFor.current = key;
          setView(got > 0 ? "quotes" : (j.data.unassigned || []).length === 0 && real.length > 0 ? "jobs" : "request");
        } else if (open.length === 0) {
          setView((v) => (v === "quotes" ? (real.length > 0 ? "jobs" : "request") : v)); // last quote was decided
        }
        setDue((d) => d || o.data.order.delivery_date || "");
        // drop ticks for items that were assigned meanwhile
        const free = new Set((j.data.unassigned || []).map((i) => i.id));
        setPicked((p) => p.filter((id) => free.has(id)));
      })
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => { if (alive) { loadedFor.current = key; setLoading(false); } });
    return () => { alive = false; };
  }, [source, orderId, key, refreshKey]);

  const free = payload?.unassigned || [];
  const allJobs = payload?.jobs || [];
  const quotes = allJobs.filter((j) => QUOTE_ALL.includes(j.status));   // price requests
  const jobs = allJobs.filter((j) => !QUOTE_ALL.includes(j.status));    // real jobs (work given to a vendor)
  const live = jobs.filter((j) => !["rejected", "cancelled"].includes(j.status));
  const closed = order && (manual ? ["delivered", "cancelled"] : ["completed", "cancelled"]).includes(order.status);
  const early = order && !manual && ["submitted", "awaiting_payment"].includes(order.status);
  const activeVendors = useMemo(() => vendors.filter((v) => v.is_active && v.portal_access), [vendors]);
  const chosen = activeVendors.filter((v) => vendorIds.map(String).includes(String(v.id)));
  const vendor = mode === "assign" ? chosen[0] : undefined;
  const pickedItems = free.filter((i) => picked.includes(i.id));

  // vendor_id -> item id -> what that vendor was paid per piece for the same work before (reference only)
  const rateMap = useMemo(() => {
    const m = {};
    (payload?.rates || []).forEach((r) => { (m[r.vendor_id] = m[r.vendor_id] || {})[r.item_id] = r; });
    return m;
  }, [payload]);
  // the items the vendor cards talk about: the ticked ones, or every unassigned item while nothing is ticked yet
  const basis = pickedItems.length ? pickedItems : free;

  // ---- show only the vendors who do this work.
  // needWorks = the distinct works of the ticked items (or of every unassigned item while nothing is ticked yet).
  // Ticked items -> a vendor must do ALL of those works. Nothing ticked -> a vendor doing ANY of them is shown.
  // A vendor that is already selected stays on screen, so a choice never disappears silently.
  const needWorks = [];
  basis.forEach((i) => { const k = norm(i.service_name); if (k && !needWorks.some((w) => w.key === k)) needWorks.push({ key: k, name: i.service_name }); });
  const hitsOf = (v) => { const has = new Set((v.works || []).map(norm)); return needWorks.filter((w) => has.has(w.key)); };
  const fits = (v) => needWorks.length === 0 || (pickedItems.length ? hitsOf(v).length === needWorks.length : hitsOf(v).length > 0);
  const pickedIds = vendorIds.map(String);
  const baseVendors = showAll ? activeVendors : activeVendors.filter((v) => fits(v) || pickedIds.includes(String(v.id)));
  const vTerm = vq.trim().toLowerCase();
  const shownVendors = (vTerm ? baseVendors.filter((v) => `${v.name} ${v.owner_name} ${v.specialties} ${(v.works || []).join(" ")}`.toLowerCase().includes(vTerm)) : baseVendors)
    .slice().sort((a, b) => Number(fits(b)) - Number(fits(a)) || hitsOf(b).length - hitsOf(a).length);   // best match first, then by name
  const hiddenVendors = activeVendors.length - baseVendors.length;
  const unmarked = activeVendors.filter((v) => !(v.works || []).length).length;   // vendors that have not marked any work yet
  const pastFor = (vid) => {  // what this vendor was paid before for ALL of those items (null when unknown for any)
    const known = rateMap[vid] || {};
    if (basis.length === 0 || basis.some((i) => !known[i.id])) return null;
    return Math.round(basis.reduce((s, i) => s + known[i.id].per_piece * Number(i.qty || 0), 0) * 100) / 100;
  };
  const rateScope = pickedItems.length ? "the ticked items" : "all unassigned items";
  const suggested = vendor && pickedItems.length > 0 ? pastFor(vendor.id) : null;
  // a vendor that was already asked about these items (shown on its card so nobody is asked twice)
  const askedOf = (vid) => quotes.find((q) => String(q.vendor_id) === String(vid) && QUOTE_OPEN.includes(q.status) && q.item_ids.some((id) => basis.some((i) => i.id === id)));
  const pickedFiles = pickedItems.flatMap((i) => i.files || []);
  const attachCount = pickedFiles.filter((f) => f.stored).length;
  const emailOnlyCount = pickedFiles.length - attachCount;

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const allOn = free.length > 0 && picked.length === free.length;
  const pickVendor = (id) => setVendorIds((ids) => (mode === "assign" ? [id] : ids.map(String).includes(String(id)) ? ids.filter((x) => String(x) !== String(id)) : [...ids, id]));
  const switchMode = (m) => { setMode(m); setFormError(""); if (m === "assign") setVendorIds((ids) => ids.slice(0, 1)); };

  const submit = async () => {
    setFormError("");
    if (pickedItems.length === 0) { setFormError("Tick at least one item to give out."); return; }
    if (mode === "quote" && chosen.length === 0) { setFormError("Choose at least one vendor to ask for a price."); return; }
    if (mode === "assign" && !vendor) { setFormError("Choose a vendor."); return; }
    if (mode === "assign" && price !== "" && !(Number(price) >= 0)) { setFormError("Enter a valid vendor price."); return; }
    if (due && due < todayStr()) { setFormError("Due date is in the past."); return; }
    setBusy(true);
    try {
      const n = pickedItems.length;
      if (mode === "quote") {
        const r = await api.post(`${SRC[source].base}/${orderId}/jobs/`, {
          mode: "quote", vendor_ids: chosen.map((v) => v.id), item_ids: pickedItems.map((i) => i.id),
          due_date: due || null, instructions: note, send_email: emailOn,
        });
        setPayload(r.data);
        setPicked([]); setVendorIds([]); setNote(""); setView("quotes");
        const lead = `Price requested from ${chosen.length} vendor${chosen.length !== 1 ? "s" : ""} for ${n} item${n !== 1 ? "s" : ""}.`;
        const m = r.data.quote_mail;
        if (!m) setFlash({ type: "success", msg: `${lead} No e-mail was sent - the vendors can still see it in their portal.` });
        else if (m.failed?.length) setFlash({ type: "warn", msg: `${lead} But the e-mail to ${m.failed.map((f) => f.vendor).join(", ")} failed. Use the Remind button to send it again.` });
        else setFlash({ type: "success", msg: `${lead} They can answer in the Vendor Portal. Their prices will show here under "Price quotes".` });
      } else {
        const r = await api.post(`${SRC[source].base}/${orderId}/jobs/`, {
          vendor_id: vendor.id, item_ids: pickedItems.map((i) => i.id),
          vendor_price: price === "" ? null : price, due_date: due || null, instructions: note, send_email: emailOn,
        });
        setPayload(r.data);
        setPicked([]); setVendorIds([]); setPrice(""); setNote(""); setView("jobs");
        emailFlash(`${n} item${n !== 1 ? "s" : ""} assigned to ${vendor.name}.`, r.data.email);
      }
      onChanged();
    } catch (e) { setFormError(errorText(e)); }
    finally { setBusy(false); }
  };

  if (loading && !order) return <section className="card vw-loading">Loading order…</section>;
  if (error && !order) return <div className="vw-alert error">{error}</div>;
  if (!order) return null;

  const gotQuotes = quotes.filter((q) => q.status === "quoted").length;
  const waitQuotes = quotes.filter((q) => q.status === "enquiry" || q.status === "countered").length;  // waiting for the vendor
  const quoteMode = mode === "quote";

  return <div className="vw-work">
    {/* order summary strip */}
    <section className="card vw-summary">
      <div className="vw-summary-main">
        <span className="vw-avatar lg">{initials(party(order))}</span>
        <div>
          <div className="vw-summary-line"><h2>{order.order_no}</h2><SourceTag source={source} /><Badge kind="order" status={order.status} label={order.status_label} /></div>
          <p>{party(order)} · {order.phone || order.username}{manual && order.work_name ? ` · ${order.work_name}` : ""}</p>
        </div>
      </div>
      <dl className="vw-summary-facts">
        <div><dt>Ordered</dt><dd>{fmtDate(order.date)}</dd></div>
        <div><dt>Required delivery</dt><dd>{fmtDate(order.delivery_date)}</dd></div>
        <div><dt>Items</dt><dd>{order.items}</dd></div>
      </dl>
      <Link to={manual ? `/orders/${order.id}/edit` : `/shop-orders/${order.id}`} className="vw-link">Open full order <Icon name="arrowRight" size={14} /></Link>
      {order.instructions && <p className="vw-summary-note"><Icon name="info" size={15} /><span>{order.instructions}</span></p>}
    </section>

    {view === "request" && !closed && jobs.length > 0 && (free.length === 0
      ? <div className="vw-alert assigned"><Icon name="check" size={17} /> Already assigned: every item of this order is with {[...new Set(live.map((j) => j.vendor_name))].join(", ") || "a vendor"}.</div>
      : live.length > 0 && <div className="vw-alert partial"><Icon name="info" size={17} /> Partly assigned: {free.length} item{free.length !== 1 ? "s are" : " is"} still waiting for a vendor.</div>)}
    {closed && view === "request" && <div className="vw-alert warn"><Icon name="block" size={17} /> This order is {order.status_label.toLowerCase()}, so no new work can be assigned.</div>}
    {early && view === "request" && <div className="vw-alert warn"><Icon name="alert" size={17} /> Payment is not confirmed yet ({order.status_label}). You can still assign work, but it is usually done after payment.</div>}

    {/* what to look at: one part at a time instead of one very long page */}
    <div className="vw-views" role="tablist" aria-label="Order work">
      {!closed && <button type="button" role="tab" aria-selected={view === "request"} className={view === "request" ? "on" : ""} onClick={() => setView("request")}>
        <Icon name="send" size={15} /> New request {free.length > 0 && <em>{free.length} to give out</em>}</button>}
      <button type="button" role="tab" aria-selected={view === "quotes"} className={`${view === "quotes" ? "on " : ""}${gotQuotes > 0 ? "alert" : ""}`} onClick={() => setView("quotes")}>
        <Icon name="tag" size={15} /> Price quotes {quotes.length > 0 && <em>{gotQuotes > 0 ? `${gotQuotes} received` : `${waitQuotes} waiting`}</em>}</button>
      <button type="button" role="tab" aria-selected={view === "jobs"} className={view === "jobs" ? "on" : ""} onClick={() => setView("jobs")}>
        <Icon name="truck" size={15} /> Jobs on order {jobs.length > 0 && <em>{jobs.length}</em>}</button>
    </div>

    {view === "request" && !closed && <>
      {gotQuotes > 0 && <button type="button" className="vw-alert quote vw-alert-btn" onClick={() => setView("quotes")}>
        <Icon name="tag" size={17} /> <span>{gotQuotes} price quote{gotQuotes !== 1 ? "s" : ""} received - review and assign</span><Icon name="arrowRight" size={15} /></button>}
      {/* step 2: items */}
      <section className="card vw-step">
        <div className="vw-card-head">
          <h2>2 · Choose items for the vendor</h2>
          {free.length > 1 && <button type="button" className="vw-textbtn" onClick={() => setPicked(allOn ? [] : free.map((i) => i.id))}>{allOn ? "Clear all" : "Select all"}</button>}
        </div>
        {free.length === 0
          ? <div className="vw-empty small"><span className="vw-empty-ico ok"><Icon name="check" size={22} /></span><b>All items are assigned</b><p>Every item of this order is already with a vendor.</p></div>
          : <div className="vw-items">
              {free.map((i) => {
                const on = picked.includes(i.id);
                return <label key={i.id} className={`vw-item${on ? " on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(i.id)} />
                  <span className="vw-tick">{on && <Icon name="check" size={13} />}</span>
                  <span className="vw-item-body">
                    <b>{i.service_name}</b>
                    <span className="vw-specs">
                      {specLines(i.spec).map((s) => <span key={s} className="vw-spec">{s}</span>)}
                    </span>
                    <span onClick={(e) => { if (e.target.closest("a")) e.stopPropagation(); }}><FileChips itemId={i.id} files={i.files} /></span>
                  </span>
                  <span className="vw-qty"><small>Qty</small>{Number(i.qty).toLocaleString("en-IN")}</span>
                </label>;
              })}
            </div>}
      </section>

      {/* step 3: vendors (ask for a price, or assign directly) */}
      <section className="card vw-step">
        <div className="vw-card-head"><h2>3 · Choose {quoteMode ? "vendors to ask" : "a vendor"}</h2><span>{baseVendors.length === activeVendors.length ? `${activeVendors.length} active` : `${baseVendors.length} of ${activeVendors.length} active`}</span></div>
        <div className="vq-mode" role="tablist" aria-label="How to give the work out">
          <button type="button" role="tab" aria-selected={quoteMode} className={quoteMode ? "on" : ""} onClick={() => switchMode("quote")}>
            <Icon name="tag" size={15} /> Ask for price <small>recommended</small></button>
          <button type="button" role="tab" aria-selected={!quoteMode} className={!quoteMode ? "on" : ""} onClick={() => switchMode("assign")}>
            <Icon name="send" size={15} /> Assign directly <small>price already agreed</small></button>
        </div>
        {activeVendors.length > 0 && <p className="vw-rate-hint">{quoteMode
          ? "Tick every vendor you want a price from. Each one is asked what it will charge for the ticked items. Nothing is assigned until you accept a quote."
          : "The work goes straight to the vendor you pick, at the price you type in step 4."}{free.length > 0 && pickedItems.length === 0 && " Tick items first."}</p>}
        {activeVendors.length === 0
          ? <div className="vw-empty small"><span className="vw-empty-ico"><Icon name="users" size={22} /></span><b>No active vendors</b>
              <p>Add a vendor first, then come back to assign work.</p>
              <Link to="/settings?tab=vendors&view=add" className="vw-btn-link">Add vendor</Link></div>
          : <>
              {needWorks.length > 0 && (
                <div className="vw-match">
                  <span className="vw-match-txt">
                    <Icon name="info" size={15} />
                    {showAll ? "Showing all vendors. Best matches first for" : pickedItems.length > 1 ? "Showing vendors who do all of" : "Showing vendors who do"}
                    {needWorks.map((w) => <span key={w.key} className="vw-spec hit">{w.name}</span>)}
                  </span>
                  {(hiddenVendors > 0 || showAll) && <button type="button" className="vw-textbtn" onClick={() => setShowAll((s) => !s)}>{showAll ? "Show matching only" : `Show all vendors (${activeVendors.length})`}</button>}
                </div>
              )}
              {activeVendors.length > 5 && <div className="vw-search slim"><Icon name="search" size={16} /><input value={vq} onChange={(e) => setVq(e.target.value)} placeholder="Search vendor or work…" /></div>}
              <div className="vw-vendors" role={quoteMode ? "group" : "radiogroup"} aria-label="Vendor">
                {shownVendors.map((v) => {
                  const on = vendorIds.map(String).includes(String(v.id));
                  const asked = askedOf(v.id);
                  const past = basis.length > 0 ? pastFor(v.id) : null;
                  const hitKeys = new Set(hitsOf(v).map((w) => w.key));
                  const myWorks = (v.works || []).slice().sort((a, b) => Number(hitKeys.has(norm(b))) - Number(hitKeys.has(norm(a))));
                  return <button type="button" key={v.id} role={quoteMode ? "checkbox" : "radio"} aria-checked={on} className={`vw-vendor${on ? " on" : ""}`} onClick={() => pickVendor(v.id)}>
                    <span className="vw-avatar">{initials(v.name)}</span>
                    <span className="vw-vendor-body">
                      <b>{v.name}</b>
                      <small>{v.owner_name} · {v.phone}</small>
                      {myWorks.length > 0
                        ? <span className="vw-specs">{myWorks.slice(0, 4).map((s) => <span key={s} className={`vw-spec${hitKeys.has(norm(s)) ? " hit" : ""}`}>{s}</span>)}{myWorks.length > 4 && <span className="vw-spec more" title={myWorks.slice(4).join(", ")}>+{myWorks.length - 4}</span>}</span>
                        : v.specialties && <span className="vw-specs">{v.specialties.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4).map((s) => <span key={s} className="vw-spec">{s}</span>)}</span>}
                      {needWorks.length > 0 && !fits(v) && <span className="vw-nomatch">{hitKeys.size > 0 ? `Does ${hitKeys.size} of ${needWorks.length} works` : myWorks.length ? "Does not do this work" : "Works not set"}</span>}
                      {asked && <span className={`vq-vtag ${asked.status}`}>{asked.status === "quoted" ? `Quoted ${money(asked.quoted_price)}` : "Already asked · waiting for price"}</span>}
                      {past !== null && <span className="vq-past" title="What this vendor was paid for the same work on earlier jobs">Last paid ≈ {money(past)} for {rateScope}</span>}
                    </span>
                    <span className={`vw-load${v.open_jobs >= 5 ? " high" : ""}`}><b>{v.open_jobs}</b><small>open job{v.open_jobs !== 1 ? "s" : ""}</small></span>
                    <span className={`vw-radio${quoteMode ? "" : " round"}`}>{on && <Icon name="check" size={13} />}</span>
                  </button>;
                })}
                {shownVendors.length === 0 && (vTerm
                  ? <p className="vw-none">No vendor matches “{vq}”.</p>
                  : <div className="vw-nov">
                      <b>No vendor is marked for {needWorks.map((w) => w.name).join(", ")}</b>
                      <p>{unmarked > 0 ? `${unmarked} vendor${unmarked !== 1 ? "s have" : " has"} not marked any work yet. ` : ""}Mark this work on a vendor in Vendor Management, or show every vendor.</p>
                      <span><button type="button" className="vw-textbtn" onClick={() => setShowAll(true)}>Show all vendors ({activeVendors.length})</button>
                        <Link to="/settings?tab=vendors" className="vw-btn-link">Vendor Management</Link></span>
                    </div>)}
              </div>
            </>}
      </section>

      {/* step 4: terms */}
      <section className="card vw-step">
        <div className="vw-card-head"><h2>{quoteMode ? "4 · Needed by and message" : "4 · Price, due date and instructions"}</h2></div>
        {quoteMode
          ? <div className="vq-how"><Icon name="info" size={16} /><span>Each vendor gets a <b>price request</b> (items, quantities and specifications - no artwork yet) and replies with <b>one total price</b> in the Vendor Portal. When the quotes come in you assign the work to the vendor whose price is OK; the others are told they were not selected.</span></div>
          : null}
        <div className="vw-grid2">
          {!quoteMode && <label className="vw-field">Vendor price (₹) <small>optional</small>
            <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} onWheel={(e) => e.currentTarget.blur()} placeholder="What you will pay the vendor" /></label>}
          <label className="vw-field">{quoteMode ? "Needed by" : "Due date"}
            <input type="date" value={due} min={todayStr()} onChange={(e) => setDue(e.target.value)} />
            {order.delivery_date && <small>Shop needs it by {fmtDate(order.delivery_date)}</small>}</label>
        </div>
        {!quoteMode && vendor && pickedItems.length > 0 && (suggested !== null
          ? <div className="vw-suggest">
              <span><b>{vendor.name}</b> was paid about <b>{money(suggested)}</b> for similar work on earlier jobs.</span>
              {Number(price) === suggested
                ? <em><Icon name="check" size={13} /> Applied</em>
                : <button type="button" onClick={() => setPrice(String(suggested))}>Use {money(suggested)}</button>}
            </div>
          : <div className="vw-suggest none">No earlier job to compare with. Enter the price you agreed with {vendor.name}.</div>)}
        <label className="vw-field">{quoteMode ? "Message to the vendors" : "Instructions for the vendor"} <small>optional</small>
          <textarea rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder={quoteMode ? "Paper, finishing, delivery time, anything they need to know to price it…" : "Paper, finishing, packing, pickup time…"} /></label>
        <label className={`vw-check${emailOn ? " on" : ""}`}>
          <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
          <span className="vw-tick">{emailOn && <Icon name="check" size={13} />}</span>
          {quoteMode
            ? <span className="vw-check-body">
                <b>E-mail the price request</b>
                <small>{chosen.length > 0 ? <>Goes to {chosen.map((v) => v.email).join(", ")}. </> : "Goes to the vendors you choose. "}
                  Artwork files are not sent now - they go out when you assign the work. The vendors also see the request in their Vendor Portal.</small>
              </span>
            : <span className="vw-check-body">
                <b>E-mail the job and artwork files to the vendor</b>
                <small>{vendor ? <>Goes to <u>{vendor.email}</u>. </> : "Goes to the vendor you choose. "}
                  {pickedItems.length === 0 ? "Tick items to see the files." : attachCount > 0 ? `${attachCount} file${attachCount !== 1 ? "s" : ""} will be attached.` : "No stored files to attach."}
                  {" "}The vendor can also download them in the Vendor Portal.</small>
                {emailOn && emailOnlyCount > 0 && <small className="vw-warn"><Icon name="alert" size={13} /> {emailOnlyCount} file{emailOnlyCount !== 1 ? "s" : ""} exist only in the original order e-mail. Forward that e-mail to the vendor for them.</small>}
              </span>}
        </label>
      </section>

      {/* sticky action bar */}
      <div className="vw-bar">
        <div className="vw-bar-text">
          {pickedItems.length === 0 && chosen.length === 0
            ? <span className="muted">Select items and {quoteMode ? "vendors" : "a vendor"} to continue.</span>
            : quoteMode
              ? <span><b>{pickedItems.length}</b> item{pickedItems.length !== 1 ? "s" : ""}
                  <Icon name="arrowRight" size={14} /> ask <b>{chosen.length || "—"}</b> vendor{chosen.length !== 1 ? "s" : ""} for a price{due && <> · needed by <b>{fmtDate(due)}</b></>}</span>
              : <span><b>{pickedItems.length}</b> item{pickedItems.length !== 1 ? "s" : ""}
                  <Icon name="arrowRight" size={14} /> <b>{vendor ? vendor.name : "choose vendor"}</b>
                  {due && <> · due <b>{fmtDate(due)}</b></>}{price !== "" && <> · <b>{money(price)}</b></>}</span>}
          {formError && <span className="vw-bar-err">{formError}</span>}
        </div>
        <button type="button" className="primary vw-assign" disabled={busy || free.length === 0} onClick={submit}>
          <Icon name={quoteMode ? "mail" : "send"} size={16} /> {busy ? (quoteMode ? "Sending…" : "Assigning…") : quoteMode ? "Ask for price" : "Assign work"}
        </button>
      </div>
    </>}

    {/* price quotes: what the vendors answered */}
    {view === "quotes" && <section className="card vw-step vq-section">
      <div className="vw-card-head"><h2>Price quotes</h2><span>{gotQuotes} received{waitQuotes > 0 ? ` · ${waitQuotes} waiting` : ""}</span></div>
      {quotes.length === 0
        ? <div className="vw-empty small"><span className="vw-empty-ico"><Icon name="tag" size={22} /></span><b>No price requests yet</b>
            <p>Ask one or more vendors for a price. Their answers will show here so you can compare and assign.</p>
            {!closed && <button type="button" className="vw-btn-link" onClick={() => setView("request")}>Ask for price</button>}</div>
        : <>
            {gotQuotes > 0 && <p className="vq-hint">Compare the prices, then press <b>Assign</b> on the vendor whose price is OK - or use <b>Counter offer</b> to negotiate a better price first.</p>}
            <QuoteList quotes={quotes} free={free} rateMap={rateMap} closed={closed} onAct={onAct} onResend={onResend} onCounter={onCounter} />
            {!closed && free.length > 0 && <button type="button" className="vq-more" onClick={() => setView("request")}><Icon name="send" size={14} /> Ask more vendors</button>}
          </>}
    </section>}

    {/* jobs already on this order */}
    {view === "jobs" && <section className="card vw-step">
      <div className="vw-card-head"><h2>Jobs on this order</h2><span>{jobs.length} job{jobs.length !== 1 ? "s" : ""}</span></div>
      {jobs.length === 0
        ? <p className="vw-none">Nothing has been given to a vendor yet.</p>
        : <ul className="vw-joblist">
            {jobs.map((j) => <li key={j.id} className={isOverdue(j) ? "late" : ""}>
              <span className="vw-avatar">{initials(j.vendor_name)}</span>
              <div className="vw-job-main">
                <div className="vw-job-top"><b>{j.job_no}</b><SourceTag source={j.source} /><span>{j.vendor_name}</span><Badge status={j.status} label={JOB_LABEL[j.status] || j.status_label} />{isOverdue(j) && <span className="vw-late-tag">Overdue</span>}</div>
                <p>{j.items.join(", ")}</p>
                {j.files?.length > 0 && <span className="vw-files">
                  {j.files.map((f) => f.stored
                    ? <a key={`${f.item_id}-${f.idx}`} className="vw-file" href={`/api/admin/order-files/${f.item_id}/${f.idx}/`} title={`Download ${f.name}`}><Icon name="download" size={13} />{f.name}</a>
                    : <span key={`${f.item_id}-${f.idx}`} className="vw-file off" title="Only in the order e-mail"><Icon name="mail" size={13} />{f.name}</span>)}
                </span>}
                <div className="vw-job-meta">
                  <span><Icon name="calendar" size={13} /> {fmtDate(j.due_date)}</span>
                  <span><Icon name="tag" size={13} /> {money(j.vendor_price)}</span>
                </div>
                {j.vendor_note && <p className="vw-vnote"><Icon name="message" size={13} /> {j.vendor_note}</p>}
                {j.status === "rejected" && <p className="vw-vnote bad">The vendor declined this job. Assign these items to another vendor above.</p>}
              </div>
              <JobActions job={j} onEdit={onEdit} onAct={onAct} onResend={onResend} onCounter={onCounter} />
            </li>)}
          </ul>}
    </section>}
  </div>;
}

/* ------------------------------------------------------------------ tab 2: all jobs */
function JobsTab({ jobs, loading, vendors, filter, setFilter, onEdit, onAct, onResend, onCounter, onRefresh }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filter]);

  const rows = useMemo(() => {
    const t = filter.q.trim().toLowerCase();
    return jobs.filter((j) => {
      if (filter.status === "overdue" ? !isOverdue(j) : filter.status && j.status !== filter.status) return false;
      if (filter.vendor && String(j.vendor_id) !== String(filter.vendor)) return false;
      if (filter.source && j.source !== filter.source) return false;
      if (t && !`${j.job_no} ${j.order_no} ${j.vendor_name} ${j.party_name || ""} ${j.items.join(" ")}`.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [jobs, filter]);

  const count = (s) => (s === "overdue" ? jobs.filter(isOverdue).length : jobs.filter((j) => j.status === s).length);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
  const filtered = Boolean(filter.q || filter.status || filter.vendor || filter.source);
  const chips = [["", "All"], ...JOB_STATUS, ["overdue", "Overdue"]];

  return <>
    <section className="card vw-filters">
      <div className="vw-search"><Icon name="search" size={17} /><input value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="Search job no, order, vendor or item…" /></div>
      <label className="vw-sel">Vendor
        <select value={filter.vendor} onChange={(e) => setFilter({ ...filter, vendor: e.target.value })}>
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select></label>
      <label className="vw-sel">Order type
        <select value={filter.source} onChange={(e) => setFilter({ ...filter, source: e.target.value })}>
          <option value="">All orders</option><option value="shop">Shop orders</option><option value="manual">Manual orders</option>
        </select></label>
      <button type="button" className="vw-reset" disabled={!filtered} onClick={() => setFilter({ status: "", vendor: "", q: "", source: "" })}>Reset</button>
      <button type="button" className="vw-reset" onClick={onRefresh} disabled={loading}><Icon name="refresh" size={15} /> Refresh</button>
    </section>
    <div className="vw-chips wide">
      {chips.map(([key, label]) => <button type="button" key={label} className={`vw-chip${filter.status === key ? " on" : ""}${key === "overdue" ? " warn" : ""}`}
        onClick={() => setFilter({ ...filter, status: key })}>{label}{key !== "" && <em>{count(key)}</em>}</button>)}
    </div>

    <section className="card vw-table-card">
      <div className="vw-card-head pad"><h2>Vendor jobs</h2><span>{rows.length} job{rows.length !== 1 ? "s" : ""}</span></div>
      <div className="vw-table-wrap">
        <table className="vw-table">
          <thead><tr><th>Job</th><th>Vendor</th><th>Items</th><th>Due</th><th className="num">Vendor price</th><th>Status</th><th className="act">Actions</th></tr></thead>
          <tbody>
            {loading && jobs.length === 0 && [0, 1, 2].map((n) => <tr key={n} className="vw-skelrow"><td colSpan={7}><span /></td></tr>)}
            {shown.map((j) => <tr key={j.id} className={isOverdue(j) ? "late" : ""}>
              <td><b>{j.job_no}</b><small><SourceTag source={j.source} /> <Link to={orderLink(j.source, j.order_id)}>{j.order_no}</Link></small></td>
              <td><div className="vw-cell"><span className="vw-avatar sm">{initials(j.vendor_name)}</span><b>{j.vendor_name}</b></div></td>
              <td><span className="vw-clip">{j.items.join(", ")}</span>{j.files?.length > 0 && <small><Icon name="download" size={12} /> {j.files.length} artwork file{j.files.length !== 1 ? "s" : ""}</small>}{j.vendor_note && <small className="vw-clip note">“{j.vendor_note}”</small>}</td>
              <td className="nowrap">{fmtDate(j.due_date)}{isOverdue(j) && <small className="late-txt">Overdue</small>}</td>
              <td className="num">{money(j.vendor_price ?? j.quoted_price)}{j.vendor_price == null && j.quoted_price != null && <small>quoted</small>}</td>
              <td><Badge status={j.status} label={JOB_LABEL[j.status] || j.status_label} /></td>
              <td className="act"><JobActions job={j} onEdit={onEdit} onAct={onAct} onResend={onResend} onCounter={onCounter} showReassign /></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && <div className="vw-empty">
        <span className="vw-empty-ico"><Icon name="truck" size={24} /></span>
        <b>{filtered ? "No jobs match your filters" : "No vendor jobs yet"}</b>
        <p>{filtered ? "Try a different search or clear the filters." : "Assign a shop order to a vendor and it will show up here."}</p>
      </div>}
      <div className="vw-tpager">
        <span>Showing {rows.length ? (cur - 1) * PAGE_SIZE + 1 : 0}–{Math.min(cur * PAGE_SIZE, rows.length)} of {rows.length} jobs</span>
        <div>
          <button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>Previous</button>
          <span>Page {cur} of {pages}</span>
          <button type="button" disabled={cur >= pages} onClick={() => setPage(cur + 1)}>Next</button>
        </div>
      </div>
    </section>
  </>;
}

/* ------------------------------------------------------------------ page */
export default function VendorWork() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") === "jobs" ? "jobs" : "assign";
  const orderId = sp.get("order") || "";
  const source = sp.get("src") === "manual" ? "manual" : "shop";

  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [vendors, setVendors] = useState([]);
  const [filter, setFilter] = useState({ status: "", vendor: "", q: "", source: "" });
  const [flash, setFlash] = useState(null);
  const [editJob, setEditJob] = useState(null);
  const [counterJob, setCounterJob] = useState(null);   // the received quote Star Offset is answering with a counter offer
  const [refreshKey, setRefreshKey] = useState(0);

  const loadJobs = useCallback(() => {
    setJobsLoading(true);
    return api.get("/admin/vendor-jobs/").then((r) => setJobs(r.data.results || []))
      .catch((e) => setFlash({ type: "error", msg: errorText(e) }))
      .finally(() => setJobsLoading(false));
  }, []);
  const loadVendors = useCallback(() => api.get("/settings/vendors/").then((r) => setVendors(r.data.results || []))
    .catch((e) => setFlash({ type: "error", msg: errorText(e) })), []);

  useEffect(() => { loadJobs(); loadVendors(); }, [loadJobs, loadVendors]);
  useEffect(() => { if (!flash) return undefined; const t = setTimeout(() => setFlash(null), 5000); return () => clearTimeout(t); }, [flash]);

  const changed = () => { loadJobs(); loadVendors(); setRefreshKey((n) => n + 1); };
  const go = (patch) => {
    const n = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    setSp(n);
  };

  // one message for "assigned / e-mail sent" so a mail problem is never hidden
  const emailFlash = (lead, email) => {
    if (!email) setFlash({ type: "success", msg: `${lead} No e-mail was sent.` });
    else if (!email.sent) setFlash({ type: "warn", msg: `${lead} But the e-mail to ${email.to} failed. ${email.error || ""} Use the mail icon on the job to resend.` });
    else {
      const left = email.not_attached?.length || 0;
      if (email.attached === undefined) { setFlash({ type: "success", msg: `${lead} E-mail sent to ${email.to}.` }); return; }
      setFlash({ type: left ? "warn" : "success", msg: `${lead} E-mail sent to ${email.to} with ${email.attached} file${email.attached !== 1 ? "s" : ""}.${left ? ` ${left} file${left !== 1 ? "s were" : " was"} not attached (older order: forward the original e-mail).` : ""}` });
    }
  };

  const resend = async (job) => {
    const ask = job.status === "enquiry";
    if (!window.confirm(ask ? `E-mail the price request ${job.job_no} to ${job.vendor_name} again?` : `E-mail ${job.job_no} and its artwork files to ${job.vendor_name} again?`)) return;
    try {
      const r = await api.post(`/admin/vendor-jobs/${job.id}/send/`);
      emailFlash(`${job.job_no}:`, r.data.email);  // (a price request e-mail carries no files)
    } catch (e) { setFlash({ type: "error", msg: errorText(e) }); }
  };

  const act = async (job, status) => {
    const msg = {
      assigned: `Assign ${job.order_no} (${job.items.join(", ")}) to ${job.vendor_name} at ${money(job.quoted_price)}? The job and artwork files will be e-mailed to the vendor, and the other price requests for these items will be closed.`,
      not_selected: job.status === "quoted"
        ? `Mark the quote from ${job.vendor_name} (${money(job.quoted_price)}) as not suitable? The vendor will see it as "Not selected".`
        : `Withdraw the price request ${job.job_no} sent to ${job.vendor_name}?`,
      completed: `Mark ${job.job_no} as completed? Do this once you have collected the work from ${job.vendor_name}.`,
      cancelled: `Cancel ${job.job_no}? ${job.vendor_name} will no longer see it, and its items can be assigned again.`,
    }[status];
    if (!window.confirm(msg)) return;
    try {
      const r = await api.patch(`/admin/vendor-jobs/${job.id}/`, { status });
      if (status === "assigned") emailFlash(`${job.job_no} assigned to ${job.vendor_name} at ${money(job.quoted_price)}.`, r.data.email);
      else setFlash({ type: "success", msg: `${job.job_no} ${{ completed: "marked completed", cancelled: "cancelled", not_selected: "closed - not selected" }[status]}.` });
      changed();
    } catch (e) { setFlash({ type: "error", msg: errorText(e) }); }
  };

  const stat = (key) => (key === "overdue" ? jobs.filter(isOverdue).length : jobs.filter((j) => j.status === key).length);
  const openStat = (key) => { setFilter({ status: key, vendor: "", q: "", source: "" }); go({ tab: "jobs", order: "" }); };

  return <div className="vw-page">
    <div className="vw-head">
      <div><h1>Vendor Work</h1><p className="muted">Ask outside printers for a price, give a shop order (or part of it) to the one whose price is OK, and follow it until it is collected.</p></div>
    </div>

    <div className="vw-stats">
      {KPIS.map(([key, label, icon]) => <button type="button" key={key} className={`vw-stat ${key}`} onClick={() => openStat(key)}>
        <span className="vw-stat-ico"><Icon name={icon} size={17} /></span>
        <span className="vw-stat-text"><small>{label}</small><b>{jobsLoading && jobs.length === 0 ? "—" : stat(key)}</b></span>
      </button>)}
    </div>

    <div className="vw-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === "assign"} className={tab === "assign" ? "on" : ""} onClick={() => go({ tab: "" })}><Icon name="send" size={16} /> Assign work</button>
      <button type="button" role="tab" aria-selected={tab === "jobs"} className={tab === "jobs" ? "on" : ""} onClick={() => go({ tab: "jobs", order: "" })}><Icon name="truck" size={16} /> All vendor jobs <em>{jobs.length}</em></button>
    </div>

    {flash && <div className={`vw-alert ${flash.type}`} role="status">{flash.msg}</div>}

    {tab === "assign"
      ? <div className="vw-assign-grid">
          <OrderPicker source={source} selectedId={orderId} refreshKey={refreshKey} onSelect={(id) => go({ order: String(id) })} onSource={(src) => go({ src: src === "manual" ? "manual" : "", order: "" })} />
          <div className="vw-right">
            {orderId
              ? <OrderPanel source={source} orderId={orderId} vendors={vendors} refreshKey={refreshKey} onChanged={changed} onEdit={setEditJob} onAct={act} onResend={resend} onCounter={setCounterJob} setFlash={setFlash} emailFlash={emailFlash} />
              : <section className="card vw-placeholder">
                  <span className="vw-empty-ico big"><Icon name="truck" size={30} /></span>
                  <h2>Pick an order to start</h2>
                  <p>Choose a shop order or a manual order on the left. Then tick the items, pick a vendor and set the price and due date. One order can be split between several vendors.</p>
                  <ol>
                    <li><b>1</b> Choose order</li><li><b>2</b> Tick items</li><li><b>3</b> Pick vendor</li><li><b>4</b> Price &amp; date</li>
                  </ol>
                </section>}
          </div>
        </div>
      : <JobsTab jobs={jobs} loading={jobsLoading} vendors={vendors} filter={filter} setFilter={setFilter} onEdit={setEditJob} onAct={act} onResend={resend} onCounter={setCounterJob} onRefresh={changed} />}

    {counterJob && <CounterModal job={counterJob} onClose={() => setCounterJob(null)}
      onSaved={(msg, email) => { setCounterJob(null); if (email && !email.sent) setFlash({ type: "warn", msg: `${msg} But the e-mail to ${email.to} failed - the vendor can still see it in the Vendor Portal.` }); else setFlash({ type: "success", msg }); changed(); }} />}

    {editJob && <EditJobModal job={editJob} onClose={() => setEditJob(null)}
      onSaved={(msg) => { setEditJob(null); setFlash({ type: "success", msg }); changed(); }} />}
  </div>;
}