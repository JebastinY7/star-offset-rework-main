import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import ServiceConfigurator from "../components/ServiceConfigurator";
import { useServiceData } from "../serviceConfig";

const printTypeKey = (name = "") => {
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (n.includes("executive bond")) return "bond";
  if (n.includes("inkjet") && (n.includes("color") || n.includes("colour"))) return "inkjet";
  if (n.includes("laser") && (n.includes("color") || n.includes("colour"))) return "laser";
  if ((n.includes("black white") || n.includes("black and white")) && !n.includes("color")) return "bw";
  return "";
};
const PRINT_TYPE_LABELS = { bw: "Black & White Print", bond: "Executive Bond Print", inkjet: "Color Inkjet Print", laser: "Color Laser Print" };

export default function PrintingServiceDetail() {
  const [services, setServices] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    api.get("/shop/services/")
      .then((r) => {
        const matches = (r.data.services || [])
          .filter((s) => printTypeKey(s.name))
          .sort((a, b) => Object.keys(PRINT_TYPE_LABELS).indexOf(printTypeKey(a.name)) - Object.keys(PRINT_TYPE_LABELS).indexOf(printTypeKey(b.name)));
        setServices(matches);
        if (matches.length) setSelected(`${matches[0].kind}/${matches[0].id}`);
      })
      .catch((e) => setLoadError(errorText(e)));
  }, []);

  const { data, error } = useServiceData(selected);
  const current = useMemo(() => services.find((s) => `${s.kind}/${s.id}` === selected), [services, selected]);
  const back = <Link to="/prices" className="back-link"><Icon name="arrowleft" size={16} /> Back to Printing Prices</Link>;
  if (loadError) return <div className="detail">{back}<p className="alert error">{loadError}</p></div>;
  if (!services.length) return <div className="detail">{back}<p className="muted">Loading printing options…</p></div>;

  return (
    <div className="detail">
      {back}
      <h1 className="detail-title">Printing</h1>
      <p className="muted detail-sub">Choose the type of printing, specifications and quantity to see the price.</p>
      <div className="card spec-card">
        <div className="spec-row">
          <label htmlFor="print-type">Printing Type</label>
          <select id="print-type" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {services.map((s) => <option key={`${s.kind}/${s.id}`} value={`${s.kind}/${s.id}`}>{PRINT_TYPE_LABELS[printTypeKey(s.name)] || s.name}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="alert error">{error}</p>}
      {!data && !error && <p className="muted">Loading specifications…</p>}
      {data && <>
        <h2 className="dash-h">{PRINT_TYPE_LABELS[printTypeKey(current?.name || data.name)] || current?.name || data.name} Specifications</h2>
        <ServiceConfigurator key={selected} data={data}>
          {({ choices, qtyText }) => (
            <div className="detail-actions">
              <Link to={`/orders/new?${new URLSearchParams({ service: selected, ...choices, ...(qtyText ? { qty: qtyText } : {}) })}`} className="btn-link primary big add-btn"><Icon name="cart" size={18} /> Order This Service</Link>
              <Link to="/prices" className="btn-link big add-btn">All Prices</Link>
            </div>
          )}
        </ServiceConfigurator>
      </>}
    </div>
  );
}
