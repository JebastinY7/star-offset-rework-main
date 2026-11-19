import { useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { errorText } from "../api";
import { useAuth } from "../AuthContext";
import Icon from "./Icon";
import { NAV } from "./navConfig";
import "../sidebarBrand.css";

const MAX_MB = 2;

export default function Sidebar({ mobileOpen, onClose }) {
  const { shop, uploadLogo } = useAuth();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allows choosing the same file again
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Choose an image file."); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setError(`The logo must be ${MAX_MB} MB or smaller.`); return; }
    setError(""); setBusy(true);
    try { await uploadLogo(file); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };

  const name = shop?.name || "Shop Portal";

  return (
    <aside className={`sidebar${mobileOpen ? " open" : ""}`}>
      <div className="sb-brand">
        {shop?.logo_url ? (
          <img src={shop.logo_url} alt={`${name} logo`} className="sb-logo" />
        ) : (
          <button type="button" className="sb-logo-add" onClick={() => fileRef.current?.click()} disabled={busy}
            title="Click here to add logo" aria-label="Click here to add logo">
            <Icon name="plus" size={16} />
          </button>
        )}
        <div className="sb-brand-text">
          <strong title={name}>{name}</strong>
          {shop?.logo_url
            ? <span>Shop Portal</span>
            : <button type="button" className="sb-add-link" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? "Uploading…" : "Click here to add logo"}
              </button>}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pick} />
        <button type="button" className="icon-btn sb-close" onClick={onClose} aria-label="Close menu"><Icon name="close" /></button>
      </div>
      {error && <div className="sb-logo-error" role="alert">{error}</div>}

      <nav className="sb-nav" aria-label="Main">
        {NAV.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} title={i.label} onClick={onClose}
            className={({ isActive }) => `sb-link${isActive ? " active" : ""}`}>
            <Icon name={i.icon} size={20} />
            <span className="sb-label">{i.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sb-help">
        <strong>Need help?</strong>
        <span>Contact Star Offset</span>
        <NavLink to="/contact" onClick={onClose} className="sb-help-btn"><Icon name="phone" size={16} /> Contact Support</NavLink>
      </div>
    </aside>
  );
}
