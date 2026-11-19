import { useEffect, useState } from "react";
import api from "../api";
import { MAX_QTY, money, useSpecs } from "../serviceConfig";

function Field({ label, options, value, onChange, placeholder }) {
  return (
    <div className="spec-row">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder || `Select ${label.toLowerCase()}`}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// Specification dropdowns + quantity + live price for one service.
// `children` is a function that receives the current choice and draws whatever comes next:
//   ({ complete, pricing, params, spec, qty, estimate, choices, qtyText }) => JSX
// Mount it with a changing `key` to start from a blank form.
export default function ServiceConfigurator({ data, initial, children }) {
  // `initial` ({ sel, qty }) pre-fills the form, e.g. the choices made on the price page
  const [sel, setSel] = useState(initial?.sel || {});
  const [qty, setQty] = useState(initial?.qty || "");
  const [price, setPrice] = useState({ key: "", data: null });
  const { fields, ready, params, spec } = useSpecs(data, sel);

  const qtyNum = /^\d+$/.test(qty) ? parseInt(qty, 10) : 0;
  const qtyOk = qtyNum >= 1 && qtyNum <= MAX_QTY;
  const complete = ready && qtyOk;
  const paramsKey = complete ? new URLSearchParams({ ...params, qty: qtyNum }).toString() : "";

  // ask the server for the price a moment after the shop stops changing things
  useEffect(() => {
    if (!paramsKey) return undefined;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api.get(`/shop/price/?${paramsKey}`, { signal: ctrl.signal })
        .then((r) => setPrice({ key: paramsKey, data: r.data }))
        .catch((e) => { if (e.code !== "ERR_CANCELED") setPrice({ key: paramsKey, data: { available: false, failed: true } }); });
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [paramsKey]);

  const result = paramsKey && price.key === paramsKey ? price.data : null;
  const pricing = complete && !result;
  const estimate = result?.available ? Number(result.estimate) : null;

  return (
    <>
      <div className="card spec-card">
        {fields.map((f) => (
          <Field key={f.key} label={f.label} options={f.options} value={f.value} placeholder={f.placeholder}
            onChange={(v) => setSel((s) => ({ ...s, [f.key]: v }))} />
        ))}
        <div className="spec-row">
          <label htmlFor="qty">Quantity</label>
          <div>
            <input id="qty" inputMode="numeric" value={qty} placeholder="Enter quantity"
              onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 7))} />
            {qty && !qtyOk && <small className="hint warn">Enter a quantity between 1 and {MAX_QTY.toLocaleString("en-IN")}.</small>}
          </div>
        </div>
      </div>

      <div className="card estimate" aria-live="polite">
        <span className="stat-label">Estimated Price</span>
        <span className="estimate-value">{estimate != null ? money(estimate) : "₹ —"}</span>
        <span className="muted small">
          {pricing ? "Calculating…"
            : result && !result.available ? (result.failed ? "Could not get the price. Please try again." : "No price for these options. Star Offset will quote it when you order.")
            : result?.discount_percent > 0 ? `Price based on selected options, after ${result.discount_percent}% shop discount`
            : "Price based on selected options"}
        </span>
      </div>

      {children?.({
        complete, pricing, params: { ...params, qty: qtyNum }, spec, qty: qtyNum, estimate,
        choices: Object.fromEntries(fields.filter((f) => f.value).map((f) => [f.key, f.value])), qtyText: qty,
      })}
    </>
  );
}