import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import CustomerForm from "../components/CustomerForm";
import { num } from "../lib/billing";
import { previewDigital, previewNormal, round2 } from "../lib/pricing";
import "./billing.css";
import "./orders.css";
import "./quotations.css";

// Add quotation  = /quotations/new
// Edit quotation = /quotations/:quotationId/edit   (admin only)
// A quotation is for anyone: pick an existing customer (name + mobile fill in) or just type them.
// Prices are list prices, no member / shop discounts; an overall discount and extra charges can be
// added in the summary. Digital print uses the customer or shop rate. "OTHERS" = custom item + price.

const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd, local time
const nameOf = (list, id) => list.find((x) => String(x.id) === String(id))?.name || "";
const emptyForm = {
  categoryId: "", sizeId: "", variantId: "", qty: "", job: 1, manualName: "", manualPrice: "",
  dCategoryId: "", dGsmId: "", dProductId: "", dLaminationId: "", dSide: "", dDeliveryId: "", dQty: "", dJob: 1,
};
const emptyLists = { sizes: [], variants: [], gsms: [], products: [], laminations: [] };

// "Visiting Card, Bill Book" - the list's Work column when the user does not type one
const workFromItems = (items) =>
  [...new Set(items.map((i) => (i.billingType === "manual" ? i.name : i.name.split(" - ")[0]).trim()).filter(Boolean))]
    .join(", ").slice(0, 200);

