import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Icon from "../components/Icon";
import ServiceConfigurator from "../components/ServiceConfigurator";
import { useServiceData } from "../serviceConfig";
import "../orderflow.css";

// Price view only: pick specifications to see a price.  Ordering happens on the Place an Order page.
export default function ServiceDetail() {
  const { kind, id } = useParams();
  const { data, error } = useServiceData(`${kind}/${id}`);
  const [preferredFont, setPreferredFont] = useState("");

  const back = <Link to="/prices" className="back-link"><Icon name="arrowleft" size={16} /> Back to Printing Prices</Link>;
  if (error) return <div className="detail">{back}<p className="alert error">{error}</p></div>;
  if (!data) return <div className="detail">{back}<p className="muted">Loading…</p></div>;

  const isDtp = (data.name || "").trim().toLowerCase() === "dtp";

  return (
    <div className="detail">
      {back}
      <h1 className="detail-title">{data.name}</h1>
      <p className="muted detail-sub">Choose your specifications to see the price. This page is for checking prices only.</p>

      {isDtp && (
        <section className="card dtp-preferences dtp-price-preferences">
          <h3>DTP typography preferences</h3>
          <p className="muted small">Choose the preferred font. This will be carried into your order.</p>
          <div className="dtp-fields">
            <div className="dtp-field"><label htmlFor="price-dtp-font">Preferred font</label><input id="price-dtp-font" maxLength={100} placeholder="e.g. Arial, Times New Roman, Latha" value={preferredFont} onChange={(e) => setPreferredFont(e.target.value)} /></div>
          </div>
        </section>
      )}

      <h2 className="dash-h">Specifications</h2>
      <ServiceConfigurator data={data}>
        {({ choices, qtyText }) => (
          <div className="detail-actions">
            <Link to={`/orders/new?${new URLSearchParams({ service: `${kind}/${id}`, ...choices, ...(qtyText ? { qty: qtyText } : {}), ...(isDtp && preferredFont.trim() ? { preferred_font: preferredFont.trim() } : {}) })}`} className="btn-link primary big add-btn"><Icon name="cart" size={18} /> Order This Service</Link>
            <Link to="/prices" className="btn-link big add-btn">All Prices</Link>
          </div>
        )}
      </ServiceConfigurator>
    </div>
  );
}