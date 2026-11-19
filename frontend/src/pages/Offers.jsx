import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";
import StatCard from "../components/StatCard";
import { OFFER_CATEGORIES, OFFER_GROUPS, offerBody, validityText } from "../lib/offers";
import "./offers.css";

// Compose + send an offer as a WhatsApp template message = /offers   (admin only)
// Sending takes ~1 second per customer, so the server does it in the background
// and this page shows live progress. A half-written offer can be saved as a draft.

const EMPTY = {
  title: "", message: "", valid_from: "", valid_until: "",
  group: "all", category: "all", shop_number: "", template: "special_discount_offer",
};

// The message a customer will get, drawn as a WhatsApp bubble
function Bubble({ form }) {
  const ready = form.title.trim() && form.message.trim();
  const shop = form.shop_number.trim() || "your shop number";
  return (
    <div className="of-phone">
      <div className="of-bubble">
        <span className="of-bubble-from">Star Offset Printing</span>
        {ready ? (
          <>
            {offerBody({ ...form, shop_number: shop }, "\u0000").split("\u0000").map((part, i) =>
              i === 0 ? part : <span key={i}><span className="of-bubble-name">Customer name</span>{part}</span>)}
          </>
        ) : (
          <span className="of-bubble-ph">Your offer title and message will appear here as customers will see it.</span>
        )}
        <time>now</time>
      </div>
    </div>
  );
}

