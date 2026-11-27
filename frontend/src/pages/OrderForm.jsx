import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import CustomerForm from "../components/CustomerForm";
import { num } from "../lib/billing";
import { previewDigital, previewNormal, round2 } from "../lib/pricing";
import "./billing.css";
import "./orders.css";
import Icon from "../components/Icon";
import VisitingCardSetup from "../components/VisitingCardSetup";

// Add order  = /orders/new
// Edit order = /orders/:orderId/edit   (admin only)
// Order prices are list prices: no member / shop discounts (those are applied when the bill is made).

const DRAFT_KEY = "star_order_draft";
const RECENT_KEY = "star_order_recent"; // how often each category is ordered -> "Quick add" chips

const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const isoDate = (d) => d.toLocaleDateString("en-CA"); // yyyy-mm-dd, local time
const today = () => isoDate(new Date());
const plusDays = (from, n) => { const d = new Date(from + "T00:00:00"); d.setDate(d.getDate() + n); return isoDate(d); };
const nameOf = (list, id) => list.find((x) => String(x.id) === String(id))?.name || "";
const readJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full / blocked */ } };

const emptyForm = {
  categoryId: "", sizeId: "", variantId: "", qty: "", job: 1,
  dCategoryId: "", dGsmId: "", dProductId: "", dLaminationId: "", dSide: "single", dDeliveryId: "",
};
const emptyLists = { sizes: [], variants: [], gsms: [], products: [], laminations: [] };
const rateTypeOf = (c) => ((c?.category || "").toLowerCase() === "shop" ? "shop" : "customer");
const STEPS = [["customer", "Customer"], ["job", "Job details"], ["items", "Items"], ["payment", "Payment"]];

// One dropdown; when there is only a single choice it is shown as plain text (already picked)
function Pick({ list, value, onChange, label }) {
  return list.length === 1
    ? <div><div className="bl-lbl">{label}</div><div className="bl-static">{list[0].name}</div></div>
    : <label>{label}<select value={value} onChange={onChange}><option value="">Select</option>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>;
}

