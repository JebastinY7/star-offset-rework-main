import { useEffect, useMemo, useState } from "react";
import api from "../api";
import "./VisitingCardSetup.css";

const GSM_OPTIONS = ["100 GSM", "130 GSM", "170 GSM", "220 GSM", "250 GSM", "300 GSM"];
const DIGITAL_LAMINATIONS = [
  "Without Lamination", "Single Side (Glossy)", "Double Side (Glossy)",
  "Single Side (3D)", "Double Side (3D)", "Single Side (Matt)", "Double Side (Matt)",
];
const OFFSET_LAMINATIONS = {
  single: ["Single Side (Glossy)", "Single Side (Matt)"],
  double: ["Double Side (Glossy)", "Double Side (Matt)"],
};
const DEFAULTS = { method: "", gsm: "", size: "3.5 x 2", sides: "", lamination: "", qty: "", jobs: "1" };
const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function VisitingCardSetup({
  onAdd, initial, title = "Visiting Card configuration", addLabel = "Add visiting card",
  priceType = "customer", priceEndpoint = "/billing/visiting-card-price/", allowRateTypeChange = false,
}) {
  const [form, setForm] = useState(() => {
    const next = { ...DEFAULTS, ...(initial || {}), size: "3.5 x 2" };
    if (!["digital", "offset"].includes(next.method)) next.method = "";
    if (!["single", "double"].includes(next.sides)) next.sides = "";
    if (!next.lamination) next.lamination = next.method === "digital" ? "Without Lamination" : "";
    return next;
  });
  const [activePriceType, setActivePriceType] = useState(priceType === "shop" ? "shop" : "customer");
  const [price, setPrice] = useState(null);
  const [priceError, setPriceError] = useState("");
  const [pricing, setPricing] = useState(false);
  const quantity = Number(form.qty || 0);
  const jobs = Number(form.jobs || 0);
  const offset = form.method === "offset";
  const laminationOptions = offset ? (OFFSET_LAMINATIONS[form.sides] || []) : DIGITAL_LAMINATIONS;

  const update = (key, value) => setForm((current) => {
    const next = { ...current, [key]: value };
    if (key === "method") {
      next.gsm = "";
      next.sides = "";
      next.lamination = value === "digital" ? "Without Lamination" : "";
      next.qty = "";
      next.jobs = "1";
    }
    if (key === "sides") next.lamination = "";
    return next;
  });

  useEffect(() => {
    if (!allowRateTypeChange) setActivePriceType(priceType === "shop" ? "shop" : "customer");
  }, [priceType, allowRateTypeChange]);

  useEffect(() => {
    let cancelled = false;
    const validQty = offset ? [500, 1000].includes(quantity) : quantity >= 1 && quantity <= 1000000;
    const commonReady = Boolean(form.method && form.sides && form.lamination && validQty && jobs >= 1 && jobs <= 10000);
    const digitalReady = !offset ? Boolean(form.gsm && commonReady) : commonReady;
    if (!digitalReady) {
      setPrice(null); setPriceError(""); setPricing(false);
      return undefined;
    }
    setPricing(true); setPrice(null); setPriceError("");
    const timer = setTimeout(() => {
      api.get(priceEndpoint, { params: {
        gsm: form.gsm, size: "3.5 x 2", qty: quantity, sides: form.sides,
        lamination: form.lamination, price_type: activePriceType, method: form.method, jobs,
      } }).then((response) => {
        if (cancelled) return;
        if (response.data?.available) setPrice(response.data);
        else setPriceError(response.data?.error || "Price is not available for this selection.");
      }).catch((error) => {
        if (!cancelled) setPriceError(error.response?.data?.error || "Unable to calculate the visiting card price.");
      }).finally(() => { if (!cancelled) setPricing(false); });
    }, 160);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.method, form.gsm, form.sides, form.lamination, quantity, jobs, activePriceType, priceEndpoint, offset]);

  const summary = useMemo(() => {
    const bits = [`Printing Type: ${form.method ? form.method[0].toUpperCase() + form.method.slice(1) : ""}`];
    if (!offset) bits.push(`GSM: ${form.gsm}`, "Size: 3.5 x 2");
    bits.push(`Print Variant: ${form.sides === "single" ? "Single side" : "Double side"}`, `Lamination: ${form.lamination}`, `Quantity: ${quantity.toLocaleString("en-IN")}`);
    if (offset) bits.push(`Jobs: ${jobs}`);
    return bits.join(" · ");
  }, [form, quantity, jobs, offset]);

  const ready = Boolean(price && !pricing);
  const submit = () => {
    if (!ready) return;
    const visitingCard = {
      method: form.method, gsm: offset ? "" : form.gsm, size: "3.5 x 2", sides: form.sides,
      lamination: form.lamination, qty: quantity, jobs: offset ? jobs : 1, priceType: activePriceType,
    };
    onAdd?.({
      billingType: "visiting", name: `Visiting Card — ${summary}`, qty: quantity,
      job: offset ? jobs : 1, price: Number(price.unit_price), gross: Number(price.total),
      discount: 0, extraCharge: 0, extraPurpose: "", total: Number(price.total),
      estimate: Number(price.total), visitingCard,
    });
    setForm(DEFAULTS); setPrice(null); setPriceError("");
  };

  return (
    <section className="vc-setup card">
      <h3>{title}</h3>
      <div className="vc-section-title">Printing Type</div>
      <div className="vc-fields">
        <label>Printing Type
          <select value={form.method} onChange={(e) => update("method", e.target.value)}>
            <option value="">Select your type</option><option value="offset">Offset</option><option value="digital">Digital</option>
          </select>
        </label>
      </div>
      {allowRateTypeChange && <div className="vc-rate-toggle" role="group" aria-label="Visiting card price type">
        <span>Price list:</span>{[["customer", "Customer"], ["shop", "Shop"]].map(([value, label]) => (
          <button type="button" key={value} className={activePriceType === value ? "active" : ""} onClick={() => setActivePriceType(value)}>{label}</button>
        ))}
      </div>}
      {form.method && <>
        <div className="vc-section-title">Other selections</div>
        <div className="vc-fields">
          {!offset && <>
            <label>1. GSM<select value={form.gsm} onChange={(e) => update("gsm", e.target.value)}>
              <option value="">Select GSM</option>{GSM_OPTIONS.map((gsm) => <option key={gsm} value={gsm}>{gsm}</option>)}
            </select></label>
            <label>2. Size<input type="text" value="3.5 x 2" readOnly /></label>
          </>}
          <label>{offset ? "1. Print Variant" : "3. Print Variant"}
            <select value={form.sides} onChange={(e) => update("sides", e.target.value)}>
              <option value="">Select print variant</option><option value="single">Single side</option><option value="double">Double side</option>
            </select>
          </label>
          <label>{offset ? "2. Lamination" : "4. Lamination"}
            <select value={form.lamination} onChange={(e) => update("lamination", e.target.value)} disabled={!form.sides}>
              <option value="">Select lamination</option>{laminationOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>{offset ? "3. Quantity" : "5. Quantity"}
            {offset ? <select value={form.qty} onChange={(e) => update("qty", e.target.value)}>
              <option value="">Select quantity</option><option value="500">500</option><option value="1000">1000</option>
            </select> : <input type="number" min="1" max="1000000" step="1" value={form.qty} placeholder="Enter quantity" onChange={(e) => update("qty", e.target.value.replace(/\D/g, "").slice(0, 7))} />}
          </label>
          {offset && <label>4. Job
            <input type="number" min="1" max="10000" step="1" value={form.jobs} onChange={(e) => update("jobs", e.target.value.replace(/\D/g, "").slice(0, 5))} />
          </label>}
        </div>
      </>}
      <div className="vc-price-preview" aria-live="polite">
        {pricing && <span>Calculating price…</span>}
        {!pricing && price && (offset ? <>
          <span>Price per job: <strong>{money(price.job_price)}</strong></span>
          <span>Jobs: <strong>{price.jobs}</strong></span>
          <span className="vc-total">Estimated total: <strong>{money(price.total)}</strong></span>
        </> : <>
          <span>Printing rate per card: <strong>{money(price.base_unit_price)}</strong></span>
          <span>Lamination per card: <strong>{money(price.lamination_unit_price)}</strong></span>
          <span>Quantity slab: <strong>{price.quantity_slab}</strong></span>
          <span className="vc-total">Total per card: <strong>{money(price.unit_price)}</strong></span>
          <span className="vc-total">Estimated total: <strong>{money(price.total)}</strong></span>
        </>)}
        {!pricing && priceError && <span className="vc-price-error">{priceError}</span>}
        {!pricing && !price && !priceError && <span>{form.method ? "Select the required options to view price." : "Select Digital or Offset to configure this visiting card."}</span>}
      </div>
      <div className="vc-footer">
        <span className="vc-hint">{offset ? "Offset price is for each 500/1000-card job; total is multiplied by Job." : "Digital rates include the selected digital lamination charge."}</span>
        <button type="button" className="primary" disabled={!ready} onClick={submit}>{addLabel}</button>
      </div>
    </section>
  );
}
