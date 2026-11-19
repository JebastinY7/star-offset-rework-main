import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";
import PasswordField from "../components/PasswordField";
import "../profile.css";

const MIN = 6; // same minimum as the server

export default function Profile() {
  const { vendor } = useAuth();
  const { data } = useOutletContext();
  const s = data?.stats;
  const person = vendor.owner_name || vendor.name;
  const initials = person.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const tags = (vendor.specialties || "").split(",").map((t) => t.trim()).filter(Boolean);

  const DETAILS = [
    ["Company Name", vendor.name], ["Contact Person", vendor.owner_name || "—"], ["Mobile Number", vendor.phone || "—"],
    ["Email", vendor.email || "—"], ["User ID", vendor.username], ["Address", vendor.address || "—"],
  ];
  const GLANCE = [
    ["Total Jobs", s?.total], ["In Progress", s?.active], ["Ready for Pickup", s?.ready], ["Completed", s?.completed],
  ];

  const [f, setF] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setDone(false); };

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setDone(false);
    if (f.new_password.length < MIN) return setError(`New password must be at least ${MIN} characters.`);
    if (f.new_password === f.current_password) return setError("Your new password must be different from your current password.");
    if (f.new_password !== f.confirm_password) return setError("The new passwords do not match.");
    setBusy(true);
    try {
      await api.post("/vendor/password/change/", f);
      setF({ current_password: "", new_password: "", confirm_password: "" });
      setDone(true);
    } catch (err) { setError(errorText(err)); }
    setBusy(false);
  };

  return (
    <div className="aw">
      <div className="aw-head">
        <h1>Profile</h1>
        <p>Your account details and password.</p>
      </div>

      <div className="pf-grid">
        <div className="pf-col">
          <section className="vd-card pf-hero">
            <span className="pf-avatar">{initials}</span>
            <div><h2>{vendor.name}</h2><p>{person} · @{vendor.username}</p></div>
          </section>

          <section className="vd-card pf-card">
            <h2>Account Details</h2>
            <dl className="pf-list">
              {DETAILS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              {tags.length > 0 && <div><dt>Specialties</dt><dd className="pf-tags">{tags.map((t) => <span key={t}>{t}</span>)}</dd></div>}
            </dl>
            <p className="pf-note"><Icon name="info" size={16} /> To change these details, please contact Star Offset Printing.</p>
          </section>
        </div>

        <div className="pf-col">
          <section className="vd-card pf-card">
            <h2>Your Work at a Glance</h2>
            <div className="pf-glance">
              {GLANCE.map(([k, v]) => <div key={k}><b>{v ?? "—"}</b><small>{k}</small></div>)}
            </div>
          </section>

          <section className="vd-card pf-card">
            <h2>Change Password</h2>
            {error && <div className="alert error" role="alert"><span>{error}</span></div>}
            {done && <div className="alert ok" role="status">Your password has been changed.</div>}
            <form className="pf-form" onSubmit={submit}>
              <PasswordField id="pf-cur" label="Current Password" value={f.current_password} onChange={set("current_password")} autoComplete="current-password" placeholder="Current password" />
              <PasswordField id="pf-new" label="New Password" value={f.new_password} onChange={set("new_password")} autoComplete="new-password" placeholder={`At least ${MIN} characters`} />
              <PasswordField id="pf-con" label="Confirm New Password" value={f.confirm_password} onChange={set("confirm_password")} autoComplete="new-password" placeholder="Type the new password again" />
              <div className="pf-actions"><button type="submit" className="aw-btn accent" disabled={busy}>{busy ? "Saving…" : "Change Password"}</button></div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
