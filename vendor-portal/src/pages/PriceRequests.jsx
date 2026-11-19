import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import { fmtDate } from "../components/StatusChip";
import "../quotes.css";

// Vendor Portal > Price Requests (replaces the old Price List page)
// Star Offset asks "what will you charge for this work?" - the vendor answers with ONE total price (and an optional note).
// If Star Offset likes the price the request becomes a normal job in Assigned Work; otherwise it ends up under "Closed".
// NEGOTIATION: Star Offset can answer a price with its own "counter offer" (status "countered"). The vendor then accepts it,
// sends a new price, or says it cannot do the work. Once the vendor has agreed / priced, Star Offset assigns the work.
// API: GET /vendor/quotes/?status=open|closed   POST /vendor/quotes/<id>/ {action: "quote", price, note} | {action: "accept_counter", note} | {action: "decline", note}

const TABS = [["open", "Open"], ["closed", "Closed"]];
const rupees = (v) => (v === null || v === undefined || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pcs = (n) => `${Number(n || 0).toLocaleString("en-IN")} pcs`;

// how the price moved so far: you quoted -> Star Offset offered -> you accepted / quoted again ...
const STEP = {
  "vendor-quote": (p) => <>You quoted <b>{rupees(p)}</b></>,
  "admin-counter": (p) => <>Star Offset offered <b>{rupees(p)}</b></>,
  "vendor-accept": (p) => <>You accepted <b>{rupees(p)}</b></>,
};
function Negotiation({ steps }) {
  if (!steps || steps.length < 2) return null;  // a single quote is not a negotiation yet
  return (
    <div className="pr-neg">
      <small>Price history</small>
      <ol>
        {steps.map((s, i) => {
          const f = STEP[`${s.by}-${s.kind}`];
          return f ? <li key={i} className={s.by}><span>{f(s.price)}</span><em>{fmtDate(s.at)}</em>{s.note && <p>“{s.note}”</p>}</li> : null;
        })}
      </ol>
    </div>
  );
}

function QuoteCard({ q, onDone }) {
  const countered = q.status === "countered";
  const [price, setPrice] = useState(q.quoted_price || "");
  const [note, setNote] = useState(countered ? "" : q.vendor_note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [declining, setDeclining] = useState(false);
  const total = Number(price);
  const per = q.qty && total > 0 ? total / q.qty : null;
  const quoted = q.status === "quoted";

  const send = async (body) => {
    setBusy(true); setError("");
    try { await api.post(`/vendor/quotes/${q.id}/`, body); onDone(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  };
  const sendQuote = (e) => {
    e.preventDefault();
    if (!(total > 0)) { setError("Enter your total price for this work (more than 0)."); return; }
    send({ action: "quote", price, note });
  };
  const offer = Number(q.counter_price);
  const offerPer = q.qty && offer > 0 ? offer / q.qty : null;

  return (
    <article className={`pr-card ${q.status}`}>
      <header className="pr-head">
        <div><b>{q.order_no}</b></div>
        <span className={`vchip ${q.status}`}>{q.status_label}</span>
      </header>
      <div className="pr-meta">
        <span><Icon name="clock" size={14} /> Requested {fmtDate(q.requested_at)}</span>
        <span><Icon name="pin" size={14} /> Needed by {fmtDate(q.needed_by)}</span>
        <span><Icon name="box" size={14} /> {pcs(q.qty)} in total</span>
      </div>

      <ul className="pr-lines">
        {q.lines.map((l, i) => (
          <li key={i}>
            <div className="pr-line-top"><b>{l.service_name}</b><span>{pcs(l.qty)}</span></div>
            <div className="pr-specs">{(l.spec || []).filter((s) => s && s.value).map((s, j) => <span key={j}>{s.label}: <b>{s.value}</b></span>)}</div>
          </li>
        ))}
      </ul>

      {(q.message || q.order_note) && (
        <div className="pr-msg"><Icon name="chat" size={15} /><div><small>Message from Star Offset</small><p>{[q.message, q.order_note].filter(Boolean).join("\n")}</p></div></div>
      )}

      <Negotiation steps={q.negotiation} />

      {countered && (
        <div className="pr-offer">
          <div className="pr-offer-top"><Icon name="rupee" size={16} /><div>
            <small>Star Offset's counter offer</small>
            <b>{rupees(q.counter_price)}</b>
            <span>total{offerPer ? ` · ${rupees(offerPer)} per piece for ${pcs(q.qty)}` : ""} · sent {fmtDate(q.countered_at)}</span>
          </div></div>
          {q.quoted_price && <p className="pr-offer-was">Your last price was {rupees(q.quoted_price)}.</p>}
          {q.counter_note && <p className="pr-offer-note"><Icon name="chat" size={14} /> {q.counter_note}</p>}
          {!declining && (
            <div className="pr-offer-acts">
              <button type="button" className="aw-btn accent" disabled={busy} onClick={() => send({ action: "accept_counter", note })}>{busy ? "Sending…" : `Accept ${rupees(q.counter_price)}`}</button>
              <span>or send a different price below</span>
            </div>
          )}
        </div>
      )}

      {q.open ? (
        <form className="pr-form" onSubmit={sendQuote}>
          {error && <div className="alert error"><span>{error}</span></div>}
          {quoted && <p className="pr-state"><Icon name="checkcircle" size={15} /> You quoted <b>{rupees(q.quoted_price)}</b> on {fmtDate(q.quoted_at)}. Waiting for Star Offset to decide - you can still change your price.</p>}
          <div className="pr-grid">
            <div className="field">
              <label htmlFor={`pr-p-${q.id}`}>{countered ? "Your new price for this work (₹)" : "Your total price for this work (₹)"} {!countered && <b className="req">*</b>}</label>
              <input id={`pr-p-${q.id}`} type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} onWheel={(e) => e.currentTarget.blur()} placeholder="Enter the price for this work" />
              <small className="pr-per">{per ? `= ${rupees(per)} per piece for ${pcs(q.qty)}` : "One price for everything listed above."}</small>
            </div>
            <div className="field">
              <label htmlFor={`pr-n-${q.id}`}>Note <small>(optional)</small></label>
              <textarea id={`pr-n-${q.id}`} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={countered ? "e.g. I can do it at this price if the delivery is 2 days later." : "e.g. Can finish in 4 days. Price includes lamination."} />
            </div>
          </div>
          {declining && (
            <p className="pr-warn">Tell Star Offset why you cannot do this work (optional), then press <b>Confirm - cannot do</b>.</p>
          )}
          <div className="pr-actions">
            {!declining
              ? <button type="button" className="aw-btn" disabled={busy} onClick={() => setDeclining(true)}>I cannot do this work</button>
              : <>
                  <button type="button" className="aw-btn" disabled={busy} onClick={() => setDeclining(false)}>Back</button>
                  <button type="button" className="aw-btn danger" disabled={busy} onClick={() => send({ action: "decline", note })}>Confirm - cannot do</button>
                </>}
            {!declining && <button type="submit" className="aw-btn accent" disabled={busy}>{busy ? "Sending…" : countered ? "Send my new price" : quoted ? "Update my price" : "Send my price"}</button>}
          </div>
        </form>
      ) : (
        <div className="pr-closed">
          {q.status === "declined" && <p>You told Star Offset you cannot do this work.</p>}
          {q.status === "not_selected" && <p>{q.quoted_price ? <>Your price of <b>{rupees(q.quoted_price)}</b> was not selected.</> : "This request was closed by Star Offset."} Thank you for replying.</p>}
          {q.vendor_note && <p className="muted">Your note: {q.vendor_note}</p>}
        </div>
      )}
    </article>
  );
}

export default function PriceRequests() {
  const { reload } = useOutletContext() || {};
  const [tab, setTab] = useState("open");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setError("");
    api.get("/vendor/quotes/", { params: { status: tab }, signal: ctrl.signal })
      .then((r) => setData(r.data))
      .catch((e) => { if (e.code !== "ERR_CANCELED") { setError(errorText(e)); setData((d) => d || { results: [], counts: {} }); } });
    return () => ctrl.abort();
  }, [tab, tries]);

  const done = useCallback(() => { setTries((t) => t + 1); reload?.(); }, [reload]);
  const rows = data?.results || [];
  const c = data?.counts || {};

  return (
    <div className="pr">
      <div className="aw-head">
        <h1>Price Requests</h1>
        <p>Star Offset asks what you would charge for a piece of work. Send your price - Star Offset may accept it or offer a different price, and you can reply until you agree. Once agreed, the work is assigned to you.</p>
      </div>

      <div className="pr-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}<em>{k === "open" ? c.open ?? 0 : c.closed ?? 0}</em>
          </button>
        ))}
        {tab === "open" && c.waiting > 0 && <span className="pr-hint">{c.waiting} waiting for your reply</span>}
      </div>

      {error && <div className="alert error"><span>{error}</span><button type="button" onClick={() => setTries((t) => t + 1)}><Icon name="refresh" size={14} /> Retry</button></div>}
      {!data && !error && <div className="aw-card"><div className="aw-empty">Loading…</div></div>}
      {data && rows.length === 0 && !error && (
        <div className="aw-card"><div className="aw-empty">{tab === "open" ? "No price requests right now. New ones will appear here." : "No closed price requests yet."}</div></div>
      )}
      <div className="pr-list">{rows.map((q) => <QuoteCard key={`${q.id}-${q.status}-${q.quoted_at}-${q.countered_at}`} q={q} onDone={done} />)}</div>
    </div>
  );
}