import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { errorText } from "../api";
import AuthShell from "../components/AuthShell";
import PasswordField from "../components/PasswordField";

const MIN_PASSWORD_LEN = 6; // same rule as the server
const RESEND_SECONDS = 30;  // keep in sync with RESEND_SECONDS in vendor_recovery_api.py

// Forgot password, in three steps - the vendor changes it on their own:
//   1. confirm the User ID      -> a 6-digit code is e-mailed to the vendor's registered address
//   2. enter the code           -> proves the vendor owns that account (a User ID alone is easy to guess)
//   3. choose a new password    -> back to sign in
export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [userId, setUserId] = useState("");
  const [otp, setOtp] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [wait, setWait] = useState(0); // seconds until "Resend code" works again

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const call = async (fn) => {
    setError(""); setInfo(""); setBusy(true);
    try { await fn(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  const sendCode = (e) => {
    e?.preventDefault();
    return call(async () => {
      const r = await api.post("/vendor/auth/forgot-password/", { user_id: userId.trim() });
      setInfo(r.data.message); setStep(2); setOtp(""); setWait(RESEND_SECONDS);
    });
  };

  const verify = (e) => {
    e.preventDefault();
    return call(async () => { await api.post("/vendor/auth/verify-otp/", { otp: otp.trim() }); setStep(3); });
  };

  const reset = (e) => {
    e.preventDefault();
    if (pw.length < MIN_PASSWORD_LEN) { setError(`Password must be at least ${MIN_PASSWORD_LEN} characters.`); return; }
    if (pw !== confirm) { setError("Passwords do not match."); return; }
    return call(async () => {
      await api.post("/vendor/auth/reset-password/", { password: pw, confirm_password: confirm });
      navigate("/login", { replace: true, state: { notice: "Your password has been changed. Sign in with your new password." } });
    });
  };

  const subtitle = {
    1: "Enter your User ID. We will send a verification code to the email registered with it.",
    2: "Enter the 6-digit code we sent to your registered email.",
    3: "Choose a new password for your account.",
  }[step];

  return (
    <AuthShell title="Forgot password" subtitle={subtitle}>
      {info && !error && <div className="alert info" role="status">{info}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}

      {step === 1 && (
        <form onSubmit={sendCode} className="auth-form">
          <div className="field">
            <label htmlFor="fp-user-id">User ID</label>
            <input id="fp-user-id" placeholder="e.g. 2026V0001" value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="username" autoCapitalize="characters" spellCheck={false} autoFocus required />
          </div>
          <button className="primary big" disabled={busy || !userId.trim()}>{busy ? "Sending…" : "Send verification code"}</button>
          <p className="auth-back"><Link to="/login">Back to sign in</Link></p>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={verify} className="auth-form">
          <div className="field">
            <label htmlFor="otp">Verification code</label>
            <input id="otp" className="otp" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="······" value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} autoComplete="one-time-code" autoFocus required />
          </div>
          <button className="primary big" disabled={busy || otp.length !== 6}>{busy ? "Checking…" : "Verify code"}</button>
          <div className="auth-row">
            <button type="button" className="auth-link" style={{ marginTop: 0 }} disabled={busy || wait > 0} onClick={sendCode}>
              {wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
            </button>
            <button type="button" className="auth-link" style={{ marginTop: 0 }} onClick={() => { setStep(1); setError(""); setInfo(""); }}>Change User ID</button>
          </div>
        </form>
      )}

      {step === 3 && (
        <form onSubmit={reset} className="auth-form">
          <PasswordField id="new-password" label="New password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="At least 6 characters" autoFocus />
          <PasswordField id="confirm-password" label="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" placeholder="Re-enter the new password" />
          <button className="primary big" disabled={busy || !pw || !confirm}>{busy ? "Saving…" : "Change password"}</button>
        </form>
      )}
    </AuthShell>
  );
}
