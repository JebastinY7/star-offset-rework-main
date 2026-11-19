import { useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import "../profile.css";
import "../password.css";

const MIN_LEN = 6;
const LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"];

// 0 = too short .. 4 = strong (a hint only - the server enforces the real rule)
function strength(pw) {
  if (pw.length < MIN_LEN) return 0;
  let score = 1;
  if (pw.length >= 8) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score += 1;
  else if (pw.length >= 12) score += 1;
  return Math.min(score, 4);
}

function PasswordField({ id, label, value, onChange, autoComplete, hint }) {
  const [show, setShow] = useState(false);
  return (
    <div className="sp-field">
      <label htmlFor={id}>{label}</label>
      <div className="sp-input">
        <Icon name="lock" size={17} />
        <input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} maxLength={128} />
        <button type="button" className="pw-eye" onClick={() => setShow((s) => !s)} aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
          <Icon name={show ? "eyeoff" : "eye"} size={18} />
        </button>
      </div>
      {hint}
    </div>
  );
}

export default function ChangePassword() {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const set = (key) => (value) => { setForm((f) => ({ ...f, [key]: value })); setDone(false); };

  const level = strength(form.next);
  const rules = [
    { ok: form.next.length >= MIN_LEN, text: `At least ${MIN_LEN} characters` },
    { ok: !!form.next && form.next !== form.current, text: "Different from your current password" },
    { ok: !!form.confirm && form.next === form.confirm, text: "Both new passwords match" },
  ];
  const valid = !!form.current && rules.every((r) => r.ok);

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || saving) return;
    setError("");
    setSaving(true);
    try {
      await api.post("/shop/password/change/", { current_password: form.current, new_password: form.next, confirm_password: form.confirm });
      setForm({ current: "", next: "", confirm: "" });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sp cp">
      <div>
        <Link to="/profile" className="back-link"><Icon name="arrowleft" size={16} /> Back to Shop Profile</Link>
        <h1>Change Password</h1>
        <p className="muted">Choose a new password for signing in to your Shop Portal.</p>
      </div>

      {done && <p className="alert ok"><Icon name="check" size={16} /> Your password was changed. Use the new password the next time you sign in.</p>}

      <div className="sp-grid">
        <form className="card sp-card" onSubmit={submit} noValidate>
          <div className="sp-head"><div><h2>Update Password</h2><p className="muted small">Enter your current password, then your new one twice.</p></div></div>
          <div className="cp-fields">
            <PasswordField id="cp-current" label="Current Password" value={form.current} onChange={set("current")} autoComplete="current-password" />
            <PasswordField id="cp-new" label="New Password" value={form.next} onChange={set("next")} autoComplete="new-password"
              hint={form.next && (
                <div className={`cp-meter lvl-${level}`} aria-live="polite">
                  <span className="cp-bars"><i /><i /><i /><i /></span>
                  <span className="cp-level">{LABELS[level]}</span>
                </div>
              )} />
            <PasswordField id="cp-confirm" label="Confirm New Password" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />
          </div>
          {error && <p className="alert error">{error}</p>}
          <div className="sp-actions">
            <Link to="/profile" className="btn-link">Cancel</Link>
            <button type="submit" className="primary" disabled={!valid || saving}>{saving ? "Updating…" : "Update Password"}</button>
          </div>
        </form>

        <aside className="card sp-card cp-tips">
          <h2>Your new password</h2>
          <ul className="cp-rules">
            {rules.map((r) => (
              <li key={r.text} className={r.ok ? "ok" : ""}><span className="cp-tick"><Icon name="check" size={13} /></span>{r.text}</li>
            ))}
          </ul>
          <h3>Tips for a strong password</h3>
          <ul className="cp-tipslist">
            <li>Use 8 or more characters</li>
            <li>Mix capital and small letters, numbers and symbols</li>
            <li>Do not reuse a password from another website</li>
          </ul>
          <p className="muted small">When you change it, any other device signed in to your shop account will be signed out.</p>
        </aside>
      </div>
    </div>
  );
}