export default function OrderForm() {
  const { orderId } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const editing = Boolean(orderId);

  const [meta, setMeta] = useState({ categories: [], digital_categories: [], delivery_types: [] });
  const [customer, setCustomer] = useState(null);
  const [custText, setCustText] = useState("");
  const [suggestions, setSuggestions] = useState(null);
  const [custIdx, setCustIdx] = useState(0);
  const [showNewCust, setShowNewCust] = useState(false);
  const [rateType, setRateType] = useState("customer"); // which digital rate to use: customer | shop
  const [workName, setWorkName] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("pending");
  const [orderDate, setOrderDate] = useState(today());
  const [deliveryDate, setDeliveryDate] = useState("");
  const [advance, setAdvance] = useState("");
  const [advMode, setAdvMode] = useState("cash"); // cash | upi | bank
  const [advRef, setAdvRef] = useState("");
  const [items, setItems] = useState([]);
  const [mode, setMode] = useState("normal"); // normal | digital
  const [form, setForm] = useState(emptyForm);
  const [lists, setLists] = useState(emptyLists);
  const [preview, setPreview] = useState(null);
  const [svcText, setSvcText] = useState("");
  const [svcOpen, setSvcOpen] = useState(false);
  const [svcIdx, setSvcIdx] = useState(0);
  const [showJobs, setShowJobs] = useState(false);
  const [editingVisitingCard, setEditingVisitingCard] = useState(null);
  const [msg, setMsg] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [draft, setDraft] = useState(() => (editing ? null : readJSON(DRAFT_KEY, null)));
  const [recent, setRecent] = useState(() => readJSON(RECENT_KEY, {}));

  const custRef = useRef();
  const svcRef = useRef();
  const qtyRef = useRef();
  const searchTimer = useRef();
  const saveRef = useRef();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const focusQty = () => setTimeout(() => qtyRef.current?.focus(), 60);
  const focusService = () => setTimeout(() => svcRef.current?.focus(), 60);
  const backTo = `/orders?page=${sp.get("page") || 1}`;

  const total = useMemo(() => round2(items.reduce((s, i) => s + i.total, 0)), [items]);
  const advanceNum = Math.min(Math.max(num(advance), 0), total);
  const due = round2(total - advanceNum);

  /* ---------- load meta (+ order when editing) ---------- */
  useEffect(() => { api.get("/billing/meta/").then((r) => setMeta(r.data)); }, []);

  useEffect(() => {
    if (!editing) return;
    api.get(`/orders/${orderId}/`).then((r) => {
      const o = r.data;
      setCustomer(o.customer);
      setCustText(`${o.customer.name} - ${o.customer.phone}`);
      const digital = o.items.find((i) => i.billingType === "digital" && i.customerType);
      setRateType(digital ? digital.customerType : rateTypeOf(o.customer));
      setWorkName(o.work_name);
      setNotes(o.notes);
      setStatus(o.status);
      setOrderDate(o.order_date);
      setDeliveryDate(o.delivery_date);
      setAdvance(o.advance_paid ? String(o.advance_paid) : "");
      setAdvMode(["upi", "bank"].includes(o.advance_mode) ? o.advance_mode : "cash");
      setAdvRef(o.advance_reference || "");
      setItems(o.items);
    }).catch((e) => setMsg(errorText(e))).finally(() => setLoading(false));
  }, [orderId, editing]);

  /* ---------- customer search ---------- */
  const onCustInput = (v) => {
    setCustText(v);
    setCustIdx(0);
    clearTimeout(searchTimer.current);
    if (v.trim().length < 2) { setSuggestions(null); return; }
    searchTimer.current = setTimeout(() => {
      api.get("/customers/live-search/", { params: { q: v.trim() } })
        .then((r) => setSuggestions(r.data.customers)).catch(() => setSuggestions([]));
    }, 250);
  };
  const pickCustomer = (c) => {
    setCustomer(c); setCustText(`${c.name} - ${c.phone}`); setSuggestions(null);
    setRateType(rateTypeOf(c));
  };
  const changeCustomer = () => {
    setCustomer(null); setCustText(""); setSuggestions(null);
    setTimeout(() => custRef.current?.focus(), 60);
  };
  const onCustKey = (e) => {
    if (!suggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCustIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCustIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pickCustomer(suggestions[custIdx] || suggestions[0]); }
    else if (e.key === "Escape") setSuggestions(null);
  };

  /* ---------- cascading dropdowns (a list with a single choice is picked for you) ---------- */
  const load = async (url, params, key, pick) => {
    const r = await api.get(url, { params });
    const rows = pick(r.data);
    setLists((l) => ({ ...l, [key]: rows }));
    return rows;
  };

  const chooseSize = async (id) => {
    setForm((f) => ({ ...f, sizeId: id, variantId: "" }));
    setLists((l) => ({ ...l, variants: [] }));
    if (!id) return;
    const rows = await load("/billing/variants/", { size_id: id }, "variants", (d) => d.variants);
    if (rows.length === 1) { setForm((f) => ({ ...f, variantId: String(rows[0].id) })); focusQty(); }
  };
  const chooseCategory = async (c) => {
    const id = String(c.id);
    setSvcText(c.name); setSvcOpen(false);
    setForm((f) => ({ ...f, categoryId: id, sizeId: "", variantId: "" }));
    setLists((l) => ({ ...l, sizes: [], variants: [] }));
    const rows = await load("/billing/sizes/", { category_id: id }, "sizes", (d) => d.sizes);
    if (rows.length === 1) await chooseSize(String(rows[0].id));
  };

  const chooseServiceSuggestion = (c) => {
    if (c?.__visitingCard) {
      setSvcText("Visiting Card");
      setSvcOpen(false);
      setMode("digital");
      chooseDCategory(String(c.id));
      return;
    }
    chooseCategory(c);
  };

  const chooseDProduct = async (id) => {
    setForm((f) => ({ ...f, dProductId: id, dLaminationId: "" }));
    setLists((l) => ({ ...l, laminations: [] }));
    if (!id) return;
    const rows = await load("/billing/digital-laminations/", { product_id: id }, "laminations", (d) => d.laminations);
    if (rows.length === 1) { setForm((f) => ({ ...f, dLaminationId: String(rows[0].id) })); focusQty(); }
  };
  const chooseDGsm = async (id) => {
    setForm((f) => ({ ...f, dGsmId: id, dProductId: "", dLaminationId: "" }));
    setLists((l) => ({ ...l, products: [], laminations: [] }));
    if (!id) return;
    const rows = await load("/billing/digital-products/", { gsm_id: id }, "products", (d) => d.products);
    if (rows.length === 1) await chooseDProduct(String(rows[0].id));
  };
  const chooseDCategory = async (id) => {
    setForm((f) => ({ ...f, dCategoryId: id, dGsmId: "", dProductId: "", dLaminationId: "" }));
    setLists((l) => ({ ...l, gsms: [], products: [], laminations: [] }));
    if (!id || nameOf(meta.digital_categories, id).trim().toLowerCase() === "visiting card") return;
    const rows = await load("/billing/digital-gsm/", { category_id: id }, "gsms", (d) => d.gsms);
    if (rows.length === 1) await chooseDGsm(String(rows[0].id));
  };

  // a one-delivery-type shop never has to pick it
  useEffect(() => {
    if (meta.delivery_types.length === 1) setForm((f) => (f.dDeliveryId ? f : { ...f, dDeliveryId: String(meta.delivery_types[0].id) }));
  }, [meta.delivery_types]);

  const resetEntry = (nextMode = mode) => {
    setMode(nextMode);
    setForm({ ...emptyForm, dDeliveryId: meta.delivery_types.length === 1 ? String(meta.delivery_types[0].id) : "" });
    setPreview(null); setLists(emptyLists); setSvcText(""); setSvcOpen(false); setShowJobs(false); setEditingVisitingCard(null);
  };
  const switchMode = (m) => { resetEntry(m); if (m === "normal") focusService(); };

  /* ---------- service search + quick add ---------- */
  const catSelected = Boolean(form.categoryId);
  const isVisitingCard = mode === "digital" && nameOf(meta.digital_categories, form.dCategoryId).trim().toLowerCase() === "visiting card";
  const matches = useMemo(() => {
    const q = svcText.trim().toLowerCase();
    const rows = meta.categories.filter((c) => c.name.toLowerCase().includes(q));
    const visiting = meta.digital_categories.find((c) => c.name.trim().toLowerCase() === "visiting card");
    if (visiting && q && ["visiting card", "visting card", "business card"].some((term) => term.includes(q) || q.includes(term))) rows.unshift({ ...visiting, __visitingCard: true });
    return rows.slice(0, 8);
  }, [meta.categories, meta.digital_categories, svcText]);
  const quick = useMemo(
    () => [...meta.categories].sort((a, b) => (recent[b.id] || 0) - (recent[a.id] || 0)).slice(0, 6),
    [meta.categories, recent]
  );
  const onSvcInput = (v) => {
    setSvcText(v); setSvcOpen(true); setSvcIdx(0);
    if (form.categoryId) {
      setForm((f) => ({ ...f, categoryId: "", sizeId: "", variantId: "" }));
      setLists((l) => ({ ...l, sizes: [], variants: [] }));
    }
  };
  const onSvcKey = (e) => {
    if (!svcOpen || matches.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSvcIdx((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSvcIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); chooseServiceSuggestion(matches[svcIdx] || matches[0]); }
    else if (e.key === "Escape") setSvcOpen(false);
  };

  /* ---------- live price preview (list price, no discount) ---------- */
  useEffect(() => {
    let dead = false;
    let timer;
    const qty = num(form.qty);
    const job = num(form.job) || 1;

    if (mode === "digital") {
      const { dCategoryId, dGsmId, dProductId, dLaminationId, dSide, dDeliveryId } = form;
      if (!dCategoryId || !dGsmId || !dProductId || !dLaminationId || !dSide || !dDeliveryId || qty <= 0) { setPreview(null); return; }
      timer = setTimeout(() => {
        api.get("/billing/digital-price/", { params: { lamination_id: dLaminationId, side: dSide, delivery_type: dDeliveryId, qty } })
          .then((r) => {
            if (dead) return;
            setPreview(r.data.success ? previewDigital({ data: r.data, job, extraCharge: 0, customerType: rateType }) : null);
          }).catch(() => !dead && setPreview(null));
      }, 200);
      return () => { dead = true; clearTimeout(timer); };
    }

    const { categoryId, sizeId, variantId } = form;
    if (!categoryId || !sizeId || !variantId || qty <= 0) { setPreview(null); return; }
    timer = setTimeout(() => {
      api.get("/billing/price/", { params: { category_id: categoryId, size_id: sizeId, variant_id: variantId, qty, customer_type: rateType } })
        .then((r) => {
          if (dead) return;
          setPreview(previewNormal({
            category: nameOf(meta.categories, categoryId).toLowerCase(),
            size: nameOf(lists.sizes, sizeId).toLowerCase(),
            variant: nameOf(lists.variants, variantId).toLowerCase(),
            qty, job, extraCharge: 0, dbData: r.data,
            customerType: rateType, remainingOldDue: 0,
          }));
        }).catch(() => !dead && setPreview(null));
    }, 200);
    return () => { dead = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, mode, rateType, lists.sizes, lists.variants]);

  /* ---------- add / edit / remove item ---------- */
  const addItem = () => {
    const qty = num(form.qty);
    const job = num(form.job) || 1;
    if (mode === "digital") {
      if (!form.dCategoryId || !form.dGsmId || !form.dProductId || !form.dLaminationId || !form.dDeliveryId || qty <= 0) { setMsg("Select all digital print details and qty"); return; }
      if (!preview) { setMsg("No digital price found for this selection"); return; }
      const sideName = form.dSide === "double" ? "Double Side" : "Single Side";
      const delName = nameOf(meta.delivery_types, form.dDeliveryId);
      const name = [
        nameOf(meta.digital_categories, form.dCategoryId), nameOf(lists.gsms, form.dGsmId),
        nameOf(lists.products, form.dProductId), nameOf(lists.laminations, form.dLaminationId), sideName, delName,
      ].join(" - ");
      setItems((it) => [...it, {
        billingType: "digital", name, categoryId: form.dCategoryId, sizeId: form.dGsmId, variantId: form.dProductId,
        laminationId: form.dLaminationId, deliveryTypeId: form.dDeliveryId, side: form.dSide, sideName, customerType: rateType,
        qty, job, price: round2(preview.price), total: round2(preview.gross),
      }]);
    } else {
      if (!form.categoryId || !form.sizeId || !form.variantId || qty <= 0) { setMsg("Select service, size, variant and qty"); return; }
      if (!preview) { setMsg("No pricing rule found for this selection"); return; }
      const name = [nameOf(meta.categories, form.categoryId), nameOf(lists.sizes, form.sizeId), nameOf(lists.variants, form.variantId)].join(" - ");
      setItems((it) => [...it, {
        billingType: "normal", name, categoryId: form.categoryId, sizeId: form.sizeId, variantId: form.variantId,
        qty, job, price: round2(preview.price), total: round2(preview.gross),
      }]);
      const next = { ...recent, [form.categoryId]: (recent[form.categoryId] || 0) + 1 };
      setRecent(next); writeJSON(RECENT_KEY, next);
    }
    setMsg("");
    resetEntry();
    if (mode === "normal") focusService();
  };

  const editItem = async (index) => {
    const it = items[index];
    if (it.billingType === "visiting") {
      const visitingCategory = meta.digital_categories.find((c) => c.name.trim().toLowerCase() === "visiting card");
      if (!visitingCategory) { setMsg("Visiting Card setup is unavailable. Please refresh the page."); return; }
      setItems((list) => list.filter((_, i) => i !== index));
      setMsg(""); setShowJobs(false); setEditingVisitingCard(it.visitingCard || {});
      setRateType(it.visitingCard?.priceType === "shop" ? "shop" : "customer");
      setMode("digital"); setSvcText("");
      setForm({ ...emptyForm, dCategoryId: String(visitingCategory.id), qty: String(it.qty) });
      return;
    }
    if (!it.categoryId) { setMsg("This item's category no longer exists. Remove it and add it again."); return; }
    setItems((list) => list.filter((_, i) => i !== index));
    setMsg("");
    setShowJobs((it.job || 1) > 1);

    if (it.billingType === "digital") {
      setMode("digital"); setSvcText("");
      setForm({ ...emptyForm, qty: String(it.qty), job: it.job || 1, dCategoryId: String(it.categoryId), dGsmId: String(it.sizeId), dProductId: String(it.variantId),
        dLaminationId: String(it.laminationId), dSide: it.side || "single", dDeliveryId: String(it.deliveryTypeId) });
      const [gsms, products, laminations] = await Promise.all([
        api.get("/billing/digital-gsm/", { params: { category_id: it.categoryId } }).then((r) => r.data.gsms),
        api.get("/billing/digital-products/", { params: { gsm_id: it.sizeId } }).then((r) => r.data.products),
        api.get("/billing/digital-laminations/", { params: { product_id: it.variantId } }).then((r) => r.data.laminations),
      ]);
      setLists((l) => ({ ...l, gsms, products, laminations }));
      return;
    }

    setMode("normal");
    setSvcText(nameOf(meta.categories, it.categoryId));
    setForm({ ...emptyForm, categoryId: String(it.categoryId), sizeId: String(it.sizeId), variantId: String(it.variantId), qty: String(it.qty), job: it.job || 1 });
    const [sizes, variants] = await Promise.all([
      api.get("/billing/sizes/", { params: { category_id: it.categoryId } }).then((r) => r.data.sizes),
      api.get("/billing/variants/", { params: { size_id: it.sizeId } }).then((r) => r.data.variants),
    ]);
    setLists((l) => ({ ...l, sizes, variants }));
  };

  // Enter inside a number box of the item card adds the line
  const onEntryKey = (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target !== svcRef.current) {
      e.preventDefault();
      addItem();
    }
  };

  /* ---------- draft (this device only) ---------- */
  const saveDraft = () => {
    if (!customer && !workName.trim() && items.length === 0) { setMsg("Nothing to save yet"); return; }
    writeJSON(DRAFT_KEY, { customer, rateType, workName, notes, status, orderDate, deliveryDate, advance, advMode, advRef, items, at: Date.now() });
    setMsg(""); setNotice("Draft saved on this device. It will be offered the next time you create an order.");
  };
  const restoreDraft = () => {
    const d = draft;
    setDraft(null);
    if (!d) return;
    setRateType(d.rateType || "customer"); setWorkName(d.workName || ""); setNotes(d.notes || ""); setStatus(d.status || "pending");
    setOrderDate(d.orderDate || today()); setDeliveryDate(d.deliveryDate || ""); setAdvance(d.advance || "");
    setAdvMode(d.advMode || "cash"); setAdvRef(d.advRef || ""); setItems(d.items || []);
    if (d.customer?.id) { setCustomer(d.customer); setCustText(`${d.customer.name} - ${d.customer.phone}`); }
  };
  const discardDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } setDraft(null); };

  /* ---------- save ---------- */
  const fail = (text) => { setMsg(text); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const save = async () => {
    if (busy) return;
    if (!customer) return fail("Please select a customer");
    if (!workName.trim()) return fail("Please enter the work name");
    if (!deliveryDate) return fail("Please select the delivery date");
    if (items.length === 0) return fail("Add at least one item");
    setBusy(true); setMsg("");
    const body = {
      customer_id: customer.id, work_name: workName.trim(), notes, status,
      order_date: orderDate, delivery_date: deliveryDate, advance_paid: advanceNum,
      advance_mode: advMode, advance_reference: advanceNum > 0 ? advRef.trim() : "", items,
    };
    try {
      if (editing) await api.put(`/orders/${orderId}/`, body);
      else await api.post("/orders/", body);
      discardDraft();
      nav(backTo);
    } catch (e) { fail(errorText(e)); setBusy(false); }
  };

  useEffect(() => { saveRef.current = save; });
  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); saveRef.current?.(); } };
    // mouse wheel / trackpad scroll must never change a number box: drop focus before the browser applies the scroll
    const onWheel = () => {
      const a = document.activeElement;
      if (a && a.tagName === "INPUT" && a.type === "number") a.blur();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("wheel", onWheel, { capture: true }); };
  }, []);

  const cancel = () => {
    if (!editing && (items.length > 0 || workName.trim()) && !window.confirm("Discard this order?")) return;
    nav(backTo);
  };

  if (editing && !user.is_superuser) return <div className="error">Only admin can edit orders.</div>;
  if (loading) return <p>Loading…</p>;

  /* ---------- view helpers ---------- */
  const done = { customer: Boolean(customer), job: Boolean(workName.trim() && deliveryDate), items: items.length > 0, payment: items.length > 0 };
  const current = STEPS.find(([k]) => !done[k])?.[0] || "payment";
  const goto = (key) => document.getElementById(`od-sec-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const custType = rateTypeOf(customer);
  const lineTotal = preview ? round2(preview.gross) : 0;
  const deliveryChips = [["Today", 0], ["Tomorrow", 1], ["+3 days", 3], ["+1 week", 7]];

  return (
    <div className="od-form">
      <div className="od-head">
        <div>
          <h1>{editing ? `Edit Order W${String(orderId).padStart(3, "0")}` : "Create Print Order"}</h1>
          <p className="muted">{editing ? "Update the job, items and advance." : "Register a job, add print items and record the advance."}</p>
        </div>
        <Link to={backTo}><button type="button">← Back to Orders</button></Link>
      </div>

      {msg && <div className="error">{msg}</div>}
      {notice && <div className="success">{notice}</div>}
      {draft && (
        <div className="bl-banner" style={{ marginBottom: 14 }}>
          <span>Unsaved draft found{draft.at ? ` (${new Date(draft.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })})` : ""}.</span>
          <span className="bl-spacer" />
          <button type="button" className="primary" onClick={restoreDraft}>Restore</button>
          <button type="button" onClick={discardDraft}>Discard</button>
        </div>
      )}

      <div className="od-steps">
        {STEPS.map(([key, label], i) => (
          <div key={key} style={{ display: "contents" }}>
            {i > 0 && <span className={`od-step-line${done[STEPS[i - 1][0]] ? " done" : ""}`} />}
            <button type="button" className={`od-step${done[key] && key !== "payment" ? " done" : ""}${current === key ? " now" : ""}`} onClick={() => goto(key)}>
              <i>{done[key] && key !== "payment" ? "✓" : `0${i + 1}`}</i>{label}
            </button>
          </div>
        ))}
      </div>

      {/* 1. CUSTOMER */}
      <section id="od-sec-customer" className="card od-sec">
        <div className="od-sec-head">
          <h3>1. Customer details</h3>
          <button type="button" onClick={() => setShowNewCust(true)}>+ New Customer</button>
        </div>
        <div className="od-sec-body">
          {!customer ? (
            <div className="bl-combo">
              <input ref={custRef} autoFocus={!editing} placeholder="Search by name or mobile number…" value={custText}
                onChange={(e) => onCustInput(e.target.value)} onKeyDown={onCustKey} />
              {suggestions && (
                <div className="suggest bl-pop">
                  {suggestions.length === 0 && <div className="suggest-item muted">No customer found</div>}
                  {suggestions.map((c, i) => (
                    <div key={c.id} className={`suggest-item${i === custIdx ? " on" : ""}`} onClick={() => pickCustomer(c)}>
                      <strong>{c.name}</strong> · {c.phone} <span className="muted">· {c.category}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bl-cust">
              <div className="bl-cust-main">
                <b>{customer.name}</b> · {customer.phone} <span className={`bl-tag${custType === "shop" ? " shop" : ""}`}>{customer.category}</span>
              </div>
              <button type="button" onClick={changeCustomer}>Change</button>
            </div>
          )}
        </div>
      </section>

      {/* 2. JOB DETAILS */}
      <section id="od-sec-job" className="card od-sec">
        <div className="od-sec-head"><h3>2. Job details</h3></div>
        <div className="od-sec-body">
          <div className="od-grid">
            <label className="span2">Work / job name
              <input placeholder="e.g. Wedding Invitation" value={workName} onChange={(e) => setWorkName(e.target.value)} />
            </label>
            <label>Order status
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="pending">Pending</option>
                <option value="progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="delivered">Delivered</option>
                {status === "cancelled" && <option value="cancelled">Cancelled</option>}
              </select>
            </label>
            <label>Order date
              <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </label>
            <label>Expected delivery date
              <input type="date" value={deliveryDate} min={orderDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </label>
            <div className="span2">
              <div className="bl-lbl" style={{ marginBottom: 4 }}>Quick delivery date</div>
              <div className="bl-chips">
                {deliveryChips.map(([label, n]) => (
                  <button key={label} type="button" className={`bl-chip${deliveryDate === plusDays(orderDate, n) ? " on" : ""}`}
                    onClick={() => setDeliveryDate(plusDays(orderDate, n))}>{label}</button>
                ))}
              </div>
            </div>
            <label className="span4">Job notes
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional instructions for the printing team" />
            </label>
          </div>
        </div>
      </section>

      {/* 3. PRINT ITEMS */}
      <section id="od-sec-items" className="card od-sec">
        <div className="od-sec-head">
          <h3>3. Print items</h3>
          <div className="bl-seg">
            {[["normal", "Print"]].map(([k, label]) => (
              <button key={k} type="button" className={(mode === "digital" ? "normal" : mode) === k ? "on" : ""} onClick={() => switchMode(k)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="od-sec-body" onKeyDown={onEntryKey}>
          {mode === "normal" && (
            <>
              <div className="bl-combo">
                <input ref={svcRef} placeholder="Search service — e.g. visiting card, bill book, flex…" value={svcText}
                  onChange={(e) => onSvcInput(e.target.value)} onFocus={() => !catSelected && setSvcOpen(true)}
                  onBlur={() => setTimeout(() => setSvcOpen(false), 150)} onKeyDown={onSvcKey} />
                {svcOpen && !catSelected && matches.length > 0 && (
                  <div className="suggest bl-pop">
                    {matches.map((c, i) => (
                      <div key={c.id} className={`suggest-item${i === svcIdx ? " on" : ""}`} onMouseDown={() => chooseServiceSuggestion(c)}>{c.name}</div>
                    ))}
                  </div>
                )}
              </div>
              {!catSelected && quick.length > 0 && (
                <div className="bl-chips">
                  <span className="bl-lbl">Quick add:</span>
                  {quick.map((c) => <button key={c.id} type="button" className="bl-chip" onClick={() => chooseCategory(c)}>{c.name}</button>)}
                </div>
              )}
              {catSelected && (
                <div className="bl-row">
                  {lists.sizes.length > 0 && <Pick label="Size" list={lists.sizes} value={form.sizeId} onChange={(e) => chooseSize(e.target.value)} />}
                  {lists.variants.length > 0 && (
                    <Pick label="Variant" list={lists.variants} value={form.variantId}
                      onChange={(e) => { setForm((f) => ({ ...f, variantId: e.target.value })); if (e.target.value) focusQty(); }} />
                  )}
                  <label>Quantity<input ref={qtyRef} type="number" min="1" placeholder="Qty" value={form.qty} onChange={set("qty")} /></label>
                </div>
              )}
            </>
          )}

          {mode === "digital" && (
            <>
              {!isVisitingCard && <div className="bl-chips">
                {meta.digital_categories.map((c) => (
                  <button key={c.id} type="button" className={`bl-chip${String(c.id) === form.dCategoryId ? " on" : ""}`}
                    onClick={() => chooseDCategory(String(c.id))}>{c.name}</button>
                ))}
              </div>}
              {form.dCategoryId && (isVisitingCard ? (
                <VisitingCardSetup initial={editingVisitingCard || undefined} priceType={rateType} onAdd={(item) => {
                  setItems((rows) => [...rows, item]);
                  setMsg(""); setNotice("Visiting Card added with calculated price."); resetEntry("normal");
                }} />
              ) : (
                <>
                  <div className="bl-row">
                    {lists.gsms.length > 0 && <Pick label="GSM" list={lists.gsms} value={form.dGsmId} onChange={(e) => chooseDGsm(e.target.value)} />}
                    {lists.products.length > 0 && <Pick label="Product" list={lists.products} value={form.dProductId} onChange={(e) => chooseDProduct(e.target.value)} />}
                    {lists.laminations.length > 0 && (
                      <Pick label="Lamination" list={lists.laminations} value={form.dLaminationId}
                        onChange={(e) => { setForm((f) => ({ ...f, dLaminationId: e.target.value })); if (e.target.value) focusQty(); }} />
                    )}
                  </div>
                  <div className="bl-chips">
                    <span className="bl-lbl">Side:</span>
                    {[["single", "Single"], ["double", "Double"]].map(([k, label]) => (
                      <button key={k} type="button" className={`bl-chip${form.dSide === k ? " on" : ""}`} onClick={() => setForm((f) => ({ ...f, dSide: k }))}>{label}</button>
                    ))}
                    {meta.delivery_types.length > 1 && <span className="bl-lbl" style={{ marginLeft: 10 }}>Delivery:</span>}
                    {meta.delivery_types.length > 1 && meta.delivery_types.map((d) => (
                      <button key={d.id} type="button" className={`bl-chip${String(d.id) === form.dDeliveryId ? " on" : ""}`}
                        onClick={() => setForm((f) => ({ ...f, dDeliveryId: String(d.id) }))}>{d.name}</button>
                    ))}
                    <span className="bl-lbl" style={{ marginLeft: 10 }}>Rate:</span>
                    {[["customer", "Customer"], ["shop", "Shop"]].map(([k, label]) => (
                      <button key={k} type="button" className={`bl-chip${rateType === k ? " on" : ""}`} onClick={() => setRateType(k)}>{label}</button>
                    ))}
                  </div>
                  <div className="bl-row">
                    <label>Quantity<input ref={qtyRef} type="number" min="1" placeholder="Qty" value={form.qty} onChange={set("qty")} /></label>
                  </div>
                </>
              ))}
            </>
          )}

          {!isVisitingCard && (showJobs ? (
            <div className="bl-row">
              <label>Jobs<input type="number" min="1" value={form.job} onChange={set("job")} /></label>
            </div>
          ) : (
            <button type="button" className="link-btn" style={{ alignSelf: "flex-start" }} onClick={() => setShowJobs(true)}>+ Multiple jobs</button>
          ))}

          {!isVisitingCard && <div className="bl-add">
            <div className="bl-readout grow">
              {preview ? (
                <>
                  <div><small>Unit price</small><b>{money(preview.price)}</b></div>
                  <div className="bl-total">{money(lineTotal)}</div>
                </>
              ) : <span className="muted">Pick the service and quantity — the price fills in automatically.</span>}
            </div>
            <button type="button" className="primary big" onClick={addItem}>+ Add</button>
          </div>}

          <div className="table-wrap" style={{ padding: 0 }}>
            <table className="od-items-table">
              <thead>
                <tr><th>#</th><th>Item / specification</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Total</th><th /></tr>
              </thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={6} className="od-empty">No items yet. Add the first item above.</td></tr>}
                {items.map((i, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td>{i.name}{(i.job || 1) > 1 && <small> × {i.job} jobs</small>}</td>
                    <td className="num">{i.qty}</td>
                    <td className="num">{money(i.price)}</td>
                    <td className="num"><b>{money(i.total)}</b></td>
                    <td className="actions">
                      <button type="button" title="Edit" onClick={() => editItem(idx)}><Icon name="edit" size={15} /></button>
                      <button type="button" title="Remove" className="danger" onClick={() => setItems((l) => l.filter((_, k) => k !== idx))}><Icon name="close" size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {items.length > 0 && <tfoot><tr><td colSpan={4} className="num">Subtotal</td><td className="num">{money(total)}</td><td /></tr></tfoot>}
            </table>
          </div>
        </div>
      </section>

      {/* 4. PAYMENT */}
      <section id="od-sec-payment" className="card od-sec">
        <div className="od-sec-head"><h3>4. Payment &amp; order summary</h3></div>
        <div className="od-sec-body">
          <div className="od-pay">
            <div className="od-pay-col">
              <div className="srow"><span>Items subtotal</span><b>{money(total)}</b></div>
              <div className="muted">Discounts are applied when the bill is made.</div>
              <div className="od-total-row"><span>Grand total</span><span>{money(total)}</span></div>
            </div>
            <div className="od-pay-col">
              <label>Advance paid ₹
                <input type="number" min="0" placeholder="0" value={advance} onChange={(e) => setAdvance(e.target.value)} />
              </label>
              {num(advance) > total && total > 0 && <div className="muted">Advance can't be more than the total. It will be saved as {money(total)}.</div>}
              <div className="bl-pay-opts">
                {[["None", 0], ["25%", 0.25], ["50%", 0.5], ["Full", 1]].map(([label, f]) => (
                  <button key={label} type="button" disabled={total <= 0} onClick={() => setAdvance(f === 0 ? "" : String(Math.round(total * f)))}>{label}</button>
                ))}
              </div>
              {advanceNum > 0 && (
                <>
                  <div>
                    <div className="bl-lbl" style={{ marginBottom: 4 }}>Payment mode</div>
                    <div className="bl-seg">
                      {[["cash", "Cash"], ["upi", "UPI"], ["bank", "Bank"]].map(([k, label]) => (
                        <button key={k} type="button" className={advMode === k ? "on" : ""} onClick={() => setAdvMode(k)}>{label}</button>
                      ))}
                    </div>
                  </div>
                  {advMode !== "cash" && (
                    <label>Reference
                      <input placeholder={advMode === "upi" ? "UPI transaction ID (optional)" : "Cheque / transfer no. (optional)"} maxLength={100}
                        value={advRef} onChange={(e) => setAdvRef(e.target.value)} />
                    </label>
                  )}
                </>
              )}
              <div className={`od-balance${due > 0 ? "" : " clear"}`}>
                <span>{due > 0 ? "Balance due" : "Fully paid"}</span><span>{money(due)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="od-bar">
        <span className="od-bar-msg">{msg}</span>
        <button type="button" onClick={cancel}>Cancel</button>
        {!editing && <button type="button" disabled={busy} onClick={saveDraft}>Save Draft</button>}
        <button type="button" className="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : editing ? "Update Order" : "Save Order"}</button>
      </div>

      {showNewCust && (
        <CustomerForm
          initial={{}}
          onClose={() => setShowNewCust(false)}
          onSaved={(c) => {
            setShowNewCust(false);
            if (c?.id) pickCustomer(c);
            else setNotice("Customer created. Search for them above to select.");
          }}
        />
      )}
    </div>
  );
}
