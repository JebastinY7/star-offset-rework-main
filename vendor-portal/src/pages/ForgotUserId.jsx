import { useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import AuthShell from "../components/AuthShell";

// Forgot User ID: the vendor enters the e-mail registered with Star Offset and the User ID is e-mailed to it.
// The server answers the same way whether or not the e-mail exists, so nobody can probe for accounts.
export default function ForgotUserId() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try { await api.post("/vendor/auth/forgot-user-id/", { email: email.trim() }); setSent(true); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };

  return (
    <AuthShell title="Forgot User ID" subtitle="Enter the email address registered with Star Offset and we will send your User ID to it.">
      {error && <div className="alert error" role="alert">{error}</div>}
      {sent ? (
        <>
          <div className="alert success" role="status">If this email belongs to a vendor account, its User ID has been sent to it. Please check your inbox.</div>
          <p className="auth-back" style={{ marginTop: 16 }}><Link to="/login">Back to sign in</Link></p>
        </>
      ) : (
        <form onSubmit={submit} className="auth-form">
          <div className="field">
            <label htmlFor="email">Registered email</label>
            <input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
          </div>
          <button className="primary big" disabled={busy || !email.trim()}>{busy ? "Sending…" : "Send my User ID"}</button>
          <p className="auth-back"><Link to="/login">Back to sign in</Link></p>
        </form>
      )}
    </AuthShell>
  );
}
