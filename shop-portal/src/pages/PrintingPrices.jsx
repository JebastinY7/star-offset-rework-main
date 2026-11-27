import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import VisitingCardSetup from "../components/VisitingCardSetup";

const PAGE_SIZE = 9;
const KINDS = [
  { value: "", label: "All Services" },
  { value: "digital", label: "Digital Printing" },
  { value: "normal", label: "Standard Services" },
];
const SORTS = [
  { value: "name", label: "Name (A–Z)" },
  { value: "low", label: "Price: Low to High" },
  { value: "high", label: "Price: High to Low" },
];
const money = (v) => `₹${Number(v).toLocaleString("en-IN")}`;

// Accept both the new display labels and legacy database category names.
const printTypeKey = (name = "") => {
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (n.includes("executive bond")) return "bond";
  if (n.includes("inkjet") && (n.includes("color") || n.includes("colour"))) return "inkjet";
  if (n.includes("laser") && (n.includes("color") || n.includes("colour"))) return "laser";
  if ((n.includes("black white") || n.includes("black and white")) && !n.includes("color")) return "bw";
  return "";
};
const isCombinedXeroxCategory = (name = "") =>
  /xerox\s+black\s*(?:&|and)\s*color/i.test(name) ||
  /black\s*(?:&|and)\s*color\s*xerox/i.test(name);

