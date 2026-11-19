import { useEffect, useState } from "react";
import api, { errorText } from "./api";

export const MAX_QTY = 1000000;
export const money = (v) => `₹${Number(v).toLocaleString("en-IN")}`;
const opt = (value, label) => ({ value: String(value), label });

// the chosen value if it is still one of the options; a lone option is picked for the shop
const pick = (options, chosen) =>
  options.some((o) => o.value === chosen) ? chosen : options.length === 1 ? options[0].value : "";

// Works out every dropdown from the options tree + what the shop has chosen so far.
// Digital: Paper > Size > Printing side > Finish (> Delivery).  Standard: Size > Option.
export function useSpecs(data, sel) {
  if (!data) return { fields: [], ready: false, params: {}, spec: [] };

  if (data.kind === "digital") {
    const paperOpts = data.papers.map((p) => opt(p.id, p.name));
    const paperV = pick(paperOpts, sel.paper);
    const paper = data.papers.find((p) => String(p.id) === paperV);

    const sizeOpts = (paper?.sizes || []).map((s) => opt(s.id, s.name));
    const sizeV = pick(sizeOpts, sel.size);
    const size = paper?.sizes.find((s) => String(s.id) === sizeV);

    // sides = every side this size is sold in; finishes = those that offer the chosen side
    const sideMap = new Map();
    (size?.finishes || []).forEach((f) => f.sides.forEach((s) => sideMap.set(s.value || "_", s.label)));
    const sideOpts = [...sideMap].map(([v, l]) => opt(v, l));
    const sideV = pick(sideOpts, sel.side);

    const finishes = (size?.finishes || []).filter((f) => !sideV || f.sides.some((s) => (s.value || "_") === sideV));
    const finishOpts = finishes.map((f) => opt(f.id, f.name));
    const finishV = pick(finishOpts, sel.finish);
    const finish = finishes.find((f) => String(f.id) === finishV);

    const deliveryOpts = (finish?.deliveries || []).map((d) => opt(d.id, d.name));
    const deliveryV = pick(deliveryOpts, sel.delivery);

    const fields = [
      { key: "paper", label: "Paper Type", options: paperOpts, value: paperV },
      { key: "size", label: "Size", options: sizeOpts, value: sizeV },
      { key: "side", label: "Printing", options: sideOpts, value: sideV, placeholder: "Select printing side" },
      { key: "finish", label: "Finish", options: finishOpts, value: finishV },
      ...(deliveryOpts.length > 1 ? [{ key: "delivery", label: "Delivery", options: deliveryOpts, value: deliveryV }] : []),
    ];
    const ready = !!(paperV && sizeV && sideV && finishV && deliveryV);
    const label = (o, v) => o.find((x) => x.value === v)?.label;
    return {
      fields, ready,
      params: { kind: "digital", lamination_id: finishV, side: sideV === "_" ? "" : sideV, delivery_id: deliveryV },
      spec: ready ? [
        { label: "Paper Type", value: label(paperOpts, paperV) }, { label: "Size", value: label(sizeOpts, sizeV) },
        { label: "Printing", value: label(sideOpts, sideV) }, { label: "Finish", value: label(finishOpts, finishV) },
        ...(deliveryOpts.length > 1 ? [{ label: "Delivery", value: label(deliveryOpts, deliveryV) }] : []),
      ] : [],
    };
  }

  const sizeOpts = data.sizes.map((s) => opt(s.id, s.name));
  const sizeV = pick(sizeOpts, sel.size);
  const size = data.sizes.find((s) => String(s.id) === sizeV);
  const variantOpts = (size?.variants || []).map((v) => opt(v.id, v.name));
  const variantV = pick(variantOpts, sel.variant);
  const needsVariant = variantOpts.length > 0;
  const fields = [
    { key: "size", label: "Size", options: sizeOpts, value: sizeV },
    ...(needsVariant ? [{ key: "variant", label: "Option", options: variantOpts, value: variantV }] : []),
  ];
  const ready = !!(sizeV && (!needsVariant || variantV));
  const label = (o, v) => o.find((x) => x.value === v)?.label;
  return {
    fields, ready,
    params: { kind: "normal", service_id: data.id, size_id: sizeV, variant_id: variantV },
    spec: ready ? [
      { label: "Size", value: label(sizeOpts, sizeV) },
      ...(needsVariant ? [{ label: "Option", value: label(variantOpts, variantV) }] : []),
    ] : [],
  };
}

// Loads one service ("kind/id") with all its options.  data stays null until the right service has arrived.
export function useServiceData(where) {
  const [loaded, setLoaded] = useState({ where: "", data: null, error: "" });
  useEffect(() => {
    if (!where) return undefined;
    let live = true;
    api.get(`/shop/services/${where}/`)
      .then((r) => live && setLoaded({ where, data: r.data, error: "" }))
      .catch((e) => live && setLoaded({ where, data: null, error: e.response?.status === 404 ? "This service was not found." : errorText(e) }));
    return () => { live = false; };
  }, [where]);
  const current = loaded.where === where && where;
  return { data: current ? loaded.data : null, error: current ? loaded.error : "" };
}