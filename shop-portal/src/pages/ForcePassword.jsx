import { useState } from "react";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import AuthShell from "../components/AuthShell";
import Icon from "../components/Icon";
import PasswordField from "../components/PasswordField";

const MIN_PASSWORD_LEN = 6; // same rule as the server

// Shown instead of the portal while the shop still uses the temporary password the admin gave it.
export default function ForcePassword() {
  const { shop, refresh, logout } = useAuth();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rules = [
    { text: `At least ${MIN_PASSWORD_LEN} characters`, state: !pw ? "" : pw.length >= MIN_PASSWORD_LEN ? "ok" : "bad" },
    { text: "Both passwords match", state: !confirm ? "" : pw === confirm ? "ok" : "bad" },
  ];
  const valid = rules.every((r) => r.state === "ok");

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    setError(""); setBusy(true);
    try {
      await api.post("/shop/password/change/", { new_password: pw, confirm_password: confirm });
      await refresh(); // must_change_password is now false -> the portal opens
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };

  return (
    <AuthShell title="Choose your new password" subtitle={`Welcome, ${shop.name}. You signed in with a temporary password - please set your own to continue.`}>
      {error && <div className="alert error" role="alert">{error}</div>}
      <form onSubmit={submit} className="auth-form">
        <PasswordField id="fp-new" label="New password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus placeholder="New password" />
        <PasswordField id="fp-confirm" label="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" placeholder="Repeat the password" />
        <ul className="req">
          {rules.map((r) => (
            <li key={r.text} className={r.state}>
              <span className="tick">{r.state === "ok" ? <Icon name="check" size={12} /> : r.state === "bad" ? <Icon name="close" size={12} /> : null}</span>
              {r.text}
            </li>
          ))}
        </ul>
        <button className="primary big" disabled={!valid || busy}>{busy ? "Saving…" : "Save password & continue"}</button>
      </form>
      <p className="muted small">Not you? <button type="button" className="fp-link" onClick={logout}>Sign out</button></p>
    </AuthShell>
  );
}