export default function PrintingPrices() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [selectedVisitingService, setSelectedVisitingService] = useState(null);
  const [services, setServices] = useState(null); // null = loading
  const [error, setError] = useState("");

  const q = params.get("q") || "";
  const kind = KINDS.some((k) => k.value === params.get("kind")) ? params.get("kind") : "";
  const sort = SORTS.some((s) => s.value === params.get("sort")) ? params.get("sort") : "name";
  const page = Math.max(parseInt(params.get("page"), 10) || 1, 1);

  useEffect(() => {
    api.get("/shop/services/")
      .then((r) => setServices(r.data.services))
      .catch((e) => { setError(errorText(e)); setServices([]); });
  }, []);

  // change a filter; any change except paging goes back to page 1
  const update = (changes) => {
    const next = new URLSearchParams(params);
    const withPage = { page: "", ...changes };
    Object.entries(withPage).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const raw = (services || []).filter((s) => !isCombinedXeroxCategory(s.name));
    const printItems = raw.filter((s) => Boolean(printTypeKey(s.name)));
    const others = raw.filter((s) => !printTypeKey(s.name));
    const minPrintPrice = printItems.reduce(
      (min, item) => item.from_price == null ? min : Math.min(min, Number(item.from_price)),
      Infinity,
    );
    const printGroup = printItems.length ? [{
      key: "printing-group", type: "printing-group", name: "Printing",
      description: `${printItems.length} print types`,
      from_price: Number.isFinite(minPrintPrice) ? minPrintPrice : null,
      searchTerms: "printing print black white black & white executive bond color colour inkjet laser",
    }] : [];
    const visitingCard = {
      key: "visiting-card", type: "visiting-card", kind: "visiting", id: 0,
      name: "Visiting Card", description: "Digital or Offset printing with custom specifications",
      from_price: null, searchTerms: "visiting card business card digital offset print",
    };
    const list = [...printGroup, visitingCard, ...others].filter((s) => {
      const matchesKind = !kind || (s.type === "printing-group"
        ? printItems.some((item) => item.kind === kind)
        : s.type === "visiting-card" ? ["normal", "digital"].includes(kind) : s.kind === kind);
      const searchable = `${s.name || ""} ${s.searchTerms || ""}`.toLowerCase();
      return matchesKind && (!term || searchable.includes(term) ||
        (s.type === "printing-group" && ["bw", "b&w", "black and white", "black white", "bond", "inkjet", "laser", "colour", "color"].some((alias) => term.includes(alias))));
    });
    const price = (s) => (s.from_price ?? Infinity);
    if (sort === "low") list.sort((a, b) => price(a) - price(b) || a.name.localeCompare(b.name));
    else if (sort === "high") list.sort((a, b) => (b.from_price ?? -1) - (a.from_price ?? -1) || a.name.localeCompare(b.name));
    else list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [services, q, kind, sort]);

  const pages = Math.max(Math.ceil(shown.length / PAGE_SIZE), 1);
  const current = Math.min(page, pages);
  const visible = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="prices">
      <div className="page-head">
        <div>
          <h1>Printing Prices</h1>
          <p className="muted">Check the price of any printing service. To order, use Place an Order.</p>
        </div>
        <Link to="/orders/new" className="btn-link primary cart-btn"><Icon name="plus" size={16} /> Place an Order</Link>
      </div>

      <div className="search-wide">
        <Icon name="search" size={16} />
        <input value={q} onChange={(e) => update({ q: e.target.value })} placeholder="Search by printing service, product or category..." aria-label="Search services" />
      </div>

      <h2 className="dash-h">Categories</h2>
      <div className="chips">
        {KINDS.map((k) => (
          <button type="button" key={k.value} className={`chip${kind === k.value ? " active" : ""}`} onClick={() => update({ kind: k.value })}>{k.label}</button>
        ))}
      </div>

      {selectedVisitingService && (
        <section className="card" style={{ marginBottom: 20 }}>
          <div className="dash-h-row">
            <h2 className="dash-h">Visiting Card configuration</h2>
            <button type="button" className="btn-link" onClick={() => setSelectedVisitingService(null)}>Cancel</button>
          </div>
          <VisitingCardSetup title="Configure Visiting Card" addLabel="Continue to Place Order"
            priceType="shop" priceEndpoint="/shop/visiting-card-price/"
            onAdd={(item) => {
              const vc = item.visitingCard;
              const query = new URLSearchParams({
                service: "visiting-card",
                visiting_card: "1", method: vc.method, gsm: vc.gsm, size: vc.size,
                lamination: vc.lamination, sides: vc.sides, qty: String(vc.qty), jobs: String(vc.jobs || 1),
                design: vc.design, design_notes: vc.designNotes || "",
              });
              navigate(`/orders/new?${query.toString()}`);
            }} />
        </section>
      )}
      <div className="dash-h-row">
        <h2 className="dash-h">Available Printing Services</h2>
        <label className="sort">Sort by:
          <select value={sort} onChange={(e) => update({ sort: e.target.value === "name" ? "" : e.target.value })}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {error && <p className="alert error">{error}</p>}
      {services === null && <p className="muted">Loading services…</p>}
      {services !== null && !error && shown.length === 0 && (
        <div className="card muted empty">{services.length === 0 ? "No printing services are available yet." : "No services match your search."}</div>
      )}

      <div className="service-grid">
        {visible.map((s) => (
          <div className="card service-card" key={s.key}>
            <h3>{s.name}</h3>
            <p className="muted">{s.description}</p>
            <div className="from">{s.from_price != null ? <>From <b>{money(s.from_price)}</b></> : <span className="muted">Price varies by options</span>}</div>
            {s.type === "visiting-card" ? (
              <button type="button" className="btn-link" onClick={() => { setSelectedVisitingService(s); window.scrollTo({ top: 0, behavior: "smooth" }); }}>View Price &amp; Configure <Icon name="arrow" size={16} /></button>
            ) : s.name.trim().toLowerCase() === "visiting card" ? (
              <button type="button" className="btn-link" onClick={() => { setSelectedVisitingService(s); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                Configure <Icon name="arrow" size={16} />
              </button>
            ) : (
              <Link to={s.type === "printing-group" ? "/prices/printing" : `/prices/${s.kind}/${s.id}`} className="btn-link">View Price <Icon name="arrow" size={16} /></Link>
            )}
          </div>
        ))}
      </div>

      {shown.length > 0 && (
        <div className="list-foot">
          <span className="muted">Showing {visible.length} of {shown.length} service{shown.length !== 1 ? "s" : ""}</span>
          {pages > 1 && (
            <div className="pager">
              <button type="button" disabled={current <= 1} onClick={() => update({ page: String(current - 1) })}><Icon name="arrowleft" size={15} /> Previous</button>
              <span className="muted">Page {current} of {pages}</span>
              <button type="button" disabled={current >= pages} onClick={() => update({ page: String(current + 1) })}>Next <Icon name="arrow" size={15} /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
