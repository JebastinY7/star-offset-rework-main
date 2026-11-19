import { useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import AuthShell from "../components/AuthShell";
import { InfoIcon } from "../components/AuthIcons";

// "Forgot User ID?": the shop types the email registered with Star Offset and the User ID is emailed to it.
export default function ForgotUserId() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await api.get("/auth/csrf/");
      await api.post("/shop/auth/forgot-user-id/", { email: email.trim() });
      setSent(true);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle="We have processed your request.">
        <p className="auth-note"><InfoIcon /><span>If <b>{email.trim()}</b> is registered with a shop account, its User ID has been emailed to it. It can take a minute to arrive.</span></p>
        <Link className="btn-link primary auth-gap" to="/login">Back to sign in</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot User ID?" subtitle="Enter the email address registered for your shop. We will email your User ID to it.">
      {error && <div className="alert error" role="alert">{error}</div>}
      <form onSubmit={submit} className="auth-form">
        <div className="field">
          <label htmlFor="email">Registered email</label>
          <div className="input-wrap">
            <span className="lead"><MailIcon /></span>
            <input id="email" type="email" value={email} placeholder="you@yourshop.com" onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
          </div>
        </div>
        <button className="primary big" disabled={busy || !email.trim()}>{busy ? "Sending…" : "Email my User ID"}</button>
      </form>
      <p className="auth-back"><Link className="auth-link" to="/login">← Back to sign in</Link></p>
    </AuthShell>
  );
}

const MailIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
  </svg>
);
