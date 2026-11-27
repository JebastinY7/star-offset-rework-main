import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import { useCart } from "../CartContext";
import ArtworkPicker, { totalSize } from "../components/ArtworkPicker";
import Icon from "../components/Icon";
import ServiceConfigurator from "../components/ServiceConfigurator";
import VisitingCardSetup from "../components/VisitingCardSetup";
import { money, useServiceData } from "../serviceConfig";
import "../orderflow.css";

const SPEC_KEYS = ["paper", "size", "side", "finish", "delivery", "variant"];
const GROUPS = [{ kind: "digital", label: "Digital Printing" }, { kind: "normal", label: "Standard Services" }];

// Place an Order: build the order one item at a time (service -> specifications -> artwork -> Add to Cart).
// The finished items are reviewed and sent from the Order Cart.
export default function PlaceOrder() {
  const [query] = useSearchParams();
  const { items, addItem, filesOf } = useCart();
  const [services, setServices] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [choice, setChoice] = useState(query.get("service") || ""); // "kind/id"
  // choices carried over from the price page (?service=..&size=..&qty=..) pre-fill the form
  const [preset, setPreset] = useState(() => ({
    service: query.get("service") || "",
    sel: Object.fromEntries(SPEC_KEYS.filter((k) => query.get(k)).map((k) => [k, query.get(k)])),
    qty: /^\d{1,7}$/.test(query.get("qty") || "") ? query.get("qty") : "",
  }));
  const [files, setFiles] = useState([]);
  const [dtp, setDtp] = useState(() => ({ fontFamily: query.get("preferred_font") || "", fontSize: "", notes: "" }));
  const isVisitingCardChoice = choice === "visiting-card";
  const { data, error } = useServiceData(isVisitingCardChoice ? "" : choice);
  const isDtp = (data?.name || "").trim().toLowerCase() === "dtp";
  const isVisitingCard = isVisitingCardChoice || (data?.name || "").trim().toLowerCase() === "visiting card";
  const [round, setRound] = useState(0); // changes after each "Add to Cart" so the next item starts blank
  const [lastAdded, setLastAdded] = useState("");

  useEffect(() => {
    api.get("/shop/services/")
      .then((r) => setServices(r.data.services))
      .catch((e) => { setLoadError(errorText(e)); setServices([]); });
  }, []);

  // what the other cart items already hold (order limits are shared)
  const cartFiles = items.flatMap((i) => filesOf(i.id));

  const add = (s) => {
    if (isDtp && (!dtp.fontFamily.trim() || !(Number(dtp.fontSize) >= 1 && Number(dtp.fontSize) <= 200))) return;
    const dtpDetails = isDtp ? {
      font_family: dtp.fontFamily.trim(), font_size: dtp.fontSize.trim(),
      notes: dtp.notes.trim(),
    } : null;
    const dtpSpec = dtpDetails ? [
      { label: "Preferred Font", value: dtpDetails.font_family },
      { label: "Font Size", value: `${dtpDetails.font_size} pt` },
      ...(dtpDetails.notes ? [{ label: "DTP Instructions", value: dtpDetails.notes }] : []),
    ] : [];
    addItem({ dtp_details: dtpDetails, service_name: data.name, kind: data.kind, service_id: data.id, qty: s.qty, spec: [...s.spec, ...dtpSpec], estimate: s.estimate, params: s.params }, files);
    setLastAdded(`${data.name} × ${s.qty.toLocaleString("en-IN")}`);
    setFiles([]);
    setDtp({ fontFamily: "", fontSize: "", notes: "" });
    setChoice("");
    setPreset(null);
    setRound((r) => r + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="pf">
      <div className="page-head">
        <div>
          <h1>Place an Order</h1>
          <p className="muted">Add your printing items one by one with their artwork, then place the complete order from the Order Cart.</p>
        </div>
        <Link to="/cart" className="btn-link primary cart-btn"><Icon name="cart" size={16} /> Order Cart ({items.length})</Link>
      </div>

      {lastAdded && (
        <p className="alert ok pf-added"><Icon name="check" size={16} /> {lastAdded} added to your Order Cart. Add another item below, or <Link to="/cart">go to the cart</Link> to place the order.</p>
      )}

      <div className="pf-grid">
        <div className="pf-main" key={round}>
          <section className="card pf-step">
            <h2><span className="step-no">1</span> Choose printing service</h2>
            {loadError && <p className="alert error">{loadError}</p>}
            <select value={choice} onChange={(e) => { setChoice(e.target.value); if (e.target.value !== preset?.service) setPreset(null); }} disabled={services === null} aria-label="Printing service">
              <option value="">{services === null ? "Loading services…" : "Select a printing service"}</option>
              <option value="visiting-card">Visiting Card — configure options</option>
              {GROUPS.map((g) => {
                const list = (services || []).filter((s) => s.kind === g.kind).sort((a, b) => a.name.localeCompare(b.name));
                return list.length ? (
                  <optgroup key={g.kind} label={g.label}>
                    {list.map((s) => <option key={s.key} value={`${s.kind}/${s.id}`}>{s.name}{s.from_price != null ? ` — from ${money(s.from_price)}` : ""}</option>)}
                  </optgroup>
                ) : null;
              })}
            </select>
            <p className="muted small">Want to compare rates first? <Link to="/prices">Browse printing prices</Link></p>
          </section>

          {isVisitingCard && (
          <VisitingCardSetup title="Visiting Card configuration" addLabel="Add Visiting Card to Cart"
            priceType="shop" priceEndpoint="/shop/visiting-card-price/"
            initial={query.get("visiting_card") === "1" ? {
              method: query.get("method") || "", gsm: query.get("gsm") || "",
              size: "3.5 x 2", lamination: query.get("lamination") || "Without Lamination",
              sides: query.get("sides") || "", qty: query.get("qty") || "", jobs: query.get("jobs") || "1",
            } : undefined}
            onAdd={(item) => {
              const vc = item.visitingCard;
              const spec = [
                { label: "Printing Type", value: vc.method === "digital" ? "Digital" : "Offset" },
                ...(vc.method === "offset" ? [] : [
                  { label: "GSM", value: vc.gsm },
                  { label: "Size", value: vc.size },
                ]),
                { label: "Print Variant", value: vc.sides === "single" ? "Single side" : "Double side" },
                { label: "Lamination", value: vc.lamination },
                ...(vc.method === "offset" ? [{ label: "Jobs", value: String(vc.jobs || 1) }] : []),
              ];
              addItem({ kind: "visiting", service_name: "Visiting Card", qty: vc.qty, spec, params: { kind: "visiting", qty: vc.qty, visiting_card: vc }, estimate: item.estimate }, files);
              setLastAdded(`Visiting Card × ${Number(vc.qty).toLocaleString("en-IN")}`);
              setFiles([]);
              setChoice("");
              setPreset(null);
              setRound((r) => r + 1);
            }} />
          )}
          {error && <p className="alert error">{error}</p>}
          {choice && !isVisitingCard && !data && !error && <p className="muted">Loading…</p>}

          {data && (
            <>
            {!isVisitingCard && <h2 className="pf-h"><span className="step-no">2</span> {data.name}: specifications and quantity</h2>}
            {isDtp && (
              <section className="card pf-step dtp-preferences">
                <h3>DTP typography preferences</h3>
                <p className="muted small">These details will be sent to the production team with this item.</p>
                <div className="dtp-fields">
                  <div className="dtp-field"><label htmlFor="dtp-font">Preferred font <span>*</span></label><input id="dtp-font" maxLength={100} placeholder="e.g. Arial, Times New Roman, Latha" value={dtp.fontFamily} onChange={(e) => setDtp((d) => ({ ...d, fontFamily: e.target.value }))} /></div>
                  <div className="dtp-field"><label htmlFor="dtp-size">Font size (pt) <span>*</span></label><input id="dtp-size" type="number" min="1" max="200" step="0.5" placeholder="e.g. 12" value={dtp.fontSize} onChange={(e) => setDtp((d) => ({ ...d, fontSize: e.target.value }))} /></div>
                  <div className="dtp-field dtp-field-notes"><label htmlFor="dtp-notes">Layout / formatting preferences <small>(optional)</small></label><textarea id="dtp-notes" rows={3} maxLength={500} placeholder="Heading font, alignment, spacing, bold text, page layout…" value={dtp.notes} onChange={(e) => setDtp((d) => ({ ...d, notes: e.target.value }))} /></div>
                </div>
              </section>
            )}
            {!isVisitingCard && <ServiceConfigurator key={choice} data={data} initial={preset?.service === choice ? preset : undefined}>
              {(s) => (
                <>
                  <section className="card pf-step">
                    <h2><span className="step-no">3</span> Artwork files for this item <span className="muted small">(optional)</span></h2>
                    <ArtworkPicker id="item-files" files={files} onChange={setFiles} otherBytes={totalSize(cartFiles)} otherCount={cartFiles.length} />
                  </section>
                  <div className="pf-add">
                    <button type="button" className="primary big" disabled={!s.complete || s.pricing || (isDtp && (!dtp.fontFamily.trim() || !(Number(dtp.fontSize) >= 1 && Number(dtp.fontSize) <= 200)))} onClick={() => add(s)}>
                      <Icon name="cart" size={18} /> Add to Cart
                    </button>
                    {!s.complete && <span className="muted small">Select every option and enter a quantity to add this item.</span>}
                  </div>
                </>
              )}
            </ServiceConfigurator>}
            </>
          )}
        </div>

        <aside className="card pf-aside">
          <h3>Order Cart</h3>
          {items.length === 0 ? <p className="muted small">No items yet. Items you add appear here.</p> : (
            <ul className="mini-items">
              {items.map((i, n) => (
                <li key={i.id}>
                  <b>{n + 1}. {i.service_name}</b>
                  <span className="muted small">Qty {Number(i.qty).toLocaleString("en-IN")} · {filesOf(i.id).length} file{filesOf(i.id).length === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/cart" className={`btn-link${items.length ? " primary" : ""}`}>{items.length ? "Go to Cart & Place Order" : "View Order Cart"}</Link>
        </aside>
      </div>
    </div>
  );
}