export default function Offers() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const draftParam = sp.get("draft");

  const [form, setForm] = useState(EMPTY);
  const [summary, setSummary] = useState(null);   // stat cards + templates
  const [picked, setPicked] = useState([]);       // "Selected Customers": [{id, name, phone}]
  const [search, setSearch] = useState("");
  const [found, setFound] = useState([]);
  const [recipients, setRecipients] = useState(null); // how many people the current choice reaches
  const [draftId, setDraftId] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [job, setJob] = useState(null);           // {id, total, success, failed, done}
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [notice, setNotice] = useState("");
  const errRef = useRef(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const sending = busy || (job && !job.done);
  const selectedMode = form.group === "selected";
  const pickedKey = picked.map((c) => c.id).join(",");

  const loadSummary = () => api.get("/offers/summary/").then((r) => {
    setSummary(r.data);
    setForm((f) => ({ ...f, shop_number: f.shop_number || r.data.default_shop_number }));
  }).catch(() => {});

  useEffect(() => { if (user.is_superuser) loadSummary(); }, [user.is_superuser]);

  // reopen a saved draft (from the history page)
  useEffect(() => {
    if (!draftParam || !user.is_superuser) return;
    api.get(`/offers/history/${draftParam}/`).then((r) => {
      const d = r.data;
      if (d.status !== "draft") return;
      setDraftId(d.id);
      setForm((f) => ({
        ...f, title: d.title, message: d.message, group: d.group, category: d.category,
        valid_from: d.valid_from || "", valid_until: d.valid_until || "", shop_number: d.shop_number || f.shop_number,
      }));
      setPicked(d.customers || []);
    }).catch((e) => setMsg(errorText(e)));
  }, [draftParam, user.is_superuser]);

  // live recipient count whenever the audience changes
  useEffect(() => {
    if (!user.is_superuser) return;
    let alive = true;
    api.get("/offers/recipients/", { params: { group: form.group, category: form.category, ids: pickedKey } })
      .then((r) => alive && setRecipients(r.data.count))
      .catch(() => alive && setRecipients(null));
    return () => { alive = false; };
  }, [form.group, form.category, pickedKey, user.is_superuser]);

  // customer picker search
  useEffect(() => {
    if (!selectedMode || !user.is_superuser) return;
    let alive = true;
    const t = setTimeout(() => {
      api.get("/offers/customers/", { params: { q: search } })
        .then((r) => alive && setFound(r.data.customers)).catch(() => {});
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [search, selectedMode, user.is_superuser]);

  // poll progress while a send is running
  const jobId = job?.id;
  const jobDone = job?.done;
  useEffect(() => {
    if (!jobId || jobDone) return;
    const t = setInterval(() => {
      api.get(`/offers/${jobId}/progress/`).then((r) => {
        setJob(r.data);
        if (r.data.done) {
          setNotice(`Offer sent. Delivered: ${r.data.success}${r.data.failed ? `, failed: ${r.data.failed}` : ""}.`);
          setForm({ ...EMPTY, shop_number: form.shop_number });
          setPicked([]); setDraftId(null); loadSummary();
        }
      }).catch(() => {}); // a missed poll is fine, the next one will catch up
    }, 1500);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, jobDone]);

  if (!user.is_superuser) {
    return (<><h1>Offers</h1><div className="card">Only admin can send offers.</div></>);
  }

  const fail = (text) => { setMsg(text); setTimeout(() => errRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0); };

  // body shared by "save draft" and "send"
  const payload = () => ({ ...form, customer_ids: picked.map((c) => c.id) });

  const togglePick = (c) =>
    setPicked((p) => (p.some((x) => x.id === c.id) ? p.filter((x) => x.id !== c.id) : [...p, { id: c.id, name: c.name, phone: c.phone }]));
  const addAllFound = () =>
    setPicked((p) => [...p, ...found.filter((c) => !p.some((x) => x.id === c.id)).map(({ id, name, phone }) => ({ id, name, phone }))]);

  const reset = () => {
    setForm({ ...EMPTY, shop_number: summary?.default_shop_number || "" });
    setPicked([]); setDraftId(null); setMsg(""); setNotice("");
    if (draftParam) nav("/offers", { replace: true });
  };

  const saveDraft = async () => {
    setMsg(""); setNotice("");
    if (!form.title.trim()) return fail("Give the offer a title before saving a draft");
    setBusy(true);
    try {
      const r = await api.post("/offers/draft/", { ...payload(), id: draftId });
      setDraftId(r.data.id);
      setNotice("Draft saved. You can find it in Offer History.");
    } catch (err) { fail(errorText(err)); }
    setBusy(false);
  };

  const review = (e) => {
    e.preventDefault();
    setMsg(""); setNotice("");
    if (!form.title.trim()) return fail("Offer title is required");
    if (!form.message.trim()) return fail("Message is required");
    if (!form.shop_number.trim()) return fail("Shop contact number is required");
    if (form.valid_from && form.valid_until && form.valid_until < form.valid_from) return fail("“Valid until” cannot be before “Valid from”");
    if (selectedMode && picked.length === 0) return fail("Select at least one customer");
    if (recipients === 0) return fail("No customers with a phone number match this selection");
    setConfirm(true);
  };

  const send = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await api.post("/offers/send/", { ...payload(), draft_id: draftId });
      setJob(r.data);
      if (draftParam) nav("/offers", { replace: true });
    } catch (err) { setConfirm(false); fail(errorText(err)); }
    setBusy(false); setConfirm(false);
  };

  const done = job ? job.success + job.failed : 0;
  const template = summary?.templates?.find((t) => t.name === form.template);
  const audience = selectedMode
    ? `${picked.length} selected customer${picked.length === 1 ? "" : "s"}`
    : `${OFFER_GROUPS.find(([v]) => v === form.group)[1]} · ${OFFER_CATEGORIES.find(([v]) => v === form.category)[1]}`;

  return (
    <>
      <div className="of-head">
        <div>
          <h1>Offers</h1>
          <p className="muted">Create and send promotional offers to your customers through WhatsApp.</p>
        </div>
        <Link to="/offers/history"><button type="button">Offer History <Icon name="arrowRight" size={16} /></button></Link>
      </div>

      <div className="dash-stats of-stats">
        <StatCard label="Total Customers" value={summary?.total_customers ?? "–"} icon="users" tone="blue" />
        <StatCard label="Active Members" value={summary?.active_members ?? "–"} icon="card" tone="green" />
        <StatCard label="Offers Sent" value={summary?.offers_sent ?? "–"} icon="gift" tone="gold" />
      </div>

      {notice && <div className="success">{notice}</div>}

      {job && !job.done && (
        <div className="card of-progress" role="status">
          <strong>Sending… {done} of {job.total}</strong>
          <progress max={job.total} value={done} />
          <span className="muted">{job.success} sent{job.failed ? `, ${job.failed} failed` : ""}. You can leave this page; sending continues on the server.</span>
        </div>
      )}

      <form className="of-form" onSubmit={review}>
        {/* 1 ------------------------------------------------ */}
        <section className="card of-sec">
          <div className="of-sec-head"><span className="of-num">1</span><h3>Offer details</h3></div>
          <div className="of-sec-body">
            <label className="of-field"><span>Offer Title</span>
              <input maxLength={100} placeholder="e.g. Diwali Printing Offer" value={form.title} onChange={set("title")} disabled={sending} />
            </label>
            <label className="of-field"><span>Message</span>
              <textarea rows={4} placeholder="Describe the offer, discount and applicable print services..." value={form.message}
                onChange={set("message")} disabled={sending} />
              <span className="of-hint">Line breaks are removed when the message is sent over WhatsApp.</span>
            </label>
            <div className="of-row2">
              <label className="of-field"><span>Valid From <small>optional</small></span>
                <input type="date" value={form.valid_from} max={form.valid_until || undefined} onChange={set("valid_from")} disabled={sending} />
              </label>
              <label className="of-field"><span>Valid Until <small>optional</small></span>
                <input type="date" value={form.valid_until} min={form.valid_from || undefined} onChange={set("valid_until")} disabled={sending} />
              </label>
            </div>
          </div>
        </section>

        {/* 2 ------------------------------------------------ */}
        <section className="card of-sec">
          <div className="of-sec-head"><span className="of-num">2</span><h3>Recipients</h3></div>
          <div className="of-sec-body">
            <div>
              <p className="section-label">Send to</p>
              <div className="of-aud" role="radiogroup" aria-label="Send to">
                {OFFER_GROUPS.map(([v, l]) => (
                  <label key={v} className={`of-opt${form.group === v ? " on" : ""}${sending ? " off" : ""}`}>
                    <input type="radio" name="group" value={v} checked={form.group === v} onChange={set("group")} disabled={sending} />
                    <span className="of-dot" />{l}
                  </label>
                ))}
              </div>
            </div>

            {selectedMode ? (
              <div className="of-picker">
                <div className="search-box">
                  <Icon name="search" size={16} />
                  <input placeholder="Search customer by name or mobile" value={search} onChange={(e) => setSearch(e.target.value)} disabled={sending} />
                </div>
                <div className="of-picker-list">
                  {found.length === 0 && <div className="of-empty-sm">No customers found</div>}
                  {found.map((c) => (
                    <label key={c.id} className="of-pick">
                      <input type="checkbox" checked={picked.some((x) => x.id === c.id)} onChange={() => togglePick(c)} disabled={sending} />
                      <span>{c.name} <small>· {c.phone}{c.is_member ? " · Member" : ""}</small></span>
                    </label>
                  ))}
                </div>
                <div className="of-picker-bar">
                  <span className="muted">{picked.length} selected</span>
                  <div className="row">
                    <button type="button" onClick={addAllFound} disabled={sending || found.length === 0}>Add all shown</button>
                    <button type="button" onClick={() => setPicked([])} disabled={sending || picked.length === 0}>Clear</button>
                  </div>
                </div>
                {picked.length > 0 && (
                  <div className="of-chips">
                    {picked.map((c) => (
                      <span key={c.id} className="of-chip">{c.name}
                        <button type="button" aria-label={`Remove ${c.name}`} onClick={() => togglePick(c)} disabled={sending}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <label className="of-field"><span>Customer Category</span>
                <select value={form.category} onChange={set("category")} disabled={sending}>
                  {OFFER_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            )}

            <div className="of-recip">
              <span>Available recipients<b>{recipients ?? "…"}</b></span>
              <span className="muted">Customers without a phone number are skipped; a number saved twice is messaged once.</span>
            </div>
          </div>
        </section>

        {/* 3 + 4 -------------------------------------------- */}
        <div className="of-cols">
          <section className="card of-sec">
            <div className="of-sec-head"><span className="of-num">3</span><h3><Icon name="whatsapp" size={18} /> WhatsApp sender</h3></div>
            <div className="of-sec-body">
              <label className="of-field"><span>Shop Contact Number</span>
                <input inputMode="tel" maxLength={20} value={form.shop_number} onChange={set("shop_number")} disabled={sending} />
                <span className="of-hint">Shown to customers as the number to call.</span>
              </label>
              <label className="of-field"><span>Template</span>
                <select value={form.template} onChange={set("template")} disabled={sending}>
                  {(summary?.templates || [{ name: form.template, label: "Special discount offer" }]).map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
                </select>
              </label>
              {template && <div className="of-tpl-body">{template.body}</div>}
            </div>
          </section>

          <section className="card of-sec">
            <div className="of-sec-head"><span className="of-num">4</span><h3>Message preview</h3></div>
            <div className="of-sec-body">
              <Bubble form={form} />
              {(form.valid_from || form.valid_until) && <span className="muted">{validityText(form.valid_from, form.valid_until)}</span>}
            </div>
          </section>
        </div>

        {msg && <div className="error" role="alert" ref={errRef}>{msg}</div>}

        <div className="of-actions">
          <button type="button" onClick={reset} disabled={sending}>Cancel</button>
          <div className="right">
            <button type="button" onClick={saveDraft} disabled={sending}>Save Draft</button>
            <button className="primary" disabled={sending || recipients === 0}>
              <Icon name="send" size={16} />{sending ? "Sending…" : "Preview & Send Offer"}
            </button>
          </div>
        </div>
      </form>

      {confirm && (
        <div className="modal-bg">
          <div className="card modal wide" role="dialog" aria-modal="true" aria-label="Send offer" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h2 style={{ fontSize: 18 }}>Review & send</h2></div>
            <div className="modal-body" style={{ gap: 14 }}>
              <Bubble form={form} />
              <dl className="of-confirm-rows">
                <dt>Offer</dt><dd>{form.title.trim()}</dd>
                <dt>Audience</dt><dd>{audience}</dd>
                <dt>Recipients</dt><dd>{recipients}</dd>
                {(form.valid_from || form.valid_until) && <><dt>Validity</dt><dd>{validityText(form.valid_from, form.valid_until)}</dd></>}
              </dl>
              <span className="muted">Messages cannot be recalled once sent.</span>
            </div>
            <div className="modal-foot">
              <button disabled={busy} onClick={() => setConfirm(false)}>Back to edit</button>
              <button className="primary" disabled={busy} onClick={send}>{busy ? "Please wait…" : `Send to ${recipients} customer${recipients === 1 ? "" : "s"}`}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
