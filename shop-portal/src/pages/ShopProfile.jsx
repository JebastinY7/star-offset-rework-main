import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";
import "../profile.css";
import "../sidebarBrand.css";

const FIELDS = [
  { key: "owner_name", label: "Contact Person", icon: "user", type: "text", max: 100, autoComplete: "name" },
  { key: "phone", label: "Mobile Number", icon: "phone", type: "tel", max: 10, autoComplete: "tel-national", inputMode: "numeric" },
  { key: "email", label: "Email Address", icon: "mail", type: "email", max: 254, autoComplete: "email" },
  { key: "gst_number", label: "GST Number", icon: "receipt", type: "text", max: 15, upper: true, hint: "Optional · 15 characters, e.g. 32AABCU9603R1ZX" },
  { key: "address", label: "Shop Address", icon: "pin", type: "textarea", max: 500, wide: true },
];

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "S";
const since = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });

export default function ShopProfile() {
  const { shop, uploadLogo, removeLogo } = useAuth();
  const logoInput = useRef(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get("/shop/profile/").then((r) => setProfile(r.data.profile)).catch((e) => setError(errorText(e)));
  }, []);

  const pickLogo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setLogoError("Choose an image file."); return; }
    if (file.size > 2 * 1024 * 1024) { setLogoError("The logo must be 2 MB or smaller."); return; }
    setLogoError(""); setLogoBusy(true);
    try { await uploadLogo(file); } catch (err) { setLogoError(errorText(err)); } finally { setLogoBusy(false); }
  };

  const dropLogo = async () => {
    setLogoError(""); setLogoBusy(true);
    try { await removeLogo(); } catch (err) { setLogoError(errorText(err)); } finally { setLogoBusy(false); }
  };

  const startEdit = () => {
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, profile[f.key] || ""])));
    setError("");
    setSaved(false);
    setEditing(true);
  };

  const change = (f) => (e) => {
    let v = e.target.value;
    if (f.key === "phone") v = v.replace(/\D/g, "").slice(0, 10);
    if (f.upper) v = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
    setForm((old) => ({ ...old, [f.key]: v }));
  };

  const save = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const r = await api.patch("/shop/profile/", form);
      setProfile(r.data.profile);
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  if (!profile) {
    return <div className="sp"><h1>Shop Profile</h1>{error ? <p className="alert error">{error}</p> : <p className="muted">Loading…</p>}</div>;
  }
  const active = profile.status === "Active";

  return (
    <div className="sp">
      <div className="sp-hero">
        {shop?.logo_url
          ? <img className="sp-logo-img" src={shop.logo_url} alt={`${profile.shop_name} logo`} />
          : <span className="sp-avatar" aria-hidden="true">{initials(profile.shop_name)}</span>}
        <div className="sp-hero-main">
          <span className="sp-eyebrow">Shop Profile</span>
          <h1>{profile.shop_name}</h1>
          <div className="sp-facts">
            <span className="sp-fact"><Icon name="store" size={15} /> {profile.shop_id}</span>
            <span className="sp-fact"><Icon name="history" size={15} /> Member since {since(profile.member_since)}</span>
          </div>
          <div className="sp-logo-actions">
            <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pickLogo} />
            <button type="button" className="sp-logo-btn" onClick={() => logoInput.current?.click()} disabled={logoBusy}>
              <Icon name="edit" size={14} /> {logoBusy ? "Saving…" : shop?.logo_url ? "Change logo" : "Add logo"}
            </button>
            {shop?.logo_url && <button type="button" className="sp-logo-btn" onClick={dropLogo} disabled={logoBusy}>Remove logo</button>}
          </div>
          {logoError && <p className="sp-logo-err">{logoError}</p>}
        </div>
        <div className="sp-hero-side">
          <span className={`sp-status${active ? "" : " off"}`}><i /> {profile.status}</span>
          <span className="sp-managed"><Icon name="lock" size={13} /> Name, ID and status are admin managed</span>
        </div>
      </div>

      {saved && <p className="alert ok"><Icon name="check" size={16} /> Your contact details were updated.</p>}

      <div className="sp-grid">
        <section className="card sp-card">
          <div className="sp-head">
            <div>
              <h2>Contact Information</h2>
              <p className="muted small">How Star Offset reaches you about your orders.</p>
            </div>
            {!editing && <button type="button" className="sp-btn" onClick={startEdit}><Icon name="edit" size={15} /> Edit Details</button>}
          </div>

          {editing ? (
            <form onSubmit={save} noValidate>
              <div className="sp-items">
                {FIELDS.map((f) => (
                  <div className={`sp-field${f.wide ? " wide" : ""}`} key={f.key}>
                    <label htmlFor={`sp-${f.key}`}>{f.label}</label>
                    <div className="sp-input">
                      <Icon name={f.icon} size={17} />
                      {f.type === "textarea"
                        ? <textarea id={`sp-${f.key}`} rows={3} maxLength={f.max} value={form[f.key]} onChange={change(f)} />
                        : <input id={`sp-${f.key}`} type={f.type} maxLength={f.max} value={form[f.key]} onChange={change(f)} autoComplete={f.autoComplete} inputMode={f.inputMode} />}
                    </div>
                    {f.hint && <small className="muted">{f.hint}</small>}
                  </div>
                ))}
              </div>
              {error && <p className="alert error">{error}</p>}
              <div className="sp-actions">
                <button type="button" className="sp-btn" onClick={() => { setEditing(false); setError(""); }} disabled={saving}>Cancel</button>
                <button type="submit" className="primary" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
              </div>
            </form>
          ) : (
            <div className="sp-items">
              {FIELDS.map((f) => (
                <div className={`sp-item${f.wide ? " wide" : ""}`} key={f.key}>
                  <span className="sp-ico"><Icon name={f.icon} size={18} /></span>
                  <div>
                    <span className="sp-k">{f.label}</span>
                    {profile[f.key] ? <span className="sp-v">{profile[f.key]}</span> : <span className="sp-v none">Not provided</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="sp-side">
          <section className="card sp-card">
            <div className="sp-head"><div><h2>Login Information</h2><p className="muted small">Your portal sign-in details.</p></div></div>
            <div className="sp-items one">
              <div className="sp-item">
                <span className="sp-ico"><Icon name="user" size={18} /></span>
                <div><span className="sp-k">User ID</span><span className="sp-v">{profile.username}</span></div>
              </div>
              <div className="sp-item">
                <span className="sp-ico"><Icon name="lock" size={18} /></span>
                <div><span className="sp-k">Password</span><span className="sp-v sp-dots" aria-label="Hidden">••••••••••</span></div>
              </div>
            </div>
            <Link to="/change-password" className="btn-link sp-wide-btn"><Icon name="lock" size={16} /> Change Password</Link>
          </section>

          <section className="sp-help">
            <Icon name="info" size={20} />
            <div>
              <b>Need to change your shop name or account status?</b>
              <p>Contact the Star Offset Printing administrator.</p>
              <Link to="/contact">Contact Support <Icon name="arrow" size={14} /></Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}