export default function QuotationForm() {
  const { quotationId } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const editing = Boolean(quotationId);

  const [meta, setMeta] = useState({ categories: [], digital_categories: [], delivery_types: [] });
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [linked, setLinked] = useState(null);           // existing customer picked from the search
  const [suggestions, setSuggestions] = useState(null);
  const [custIdx, setCustIdx] = useState(0);
  const [showNewCust, setShowNewCust] = useState(false);
  const [workName, setWorkName] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [discount, setDiscount] = useState("");
  const [extraCharge, setExtraCharge] = useState("");
  const [quotationDate, setQuotationDate] = useState(today());
  const [validUntil, setValidUntil] = useState("");
  const [rateType, setRateType] = useState("customer"); // which digital rate to use: customer | shop
  const [items, setItems] = useState([]);
  const [editIndex, setEditIndex] = useState(-1);       // item being edited (stays in the table until Update)
  const [mode, setMode] = useState("normal");
  const [form, setForm] = useState(emptyForm);
  const [lists, setLists] = useState(emptyLists);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);
  const searchTimer = useRef();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const backTo = `/quotations?page=${sp.get("page") || 1}&q=${encodeURIComponent(sp.get("q") || "")}`;
  const leaveTo = editing ? backTo : "/quotations";
  const isManual = mode === "normal" && form.categoryId === "manual";

  const subtotal = useMemo(() => round2(items.reduce((s, i) => s + i.total, 0)), [items]);
  const discountAmt = Math.max(num(discount), 0);
  const extraAmt = Math.max(num(extraCharge), 0);
  const grandTotal = round2(subtotal - discountAmt + extraAmt);

  /* ---------- load meta (+ quotation when editing) ---------- */
  useEffect(() => { api.get("/billing/meta/").then((r) => setMeta(r.data)); }, []);

  useEffect(() => {
    if (!editing) return;
    api.get(`/quotations/${quotationId}/`).then((r) => {
      const q = r.data;
      setCustomerName(q.customer_name);
      setCustomerPhone(q.customer_phone);
      setWorkName(q.work_name);
      setNotes(q.notes);
      setTerms(q.terms || "");
      setDiscount(q.discount ? String(q.discount) : "");
      setExtraCharge(q.extra_charge ? String(q.extra_charge) : "");
      setQuotationDate(q.quotation_date);
      setValidUntil(q.valid_until || "");
      setRateType(q.items.some((i) => i.billingType === "digital" && i.customerType === "shop") ? "shop" : "customer");
      setItems(q.items);
    }).catch((e) => setMsg(errorText(e))).finally(() => setLoading(false));
  }, [quotationId, editing]);

  /* ---------- customer search (optional - a name and number can also just be typed) ---------- */
  const onNameInput = (v) => {
    setCustomerName(v);
    setLinked(null);
    setCustIdx(0);
    clearTimeout(searchTimer.current);
    if (v.trim().length < 2) { setSuggestions(null); return; }
    searchTimer.current = setTimeout(() => {
      api.get("/customers/live-search/", { params: { q: v.trim() } })
        .then((r) => setSuggestions(r.data.customers)).catch(() => setSuggestions([]));
    }, 250);
  };
  const pickCustomer = (c) => {
    setCustomerName(c.name); setCustomerPhone(c.phone); setLinked(c); setSuggestions(null);
    setRateType((c.category || "").toLowerCase() === "shop" ? "shop" : "customer");
  };
  const onNameKey = (e) => {
    if (!suggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCustIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCustIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pickCustomer(suggestions[custIdx] || suggestions[0]); }
    else if (e.key === "Escape") setSuggestions(null);
  };

  /* ---------- cascading dropdown loaders ---------- */
  const load = async (url, params, key, pick) => {
    const r = await api.get(url, { params });
    const rows = pick(r.data);
    setLists((l) => ({ ...l, [key]: rows }));
    return rows;
  };
  const onCategory = (e) => {
    const id = e.target.value;
    setForm((f) => ({ ...f, categoryId: id, sizeId: "", variantId: "", manualName: "", manualPrice: "" }));
    setLists((l) => ({ ...l, sizes: [], variants: [] }));
    if (id && id !== "manual") load("/billing/sizes/", { category_id: id }, "sizes", (d) => d.sizes);
  };
  const onSize = (e) => {
    const id = e.target.value;
    setForm((f) => ({ ...f, sizeId: id, variantId: "" }));
    setLists((l) => ({ ...l, variants: [] }));
    if (id) load("/billing/variants/", { size_id: id }, "variants", (d) => d.variants);
  };
  const onDCategory = (e) => {
    const id = e.target.value;
    setForm((f) => ({ ...f, dCategoryId: id, dGsmId: "", dProductId: "", dLaminationId: "" }));
    setLists((l) => ({ ...l, gsms: [], products: [], laminations: [] }));
    if (id) load("/billing/digital-gsm/", { category_id: id }, "gsms", (d) => d.gsms);
  };
  const onDGsm = (e) => {
    const id = e.target.value;
    setForm((f) => ({ ...f, dGsmId: id, dProductId: "", dLaminationId: "" }));
    setLists((l) => ({ ...l, products: [], laminations: [] }));
    if (id) load("/billing/digital-products/", { gsm_id: id }, "products", (d) => d.products);
  };
  const onDProduct = (e) => {
    const id = e.target.value;
    setForm((f) => ({ ...f, dProductId: id, dLaminationId: "" }));
    setLists((l) => ({ ...l, laminations: [] }));
    if (id) load("/billing/digital-laminations/", { product_id: id }, "laminations", (d) => d.laminations);
  };
  const resetEntry = () => { setForm(emptyForm); setPreview(null); setLists(emptyLists); };
  const switchMode = (m) => { setMode(m); resetEntry(); };

  /* ---------- live price preview (list price, no discount) ---------- */
  useEffect(() => {
    let dead = false;

    if (isManual) {
      const price = num(form.manualPrice);
      setPreview({ price, gross: round2(num(form.qty) * price * (num(form.job) || 1)) });
      return;
    }

    if (mode === "digital") {
      const qty = num(form.dQty);
      const { dCategoryId, dGsmId, dProductId, dLaminationId, dSide, dDeliveryId } = form;
      if (!dCategoryId || !dGsmId || !dProductId || !dLaminationId || !dSide || !dDeliveryId || qty <= 0) { setPreview(null); return; }
      api.get("/billing/digital-price/", { params: { lamination_id: dLaminationId, side: dSide, delivery_type: dDeliveryId, qty } })
        .then((r) => {
          if (dead) return;
          setPreview(r.data.success
            ? previewDigital({ data: r.data, job: num(form.dJob) || 1, extraCharge: 0, customerType: rateType })
            : null);
        }).catch(() => !dead && setPreview(null));
      return () => { dead = true; };
    }

    const qty = num(form.qty);
    const { categoryId, sizeId, variantId } = form;
    if (!categoryId || !sizeId || !variantId || qty <= 0) { setPreview(null); return; }
    api.get("/billing/price/", { params: { category_id: categoryId, size_id: sizeId, variant_id: variantId, qty } })
      .then((r) => {
        if (dead) return;
        setPreview(previewNormal({
          category: nameOf(meta.categories, categoryId).toLowerCase(),
          size: nameOf(lists.sizes, sizeId).toLowerCase(),
          variant: nameOf(lists.variants, variantId).toLowerCase(),
          qty, job: num(form.job) || 1, extraCharge: 0, dbData: r.data,
          customerType: "customer", remainingOldDue: 0, // "customer" = no discount
        }));
      }).catch(() => !dead && setPreview(null));
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, mode, rateType, isManual, lists.sizes, lists.variants]);

  /* ---------- add / update / edit / remove item ---------- */
  const commitItem = (item) => {
    setItems((list) => (editIndex >= 0 ? list.map((x, i) => (i === editIndex ? item : x)) : [...list, item]));
    setEditIndex(-1);
    setMsg("");
    resetEntry();
  };

  const addItem = () => {
    if (isManual) {
      if (!form.manualName.trim() || num(form.qty) <= 0 || num(form.manualPrice) <= 0) { setMsg("Enter manual item details"); return; }
      commitItem({
        billingType: "manual", name: form.manualName.trim(), categoryId: "", sizeId: "", variantId: "",
        qty: num(form.qty), job: num(form.job) || 1, price: round2(num(form.manualPrice)), total: round2(preview.gross),
      });
    } else if (mode === "digital") {
      if (!form.dCategoryId || !form.dGsmId || !form.dProductId || !num(form.dQty)) { setMsg("Select digital print details"); return; }
      if (!preview) { setMsg("No digital price found for this selection"); return; }
      const sideName = form.dSide === "double" ? "Double Side" : "Single Side";
      const name = [
        nameOf(meta.digital_categories, form.dCategoryId), nameOf(lists.gsms, form.dGsmId),
        nameOf(lists.products, form.dProductId), nameOf(lists.laminations, form.dLaminationId),
        sideName, nameOf(meta.delivery_types, form.dDeliveryId),
      ].join(" - ");
      commitItem({
        billingType: "digital", name, categoryId: form.dCategoryId, sizeId: form.dGsmId, variantId: form.dProductId,
        laminationId: form.dLaminationId, deliveryTypeId: form.dDeliveryId, side: form.dSide, sideName, customerType: rateType,
        qty: num(form.dQty), job: num(form.dJob) || 1, price: round2(preview.price), total: round2(preview.gross),
      });
    } else {
      if (!form.categoryId || !form.sizeId || !form.variantId || !num(form.qty)) { setMsg("Select category, size, variant and qty"); return; }
      if (!preview) { setMsg("No pricing rule found"); return; }
      const name = [nameOf(meta.categories, form.categoryId), nameOf(lists.sizes, form.sizeId), nameOf(lists.variants, form.variantId)].join(" - ");
      commitItem({
        billingType: "normal", name, categoryId: form.categoryId, sizeId: form.sizeId, variantId: form.variantId,
        qty: num(form.qty), job: num(form.job) || 1, price: round2(preview.price), total: round2(preview.gross),
      });
    }
  };

  const cancelEdit = () => { setEditIndex(-1); setMsg(""); resetEntry(); };

  const editItem = async (index) => {
    const it = items[index];
    setMsg("");

    if (it.billingType === "manual") {
      setEditIndex(index); setMode("normal"); setLists(emptyLists); setPreview(null);
      setForm({ ...emptyForm, categoryId: "manual", manualName: it.name, manualPrice: String(it.price), qty: String(it.qty), job: it.job || 1 });
      return;
    }
    if (!it.categoryId) { setMsg("This item's category no longer exists. Remove it and add it again."); return; }
    setEditIndex(index);

    if (it.billingType === "digital") {
      setMode("digital");
      setRateType(it.customerType === "shop" ? "shop" : "customer");
      setForm({ ...emptyForm, dCategoryId: String(it.categoryId), dGsmId: String(it.sizeId), dProductId: String(it.variantId),
        dLaminationId: String(it.laminationId), dSide: it.side, dDeliveryId: String(it.deliveryTypeId), dQty: String(it.qty), dJob: it.job || 1 });
      const [gsms, products, laminations] = await Promise.all([
        api.get("/billing/digital-gsm/", { params: { category_id: it.categoryId } }).then((r) => r.data.gsms),
        api.get("/billing/digital-products/", { params: { gsm_id: it.sizeId } }).then((r) => r.data.products),
        api.get("/billing/digital-laminations/", { params: { product_id: it.variantId } }).then((r) => r.data.laminations),
      ]);
      setLists((l) => ({ ...l, gsms, products, laminations }));
      return;
    }

    setMode("normal");
    setForm({ ...emptyForm, categoryId: String(it.categoryId), sizeId: String(it.sizeId), variantId: String(it.variantId), qty: String(it.qty), job: it.job || 1 });
    const [sizes, variants] = await Promise.all([
      api.get("/billing/sizes/", { params: { category_id: it.categoryId } }).then((r) => r.data.sizes),
      api.get("/billing/variants/", { params: { size_id: it.sizeId } }).then((r) => r.data.variants),
    ]);
    setLists((l) => ({ ...l, sizes, variants }));
  };

  const removeItem = (index) => {
    setItems((list) => list.filter((_, k) => k !== index));
    if (editIndex === index) cancelEdit();
    else if (editIndex > index) setEditIndex(editIndex - 1);
  };

  /* ---------- save ---------- */
  const save = async (andPrint) => {
    if (busy) return;
    if (!quotationDate) { setMsg("Please select the quotation date"); return; }
    if (items.length === 0) { setMsg("Add at least one item"); return; }
    if (editIndex >= 0) { setMsg("Finish or cancel the item you are editing first"); return; }
    if (discountAmt > subtotal) { setMsg("Discount cannot be more than the items total"); return; }
    setBusy(true); setMsg("");
    const body = {
      customer_name: customerName.trim(), customer_phone: customerPhone.trim(),
      work_name: workName.trim() || workFromItems(items), notes, terms,
      discount: discountAmt, extra_charge: extraAmt,
      quotation_date: quotationDate, valid_until: validUntil || null, items,
    };
    try {
      const r = editing ? await api.put(`/quotations/${quotationId}/`, body) : await api.post("/quotations/", body);
      if (andPrint) nav(`/quotations/${r.data.id}/bill?print=1&page=${sp.get("page") || 1}&q=${encodeURIComponent(sp.get("q") || "")}`);
      else nav(leaveTo);
    } catch (e) { setMsg(errorText(e)); setBusy(false); }
  };

  if (editing && !user.is_superuser) return <div className="error">Only admin can edit quotations.</div>;
  if (loading) return <p>Loading…</p>;

  const manualPriceMode = isManual;

  return (
    <div className="qt-form">
      <div className="od-head">
        <div>
          <h1>{editing ? "Edit Quotation" : "Create Quotation"}</h1>
          <p className="muted">{editing ? "Update the quotation details." : "Prepare a price estimate for a customer."}</p>
        </div>
        <Link to={leaveTo}><button type="button">← Back to Quotations</button></Link>
      </div>

      {/* CUSTOMER DETAILS */}
      <section className="card od-sec">
        <div className="od-sec-head">
          <h3>Customer details</h3>
          <button type="button" onClick={() => setShowNewCust(true)}>+ New Customer</button>
        </div>
        <div className="od-sec-body">
          <div className="qt-cust-grid">
            <label>Customer name / search (optional)
              <div className="bl-combo">
                <input maxLength={100} autoComplete="off" placeholder="Search existing customer or leave blank…"
                  value={customerName} onChange={(e) => onNameInput(e.target.value)} onKeyDown={onNameKey}
                  onBlur={() => setTimeout(() => setSuggestions(null), 150)} />
                {suggestions && (
                  <div className="suggest bl-pop">
                    {suggestions.length === 0 && <div className="suggest-item muted">No saved customer — the typed name will be used as is</div>}
                    {suggestions.map((c, i) => (
                      <div key={c.id} className={`suggest-item${i === custIdx ? " on" : ""}`} onMouseDown={() => pickCustomer(c)}>
                        <strong>{c.name}</strong> · {c.phone} <span className="muted">· {c.category}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {linked && <span className="qt-sel-cust">✓ Existing customer selected</span>}
            </label>
            <label>Mobile number (optional)
              <input maxLength={15} inputMode="tel" placeholder="Auto-filled / enter number" value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)} />
            </label>
            <label>Quotation date
              <input type="date" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} />
            </label>
            <label>Valid until (optional)
              <input type="date" value={validUntil} min={quotationDate} onChange={(e) => setValidUntil(e.target.value)} />
            </label>
          </div>
        </div>
      </section>

      {/* PRINT ITEMS */}
      <section className="card od-sec">
        <div className="od-sec-head">
          <h3>{editIndex >= 0 ? `Editing item ${editIndex + 1}` : "Print items"}</h3>
          {mode === "digital" && (
            <div className="qt-seg" role="group" aria-label="Digital rate">
              {[["customer", "Customer rate"], ["shop", "Shop rate"]].map(([k, label]) => (
                <button key={k} type="button" className={rateType === k ? "on" : ""} onClick={() => setRateType(k)}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <div className="od-sec-body">
          <div className="qt-entry-grid">
            <label>Billing type
              <select value={mode} onChange={(e) => switchMode(e.target.value)}>
                <option value="normal">Normal Print</option>
                <option value="digital">Digital Print</option>
              </select>
            </label>

            {mode === "normal" ? (
              <>
                <label>Category
                  <select value={form.categoryId} onChange={onCategory}>
                    <option value="">Select</option>
                    <option value="manual">OTHERS</option>
                    {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                {isManual ? (
                  <label className="span2">Item name
                    <input placeholder="Manual item name" value={form.manualName} onChange={set("manualName")} />
                  </label>
                ) : (
                  <>
                    <label>Size
                      <select value={form.sizeId} onChange={onSize} disabled={!form.categoryId}>
                        <option value="">Select</option>
                        {lists.sizes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </label>
                    <label>Variant
                      <select value={form.variantId} onChange={set("variantId")} disabled={!form.sizeId}>
                        <option value="">Select</option>
                        {lists.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </label>
                  </>
                )}
                <label>Quantity
                  <input type="number" min="1" placeholder="1" value={form.qty} onChange={set("qty")} />
                </label>
                <label>Job
                  <input type="number" min="1" value={form.job} onChange={set("job")} />
                </label>
              </>
            ) : (
              <>
                <label>Category
                  <select value={form.dCategoryId} onChange={onDCategory}>
                    <option value="">Select</option>
                    {meta.digital_categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label>GSM
                  <select value={form.dGsmId} onChange={onDGsm} disabled={!form.dCategoryId}>
                    <option value="">Select</option>
                    {lists.gsms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
                <label>Product
                  <select value={form.dProductId} onChange={onDProduct} disabled={!form.dGsmId}>
                    <option value="">Select</option>
                    {lists.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label>Lamination
                  <select value={form.dLaminationId} onChange={set("dLaminationId")} disabled={!form.dProductId}>
                    <option value="">Select</option>
                    {lists.laminations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
                <label>Side
                  <select value={form.dSide} onChange={set("dSide")}>
                    <option value="">Select</option>
                    <option value="single">Single Side</option>
                    <option value="double">Double Side</option>
                  </select>
                </label>
                <label>Delivery
                  <select value={form.dDeliveryId} onChange={set("dDeliveryId")}>
                    <option value="">Select</option>
                    {meta.delivery_types.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
                <label>Quantity
                  <input type="number" min="1" placeholder="1" value={form.dQty} onChange={set("dQty")} />
                </label>
                <label>Job
                  <input type="number" min="1" value={form.dJob} onChange={set("dJob")} />
                </label>
              </>
            )}

            <label>Price
              <input type={manualPriceMode ? "number" : "text"} min="0" placeholder="Auto price" readOnly={!manualPriceMode}
                value={manualPriceMode ? form.manualPrice : preview ? preview.price.toFixed(2) : ""}
                onChange={set("manualPrice")} />
            </label>
            <label>Total
              <input readOnly placeholder="Calculated total" value={preview ? round2(preview.gross).toFixed(2) : ""} />
            </label>
          </div>

          <div className="qt-entry-actions">
            {editIndex >= 0 && <button type="button" onClick={cancelEdit}>Cancel Edit</button>}
            <button className="primary" type="button" onClick={addItem}>{editIndex >= 0 ? "Update Item" : "+ Add Item"}</button>
          </div>

          <h4 className="qt-items-head">Items added ({items.length})</h4>
          <div className="qt-items-wrap">
            <table className="od-items-table">
              <thead>
                <tr><th>Item / Specification</th><th className="num">Qty</th><th className="num">Job</th><th className="num">Price</th><th className="num">Total</th><th /></tr>
              </thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={6} className="qt-items-empty">No items added yet</td></tr>}
                {items.map((i, idx) => (
                  <tr key={idx} className={idx === editIndex ? "editing" : ""}>
                    <td>{i.name}</td>
                    <td className="num">{i.qty}</td>
                    <td className="num">{i.job || 1}</td>
                    <td className="num">{money(i.price)}</td>
                    <td className="num">{money(i.total)}</td>
                    <td className="num">
                      <button type="button" onClick={() => editItem(idx)}>Edit</button>{" "}
                      <button type="button" className="danger" onClick={() => removeItem(idx)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* NOTES + SUMMARY */}
      <div className="qt-lower">
        <section className="card od-sec" style={{ marginBottom: 0 }}>
          <div className="od-sec-head"><h3>Notes</h3></div>
          <div className="od-sec-body">
            <label>Work name (optional)
              <input maxLength={200} placeholder={items.length ? workFromItems(items) : "Auto-filled from the items, e.g. Visiting Card"}
                value={workName} onChange={(e) => setWorkName(e.target.value)} />
            </label>
            <label>Printing instructions / details
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Paper type, urgent work, design notes, printing details…" />
            </label>
            <label>Terms (optional)
              <textarea rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Terms and conditions…" />
            </label>
          </div>
        </section>

        <section className="card od-sec" style={{ marginBottom: 0 }}>
          <div className="od-sec-head"><h3>Quotation summary</h3></div>
          <div className="od-sec-body">
            <div className="qt-sum-row"><span>Subtotal</span><b>{money(subtotal)}</b></div>
            <div className="qt-sum-row"><span>Discount</span>
              <input type="number" min="0" placeholder="0" aria-label="Discount" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div className="qt-sum-row"><span>Extra charges</span>
              <input type="number" min="0" placeholder="0" aria-label="Extra charges" value={extraCharge} onChange={(e) => setExtraCharge(e.target.value)} />
            </div>
            <div className="qt-sum-total"><span>GRAND TOTAL</span><b>{money(grandTotal)}</b></div>
          </div>
        </section>
      </div>

      <div className="od-bar qt-bar">
        <span className="od-bar-msg">{msg}</span>
        <Link to={leaveTo}><button type="button">Cancel</button></Link>
        <button type="button" disabled={busy} onClick={() => save(false)}>{busy ? "Saving…" : editing ? "Update Quotation" : "Save Quotation"}</button>
        <button type="button" className="primary" disabled={busy} onClick={() => save(true)}>{editing ? "Update & Print" : "Save & Print"}</button>
      </div>

      {showNewCust && (
        <CustomerForm
          initial={{}}
          onClose={() => setShowNewCust(false)}
          onSaved={(c) => {
            setShowNewCust(false);
            if (c?.id) pickCustomer(c);
          }}
        />
      )}
    </div>
  );
}
