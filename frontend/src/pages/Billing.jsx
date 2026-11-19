import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import CustomerForm from "../components/CustomerForm";
import { customerTypeOf, computeTotals, num } from "../lib/billing";
import { discountPercent, previewDigital, previewNormal, round2 } from "../lib/pricing";
import "./billing.css";
import Icon from "../components/Icon";

const DRAFT_KEY = "star_bill_draft";
const RECENT_KEY = "star_bill_recent"; // how often each category is billed -> "Quick add" chips

const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const nameOf = (list, id) => list.find((x) => String(x.id) === String(id))?.name || "";
const readJSON = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const writeJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full / blocked */ } };

const emptyForm = {
  categoryId: "", sizeId: "", variantId: "", qty: "", job: 1,
  manualName: "", manualPrice: "", manualDiscount: "", extraCharge: "", extraPurpose: "",
  dCategoryId: "", dGsmId: "", dProductId: "", dLaminationId: "", dSide: "single", dDeliveryId: "",
};
const emptyLists = { sizes: [], variants: [], gsms: [], products: [], laminations: [] };

// One dropdown; when there is only a single choice it is shown as plain text (already picked)
function Pick({ list, value, onChange, label }) {
  return list.length === 1
    ? <div><div className="bl-lbl">{label}</div><div className="bl-static">{list[0].name}</div></div>
    : <label>{label}<select value={value} onChange={onChange}><option value="">Select</option>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>;
}

export default function Billing() {
  const { billId } = useParams(); // present when editing
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const editing = Boolean(billId);
  const orderId = sp.get("order_id"); // "Generate Bill" on the Orders page
  const quotationId = sp.get("quotation_id"); // "Convert to Bill" on the Quotations page

  const [meta, setMeta] = useState({ categories: [], digital_categories: [], delivery_types: [] });
  const [customer, setCustomer] = useState(null);
  const [custText, setCustText] = useState("");
  const [suggestions, setSuggestions] = useState(null);
  const [custIdx, setCustIdx] = useState(0);
  const [showNewCust, setShowNewCust] = useState(false);
  const [items, setItems] = useState([]);
  const [mode, setMode] = useState("normal"); // normal | digital | manual
  const [form, setForm] = useState(emptyForm);
  const [lists, setLists] = useState(emptyLists);
  const [preview, setPreview] = useState(null);
  const [svcText, setSvcText] = useState("");
  const [svcOpen, setSvcOpen] = useState(false);
  const [svcIdx, setSvcIdx] = useState(0);
  const [showExtras, setShowExtras] = useState(false);
  const [oldDuePay, setOldDuePay] = useState("");
  const [extraDiscount, setExtraDiscount] = useState("");
  const [showBillDisc, setShowBillDisc] = useState(false);
  const [paidInput, setPaidInput] = useState(null); // null = auto (pay full)
  const [payMode, setPayMode] = useState("cash"); // cash | upi | bank
  const [msg, setMsg] = useState("");
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [advance, setAdvance] = useState(0); // advance already paid on the order being billed
  const [billNo, setBillNo] = useState("");
  const [nextNo, setNextNo] = useState("");
  const [draft, setDraft] = useState(() => (editing || orderId || quotationId ? null : readJSON(DRAFT_KEY, null)));
  const [recent, setRecent] = useState(() => readJSON(RECENT_KEY, {}));

  const custRef = useRef();
  const svcRef = useRef();
  const qtyRef = useRef();
  const searchTimer = useRef();
  const saveRef = useRef();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const focusQty = () => setTimeout(() => qtyRef.current?.focus(), 60);
  const focusService = () => setTimeout(() => svcRef.current?.focus(), 60);

  const custType = customerTypeOf(customer);
  const totals = useMemo(
    () => computeTotals({ items, previousDue: customer?.due_amount, oldDuePay, extraDiscount, paidInput }),
    [items, customer, oldDuePay, extraDiscount, paidInput]
  );
  const prevDue = num(customer?.due_amount);

  /* ---------- load meta, next bill number (+ bill when editing) ---------- */
  useEffect(() => { api.get("/billing/meta/").then((r) => setMeta(r.data)); }, []);

  const loadNextNo = () => {
    api.get("/bills/", { params: { page: 1 } }).then((r) => {
      const last = r.data.results?.[0]?.bill_no;
      const n = last ? parseInt(String(last).replace(/\D/g, ""), 10) : 0;
      setNextNo(`B${(Number.isFinite(n) ? n : 0) + 1}`);
    }).catch(() => setNextNo(""));
  };
  useEffect(() => { if (!editing) loadNextNo(); }, [editing]);

  useEffect(() => {
    if (!editing) return;
    api.get(`/bills/${billId}/`).then((r) => {
      const b = r.data;
      setBillNo(b.bill_no);
      // customer's due before this bill, as the old edit screen did
      setCustomer({ ...b.customer, due_amount: b.previous_due });
      setCustText(`${b.customer.name} - ${b.customer.phone}`);
      setPaidInput(String(b.paid_amount));
      setPayMode(["upi", "bank"].includes(b.payment_mode) ? b.payment_mode : "cash"); // "credit" bills had nothing received
      setOldDuePay(String(b.old_due_paid));
      setExtraDiscount(b.extra_discount ? String(b.extra_discount) : "");
      setShowBillDisc(Boolean(b.extra_discount));
      setItems(b.items.map((i) => ({
        ...i,
        // digital names are stored without the delivery part; add it back so re-saving is lossless
        name: i.billingType === "digital print" && i.deliveryTypeName ? `${i.name} - ${i.deliveryTypeName}` : i.name,
      })));
    }).catch((e) => setMsg(errorText(e))).finally(() => setLoading(false));
  }, [billId, editing]);

  /* ---------- new bill from an order: customer + items come from the order ---------- */
  useEffect(() => {
    if (editing || !orderId) return;
    (async () => {
      try {
        const { data: o } = await api.get(`/orders/${orderId}/`);
        if (o.is_billed) { setMsg("This order is already billed"); return; }
        const type = customerTypeOf(o.customer);

        // keep the order's own amount as gross; only look up the discount % for this customer type
        const lines = await Promise.all(o.items.map(async (it) => {
          let pct = 0;
          if (it.billingType === "digital") {
            if (type === "member" && it.laminationId && it.deliveryTypeId) {
              const r = await api.get("/billing/digital-price/", {
                params: { lamination_id: it.laminationId, side: it.side, delivery_type: it.deliveryTypeId, qty: it.qty } });
              if (r.data.success) pct = parseFloat(r.data.customer_discount || 0);
            }
          } else if (type !== "customer" && it.categoryId && it.sizeId && it.variantId) {
            const r = await api.get("/billing/price/", {
              params: { category_id: it.categoryId, size_id: it.sizeId, variant_id: it.variantId, qty: it.qty, customer_type: type } });
            pct = type === "shop" ? 0 : discountPercent({
              category: (it.categoryName || "").toLowerCase(), qty: it.qty, customerType: type,
              shopDiscount: parseFloat(r.data.shop_discount || 0), csDiscount: parseFloat(r.data.cs_discount || 0),
            });
          }
          const gross = it.total;
          const discount = round2((gross * pct) / 100);
          return {
            ...it,
            billingType: it.billingType === "digital" ? "digital print" : it.categoryId ? "normal print" : "manual",
            gross, discount, extraCharge: 0, extraPurpose: "", total: round2(gross - discount),
          };
        }));

        setCustomer(o.customer);
        setCustText(`${o.customer.name} - ${o.customer.phone}`);
        setItems(lines);
        setAdvance(o.advance_paid);
        if (["upi", "bank"].includes(o.advance_mode)) setPayMode(o.advance_mode); // advance was taken this way
      } catch (e) { setMsg(errorText(e)); }
    })();
  }, [orderId, editing]);

  /* ---------- new bill from a quotation: items come from the quotation, customer is matched by mobile ---------- */
  useEffect(() => {
    if (editing || orderId || !quotationId) return;
    (async () => {
      try {
        const { data: q } = await api.get(`/quotations/${quotationId}/`);
        if (q.is_billed) { setMsg("This quotation is already billed"); return; }
        // quotation prices are list prices: bill them as quoted (no extra discount)
        const lines = q.items.map((it) => ({
          ...it,
          billingType: it.billingType === "digital" ? "digital print" : it.billingType === "manual" ? "manual" : "normal print",
          gross: it.total, discount: 0, extraCharge: 0, extraPurpose: "", total: it.total,
        }));
        // an overall quotation discount / extra charge is carried over as bill-level amounts
        if (q.discount > 0) { setExtraDiscount(String(q.discount)); setShowBillDisc(true); }
        if (q.extra_charge > 0 && lines.length) {
          lines[0] = { ...lines[0], extraCharge: q.extra_charge, extraPurpose: "Quotation extra charges", total: round2(lines[0].total + q.extra_charge) };
        }
        setItems(lines);
        const phone = (q.customer_phone || "").trim();
        const found = phone.length >= 5
          ? (await api.get("/customers/live-search/", { params: { q: phone } })).data.customers.find((c) => c.phone === phone)
          : null;
        if (found) { setCustomer(found); setCustText(`${found.name} - ${found.phone}`); }
        else {
          setCustText(q.customer_name || "");
          setMsg(`Select or create the customer for this bill${q.customer_name || phone ? ` (quotation was for ${[q.customer_name, phone].filter(Boolean).join(" · ")})` : ""}.`);
        }
      } catch (e) { setMsg(errorText(e)); }
    })();
  }, [quotationId, orderId, editing]);

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
    setOldDuePay(""); setPaidInput(null);
    focusService();
  };
  const changeCustomer = () => {
    setCustomer(null); setCustText(""); setSuggestions(null); setOldDuePay(""); setPaidInput(null);
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
    if (!id) return;
    const rows = await load("/billing/digital-gsm/", { category_id: id }, "gsms", (d) => d.gsms);
    if (rows.length === 1) await chooseDGsm(String(rows[0].id));
  };

  // a one-delivery-type shop never has to pick it
  useEffect(() => {
    if (meta.delivery_types.length === 1) setForm((f) => (f.dDeliveryId ? f : { ...f, dDeliveryId: String(meta.delivery_types[0].id) }));
  }, [meta.delivery_types]);

  const resetEntry = (nextMode = mode) => {
    setMode(nextMode); setForm({ ...emptyForm, dDeliveryId: meta.delivery_types.length === 1 ? String(meta.delivery_types[0].id) : "" });
    setPreview(null); setLists(emptyLists); setSvcText(""); setSvcOpen(false); setShowExtras(false);
  };
  const switchMode = (m) => { resetEntry(m); if (m === "normal") focusService(); };

  /* ---------- service search + quick add ---------- */
  const catSelected = Boolean(form.categoryId);
  const matches = useMemo(() => {
    const q = svcText.trim().toLowerCase();
    return meta.categories.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [meta.categories, svcText]);
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
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); chooseCategory(matches[svcIdx] || matches[0]); }
    else if (e.key === "Escape") setSvcOpen(false);
  };

  /* ---------- live price preview ---------- */
  useEffect(() => {
    let dead = false;
    let timer;
    const extraCharge = num(form.extraCharge);
    const qty = num(form.qty);
    const job = num(form.job) || 1;

    if (mode === "manual") {
      const price = num(form.manualPrice), discount = num(form.manualDiscount);
      const gross = qty * price * job;
      setPreview(gross > 0 ? { price, gross, discount, discountPercent: 0, fullDiscount: discount, total: gross - discount + extraCharge } : null);
      return;
    }

    if (mode === "digital") {
      const { dCategoryId, dGsmId, dProductId, dLaminationId, dSide, dDeliveryId } = form;
      if (!dCategoryId || !dGsmId || !dProductId || !dLaminationId || !dSide || !dDeliveryId || qty <= 0) { setPreview(null); return; }
      timer = setTimeout(() => {
        api.get("/billing/digital-price/", { params: { lamination_id: dLaminationId, side: dSide, delivery_type: dDeliveryId, qty } })
          .then((r) => {
            if (dead) return;
            setPreview(r.data.success ? previewDigital({ data: r.data, job, extraCharge, customerType: custType }) : null);
          }).catch(() => !dead && setPreview(null));
      }, 200);
      return () => { dead = true; clearTimeout(timer); };
    }

    const { categoryId, sizeId, variantId } = form;
    if (!categoryId || !sizeId || !variantId || qty <= 0) { setPreview(null); return; }
    timer = setTimeout(() => {
      api.get("/billing/price/", { params: { category_id: categoryId, size_id: sizeId, variant_id: variantId, qty, customer_type: custType } })
        .then((r) => {
          if (dead) return;
          setPreview(previewNormal({
            category: nameOf(meta.categories, categoryId).toLowerCase(),
            size: nameOf(lists.sizes, sizeId).toLowerCase(),
            variant: nameOf(lists.variants, variantId).toLowerCase(),
            qty, job, extraCharge, dbData: r.data,
            customerType: custType, remainingOldDue: totals.remainingOldDue,
          }));
        }).catch(() => !dead && setPreview(null));
    }, 200);
    return () => { dead = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, mode, custType, totals.remainingOldDue, lists.sizes, lists.variants]);

  /* ---------- add / edit / remove item ---------- */
  const addItem = () => {
    const extraCharge = num(form.extraCharge);
    const extraPurpose = form.extraPurpose.trim();
    const qty = num(form.qty);
    const job = num(form.job) || 1;

    if (mode === "manual") {
      if (!form.manualName.trim() || qty <= 0 || num(form.manualPrice) <= 0) { setMsg("Enter item name, qty and price"); return; }
      const p = preview;
      setItems((it) => [...it, {
        billingType: "manual", name: form.manualName.trim(), qty, job,
        price: p.price, gross: round2(p.gross), discount: p.discount, extraCharge, extraPurpose, total: round2(p.total),
      }]);
    } else if (mode === "digital") {
      if (!form.dCategoryId || !form.dGsmId || !form.dProductId || !form.dLaminationId || !form.dDeliveryId || qty <= 0) { setMsg("Select all digital print details and qty"); return; }
      if (!preview) { setMsg("No digital price found for this selection"); return; }
      const catName = nameOf(meta.digital_categories, form.dCategoryId);
      const sideText = form.dSide === "double" ? "Double Side" : "Single Side";
      const lamName = nameOf(lists.laminations, form.dLaminationId);
      const delName = nameOf(meta.delivery_types, form.dDeliveryId);
      let name = catName;
      if (catName.trim().toLowerCase() !== "visiting card") {
        name += ` - ${nameOf(lists.gsms, form.dGsmId)} - ${nameOf(lists.products, form.dProductId)}`;
      }
      name += ` - ${lamName} - ${sideText} - ${delName}`;
      setItems((it) => [...it, {
        billingType: "digital print", name, categoryId: form.dCategoryId, sizeId: form.dGsmId, variantId: form.dProductId,
        laminationId: form.dLaminationId, deliveryTypeId: form.dDeliveryId, deliveryTypeName: delName,
        laminationName: lamName, side: form.dSide, sideName: sideText,
        qty, job, price: preview.price, gross: round2(preview.gross),
        discount: round2(preview.discount), extraCharge, extraPurpose, total: round2(preview.total),
      }]);
    } else {
      if (!form.categoryId || !form.sizeId || !form.variantId || qty <= 0) { setMsg("Select service, size, variant and qty"); return; }
      if (!preview) { setMsg("No pricing rule found for this selection"); return; }
      const name = `${nameOf(meta.categories, form.categoryId)} - ${nameOf(lists.sizes, form.sizeId)} - ${nameOf(lists.variants, form.variantId)}`;
      setItems((it) => [...it, {
        billingType: "normal print", name, categoryId: form.categoryId, sizeId: form.sizeId, variantId: form.variantId,
        qty, job, price: preview.price, gross: round2(preview.gross),
        discount: round2(preview.fullDiscount), extraCharge, extraPurpose,
        total: round2(preview.gross - preview.fullDiscount + extraCharge),
      }]);
      const next = { ...recent, [form.categoryId]: (recent[form.categoryId] || 0) + 1 };
      setRecent(next); writeJSON(RECENT_KEY, next);
    }
    setMsg(""); setNotice(null);
    resetEntry();
    if (mode === "normal") focusService();
  };

  const editItem = async (index) => {
    const it = items[index];
    setItems((list) => list.filter((_, i) => i !== index));
    setMsg(""); setNotice(null);
    const common = {
      qty: String(it.qty), job: it.job || 1,
      extraCharge: it.extraCharge ? String(it.extraCharge) : "", extraPurpose: it.extraPurpose || "",
    };
    setShowExtras(Boolean(it.extraCharge) || (it.job || 1) > 1);

    if (it.billingType === "digital print") {
      setMode("digital"); setSvcText("");
      setForm({ ...emptyForm, ...common, dCategoryId: String(it.categoryId), dGsmId: String(it.sizeId), dProductId: String(it.variantId),
        dLaminationId: String(it.laminationId), dSide: it.side, dDeliveryId: String(it.deliveryTypeId) });
      const [gsms, products, laminations] = await Promise.all([
        api.get("/billing/digital-gsm/", { params: { category_id: it.categoryId } }).then((r) => r.data.gsms),
        api.get("/billing/digital-products/", { params: { gsm_id: it.sizeId } }).then((r) => r.data.products),
        api.get("/billing/digital-laminations/", { params: { product_id: it.variantId } }).then((r) => r.data.laminations),
      ]);
      setLists((l) => ({ ...l, gsms, products, laminations }));
      return;
    }

    // manual items, and old items that have no category mapping, are edited as manual lines
    if (it.billingType === "manual" || !it.categoryId || !it.sizeId) {
      setMode("manual"); setSvcText("");
      setForm({ ...emptyForm, ...common, manualName: it.name, manualPrice: String(it.price), manualDiscount: it.discount ? String(it.discount) : "" });
      return;
    }

    setMode("normal");
    setSvcText(nameOf(meta.categories, it.categoryId));
    setForm({ ...emptyForm, ...common, categoryId: String(it.categoryId), sizeId: String(it.sizeId), variantId: String(it.variantId) });
    const [sizes, variants] = await Promise.all([
      api.get("/billing/sizes/", { params: { category_id: it.categoryId } }).then((r) => r.data.sizes),
      api.get("/billing/variants/", { params: { size_id: it.sizeId } }).then((r) => r.data.variants),
    ]);
    setLists((l) => ({ ...l, sizes, variants }));
  };

  // Enter inside a number box of the entry card adds the line
  const onEntryKey = (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target !== svcRef.current) {
      e.preventDefault();
      addItem();
    }
  };

  /* ---------- draft (this device only) ---------- */
  const saveDraft = () => {
    if (!customer && items.length === 0) { setMsg("Nothing to save yet"); return; }
    writeJSON(DRAFT_KEY, { customer, items, oldDuePay, extraDiscount, paidInput, payMode, at: Date.now() });
    setMsg(""); setNotice({ text: "Draft saved on this device. It will be offered the next time you open Billing." });
  };
  const restoreDraft = () => {
    const d = draft;
    setDraft(null);
    if (!d) return;
    setItems(d.items || []); setOldDuePay(d.oldDuePay || ""); setExtraDiscount(d.extraDiscount || "");
    setShowBillDisc(Boolean(d.extraDiscount)); setPaidInput(d.paidInput ?? null); setPayMode(d.payMode || "cash");
    if (d.customer?.id) {
      setCustomer(d.customer); setCustText(`${d.customer.name} - ${d.customer.phone}`);
      // refresh the due balance, it may have changed since the draft was saved
      api.get(`/customers/${d.customer.id}/`).then((r) => setCustomer(r.data)).catch(() => {});
    }
  };
  const discardDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } setDraft(null); };

  /* ---------- save ---------- */
  const resetBill = () => {
    setCustomer(null); setCustText(""); setSuggestions(null); setItems([]); setOldDuePay(""); setExtraDiscount("");
    setShowBillDisc(false); setPaidInput(null); setPayMode("cash"); setAdvance(0); resetEntry("normal");
    setTimeout(() => custRef.current?.focus(), 60);
  };

  const save = async (after) => {
    if (busy) return;
    if (!customer) { setMsg("Select customer first"); return; }
    if (items.length === 0) { setMsg("Add at least one item"); return; }
    setBusy(true); setMsg("");
    // send the lines exactly as the totals were calculated (discounts removed while old due is pending)
    const lines = totals.lines.map((i) => ({ ...i, total: round2(i.gross - i.discount + i.extraCharge) }));
    const body = {
      customer_id: customer.id, items: lines,
      extra_discount: num(extraDiscount), old_due_payment: totals.oldPaid, paid_amount: totals.paid,
      payment_mode: payMode,
      order_id: orderId || undefined,
      quotation_id: quotationId || undefined,
    };
    try {
      const r = editing ? await api.put(`/bills/${billId}/`, body) : await api.post("/bills/", body);
      discardDraft();
      if (after === "new" && !editing && !orderId && !quotationId) {
        resetBill(); loadNextNo();
        setNotice({ text: `Bill ${r.data.bill_no} saved.`, id: r.data.id });
        setBusy(false);
        return;
      }
      const q = [after === "print" ? "print=1" : "", sp.get("from_history") ? "from_history=1" : ""].filter(Boolean).join("&");
      nav(`/invoice/${r.data.id}${q ? `?${q}` : ""}`);
    } catch (e) { setMsg(errorText(e)); setBusy(false); }
  };

  // mouse wheel / trackpad scroll must never change a number box: drop focus before the browser applies the scroll
  useEffect(() => {
    const onWheel = () => {
      const a = document.activeElement;
      if (a && a.tagName === "INPUT" && a.type === "number") a.blur();
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  useEffect(() => { saveRef.current = save; });
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); saveRef.current?.("print"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cancel = () => {
    if (items.length > 0 && !window.confirm("Discard this bill?")) return;
    nav(editing ? "/history" : "/dashboard");
  };

  if (loading) return <p>Loading…</p>;

  /* ---------- view helpers ---------- */
  const exp = customer?.expiry_date;
  const today = new Date().toLocaleDateString("en-CA");
  const tag = !customer ? null
    : custType === "shop" ? <span className="bl-tag shop">Shop</span>
    : custType === "member" ? <span className="bl-tag member">Member</span>
    : customer.is_member && exp && exp < today ? <span className="bl-tag expired">Membership expired</span>
    : <span className="bl-tag">Regular</span>;

  const showPct = preview && preview.discountPercent > 0;
  const lineDiscount = preview ? (totals.remainingOldDue > 0 ? 0 : preview.discount) : 0;

  return (
    <>
      <div className="bl-head">
        <h1>{editing ? "Edit Bill" : "New Invoice"}</h1>
        {(editing ? billNo : nextNo) && <span className="bl-no">Bill # {editing ? billNo : nextNo}</span>}
        <span className="bl-spacer" />
        <Link to="/history"><button type="button">Bill History</button></Link>
      </div>

      {msg && <div className="error">{msg}</div>}
      {notice && (
        <div className="success">
          {notice.text} {notice.id && <Link to={`/invoice/${notice.id}`}>View / Print</Link>}
        </div>
      )}
      {draft && (
        <div className="bl-banner" style={{ marginBottom: 12 }}>
          <span>Unsaved draft found{draft.at ? ` (${new Date(draft.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })})` : ""}.</span>
          <span className="bl-spacer" />
          <button type="button" className="primary" onClick={restoreDraft}>Restore</button>
          <button type="button" onClick={discardDraft}>Discard</button>
        </div>
      )}

      <div className="bl-wrap">
        <div className="bl-main">
          {/* CUSTOMER */}
          <div className="card bl-card">
            <p className="bl-title">Customer</p>
            {!customer ? (
              <div className="row">
                <div className="bl-combo grow">
                  <input ref={custRef} autoFocus={!editing && !orderId} placeholder="Search name or mobile number…"
                    value={custText} onChange={(e) => onCustInput(e.target.value)} onKeyDown={onCustKey} />
                  {suggestions && (
                    <div className="suggest bl-pop">
                      {suggestions.length === 0 && <div className="suggest-item muted">No customer found</div>}
                      {suggestions.map((c, i) => (
                        <div key={c.id} className={`suggest-item${i === custIdx ? " on" : ""}`} onClick={() => pickCustomer(c)}>
                          <strong>{c.name}</strong> · {c.phone}
                          {num(c.due_amount) > 0 && <span className="bad"> · due {money(c.due_amount)}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => setShowNewCust(true)}>+ New</button>
              </div>
            ) : (
              <div className="bl-cust">
                <div className="bl-cust-main">
                  <b>{customer.name}</b> · {customer.phone} {tag}
                  <div>
                    <small>{customer.is_member && customer.member_id ? `ID ${customer.member_id}${exp ? ` · valid till ${exp}` : ""} · ` : ""}</small>
                    {prevDue > 0 ? <b className="bad">Outstanding {money(prevDue)}</b> : <small>No outstanding due</small>}
                  </div>
                </div>
                <button type="button" onClick={changeCustomer}>Change</button>
              </div>
            )}
            {advance > 0 && <div className="muted">Order advance already paid: {money(advance)}. Include it in "Received" below.</div>}
          </div>

          {/* ITEM ENTRY */}
          <div className="card bl-card" onKeyDown={onEntryKey}>
            <div className="row between wrap">
              <p className="bl-title" style={{ margin: 0 }}>Add item</p>
              <div className="bl-seg">
                {[["normal", "Print"], ["digital", "Digital"], ["manual", "Other"]].map(([k, label]) => (
                  <button key={k} type="button" className={mode === k ? "on" : ""} onClick={() => switchMode(k)}>{label}</button>
                ))}
              </div>
            </div>

            {mode === "normal" && (
              <>
                <div className="bl-combo">
                  <input ref={svcRef} placeholder="Search service — e.g. visiting card, bill book, flex…" value={svcText}
                    onChange={(e) => onSvcInput(e.target.value)} onFocus={() => !catSelected && setSvcOpen(true)}
                    onBlur={() => setTimeout(() => setSvcOpen(false), 150)} onKeyDown={onSvcKey} />
                  {svcOpen && !catSelected && matches.length > 0 && (
                    <div className="suggest bl-pop">
                      {matches.map((c, i) => (
                        <div key={c.id} className={`suggest-item${i === svcIdx ? " on" : ""}`} onMouseDown={() => chooseCategory(c)}>{c.name}</div>
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
                    <label>Qty<input ref={qtyRef} type="number" min="1" placeholder="Qty" value={form.qty} onChange={set("qty")} /></label>
                  </div>
                )}
              </>
            )}

            {mode === "digital" && (
              <>
                <div className="bl-chips">
                  {meta.digital_categories.map((c) => (
                    <button key={c.id} type="button" className={`bl-chip${String(c.id) === form.dCategoryId ? " on" : ""}`}
                      onClick={() => chooseDCategory(String(c.id))}>{c.name}</button>
                  ))}
                </div>
                {form.dCategoryId && (
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
                    </div>
                    <div className="bl-row">
                      <label>Qty<input ref={qtyRef} type="number" min="1" placeholder="Qty" value={form.qty} onChange={set("qty")} /></label>
                    </div>
                  </>
                )}
              </>
            )}

            {mode === "manual" && (
              <div className="bl-row">
                <label style={{ gridColumn: "span 2" }}>Item name<input autoFocus placeholder="e.g. Lamination, Binding" value={form.manualName} onChange={set("manualName")} /></label>
                <label>Qty<input ref={qtyRef} type="number" min="1" placeholder="Qty" value={form.qty} onChange={set("qty")} /></label>
                <label>Price ₹<input type="number" placeholder="Rate" value={form.manualPrice} onChange={set("manualPrice")} /></label>
                <label>Discount ₹<input type="number" placeholder="Optional" value={form.manualDiscount} onChange={set("manualDiscount")} /></label>
              </div>
            )}

            {showExtras ? (
              <div className="bl-row">
                <label>Jobs<input type="number" min="1" value={form.job} onChange={set("job")} /></label>
                <label>Extra charge ₹<input type="number" placeholder="0" value={form.extraCharge} onChange={set("extraCharge")} /></label>
                <label style={{ gridColumn: "span 2" }}>Extra for<input placeholder="e.g. design, urgent" value={form.extraPurpose} onChange={set("extraPurpose")} /></label>
              </div>
            ) : (
              <button type="button" className="link-btn" style={{ alignSelf: "flex-start" }} onClick={() => setShowExtras(true)}>+ Extra charge / multiple jobs</button>
            )}

            <div className="bl-add">
              <div className="bl-readout grow">
                {preview ? (
                  <>
                    <div><small>Rate</small><b>{money(preview.price)}</b></div>
                    <div><small>Discount{showPct ? ` ${preview.discountPercent}%` : ""}</small><b>{money(lineDiscount)}</b></div>
                    <div className="bl-total">{money(preview.gross - lineDiscount + num(form.extraCharge))}</div>
                  </>
                ) : <span className="muted">Pick the service and qty — the price fills in automatically.</span>}
              </div>
              <button type="button" className="primary big" onClick={addItem}>+ Add</button>
            </div>
            {totals.remainingOldDue > 0 && <div className="muted">Item discounts are off while an old due is pending. Collect the old due on the right to apply them.</div>}
          </div>

          {/* BILL ITEMS */}
          <div className="card table-wrap bl-items">
            <table>
              <thead>
                <tr><th>#</th><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Disc</th><th className="num">Extra</th><th className="num">Total</th><th /></tr>
              </thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={8} className="bl-empty">No items yet. Add the first item above.</td></tr>}
                {totals.lines.map((i, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td>{i.name}{(i.job || 1) > 1 && <small> × {i.job} jobs</small>}{i.extraPurpose && <><br /><small className="muted">Extra: {i.extraPurpose}</small></>}</td>
                    <td className="num">{i.qty}</td>
                    <td className="num">{money(i.price)}</td>
                    <td className="num">{i.discount > 0 ? money(i.discount) : "–"}</td>
                    <td className="num">{i.extraCharge > 0 ? money(i.extraCharge) : "–"}</td>
                    <td className="num"><b>{money(i.gross - i.discount + i.extraCharge)}</b></td>
                    <td className="actions">
                      <button type="button" title="Edit" onClick={() => editItem(idx)}><Icon name="edit" size={15} /></button>
                      <button type="button" title="Remove" className="danger" onClick={() => setItems((l) => l.filter((_, k) => k !== idx))}><Icon name="close" size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* PAYMENT & SUMMARY */}
        <aside className="bl-side">
          <div className="card bl-sum">
            <p className="bl-title" style={{ margin: 0 }}>Bill summary</p>
            <div className="srow sub"><span>Items subtotal</span><span>{money(totals.gross)}</span></div>
            {totals.extraCharge > 0 && <div className="srow sub"><span>Extra charges</span><span>+ {money(totals.extraCharge)}</span></div>}
            <div className="srow sub"><span>Discount</span><span>− {money(totals.totalDiscount)}</span></div>
            {showBillDisc ? (
              <label>Extra discount ₹<input type="number" min="0" placeholder="0" value={extraDiscount} onChange={(e) => setExtraDiscount(e.target.value)} /></label>
            ) : (
              <button type="button" className="link-btn" style={{ alignSelf: "flex-start" }} onClick={() => setShowBillDisc(true)}>+ Bill discount</button>
            )}
            <div className="srow big"><span>Bill total</span><span>{money(totals.final)}</span></div>
          </div>

          <div className="card bl-sum">
            <p className="bl-title" style={{ margin: 0 }}>Payment</p>
            {prevDue > 0 && (
              <>
                <div className="srow sub"><span>Previous due</span><b className="bad">{money(prevDue)}</b></div>
                <label>Collect previous due ₹
                  <input type="number" min="0" placeholder="0" value={oldDuePay} onChange={(e) => setOldDuePay(e.target.value)} />
                </label>
                <div className="bl-pay-opts">
                  <button type="button" onClick={() => setOldDuePay(String(prevDue))}>Clear all</button>
                  <button type="button" onClick={() => setOldDuePay("")}>None</button>
                </div>
                <hr />
              </>
            )}
            <label>Received for this bill ₹
              <input type="number" min="0" placeholder="0"
                value={paidInput === null ? (totals.final > 0 ? String(totals.final) : "") : paidInput}
                onChange={(e) => setPaidInput(e.target.value)} />
            </label>
            <div className="bl-pay-opts">
              <button type="button" onClick={() => setPaidInput(null)}>Full</button>
              <button type="button" onClick={() => setPaidInput(String(Math.round(totals.final / 2)))}>Half</button>
              <button type="button" onClick={() => setPaidInput("0")}>Credit</button>
            </div>
            <div>
              <div className="bl-lbl" style={{ marginBottom: 4 }}>Payment mode</div>
              <div className="bl-seg">
                {[["cash", "Cash"], ["upi", "UPI"], ["bank", "Bank"]].map(([k, label]) => (
                  <button key={k} type="button" className={payMode === k ? "on" : ""} onClick={() => setPayMode(k)}>{label}</button>
                ))}
              </div>
              {totals.paid + totals.oldPaid <= 0 && items.length > 0 && <div className="bl-lbl" style={{ marginTop: 4 }}>Nothing received, so this bill is saved as Credit.</div>}
            </div>
            <hr />
            <div className="srow sub"><span>Total received</span><b>{money(totals.paid + totals.oldPaid)}</b></div>
            <div className={`bl-due${totals.totalDue > 0 ? "" : " clear"}`}>
              <span>{totals.totalDue > 0 ? "Balance due" : "Fully paid"}</span><span>{money(totals.totalDue)}</span>
            </div>
          </div>

          <div className="card bl-actions">
            <button type="button" className="primary full big" disabled={busy} onClick={() => save("print")}>
              {busy ? "Saving…" : editing ? "Update & Print" : "Save & Print"}
            </button>
            {editing ? (
              <button type="button" disabled={busy} onClick={() => save("view")}>Update</button>
            ) : (
              <button type="button" disabled={busy || Boolean(orderId || quotationId)} onClick={() => save("new")}>Save & New</button>
            )}
            {editing ? (
              <button type="button" onClick={cancel}>Cancel</button>
            ) : (
              <button type="button" disabled={busy} onClick={saveDraft}>Save Draft</button>
            )}
            {!editing && <button type="button" className="full" onClick={cancel}>Cancel</button>}
            <div className="bl-hint full">Enter adds an item · Ctrl + Enter saves & prints</div>
          </div>
        </aside>
      </div>

      {showNewCust && (
        <CustomerForm
          initial={{}}
          onClose={() => setShowNewCust(false)}
          onSaved={(c) => {
            setShowNewCust(false);
            if (c?.id) pickCustomer(c);
            else setNotice({ text: "Customer created. Search for them above to select." });
          }}
        />
      )}
    </>
  );
}