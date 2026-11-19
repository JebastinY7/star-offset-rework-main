import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import api, { errorText } from "../api";
import AuthShell from "../components/AuthShell";
import { InfoIcon, UserIcon } from "../components/AuthIcons";
import Icon from "../components/Icon";
import PasswordField from "../components/PasswordField";

const MIN_PASSWORD_LEN = 6; // same rule as the server
const RESEND_SECONDS = 30;  // same as the server

// "Forgot password?" in three steps:
//   1. confirm your User ID  -> a 6-digit code is emailed to the email registered for that shop
//   2. enter the code        -> proves the account is yours
//   3. choose a new password
export default function ForgotPassword() {
  const location = useLocation();
  const [step, setStep] = useState(1);
  const [userId, setUserId] = useState(location.state?.userId || "");
  const [otp, setOtp] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [wait, setWait] = useState(0); // seconds until "Resend code" works again

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const run = async (fn) => {
    setError(""); setNotice(""); setBusy(true);
    try { await fn(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  const sendCode = (resend = false) => run(async () => {
    await api.get("/auth/csrf/");
    const r = await api.post("/shop/auth/forgot-password/", { user_id: userId.trim() });
    setWait(RESEND_SECONDS);
    if (resend) setNotice("A new code has been requested.");
    else { setOtp(""); setStep(2); setNotice(r.data.message || ""); }
  });

  const verify = (e) => { e.preventDefault(); run(async () => { await api.post("/shop/auth/verify-otp/", { otp: otp.trim() }); setStep(3); }); };

  const rules = [
    { text: `At least ${MIN_PASSWORD_LEN} characters`, state: !pw ? "" : pw.length >= MIN_PASSWORD_LEN ? "ok" : "bad" },
    { text: "Both passwords match", state: !confirm ? "" : pw === confirm ? "ok" : "bad" },
  ];
  const valid = rules.every((r) => r.state === "ok");

  const reset = (e) => {
    e.preventDefault();
    run(async () => { await api.post("/shop/auth/reset-password/", { password: pw, confirm_password: confirm }); setStep(4); });
  };

  if (step === 4) {
    return (
      <AuthShell title="Password changed" subtitle="You can now sign in with your new password." userId={userId}>
        <Link className="btn-link primary" to="/login">Go to sign in</Link>
      </AuthShell>
    );
  }

  const err = error && <div className="alert error" role="alert">{error}</div>;

  if (step === 3) {
    return (
      <AuthShell title="Choose a new password" subtitle={`Verified. Setting a new password for ${userId.trim()}.`} userId={userId}>
        {err}
        <form onSubmit={reset} className="auth-form">
          <PasswordField id="pw" label="New password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus placeholder="New password" />
          <PasswordField id="pw2" label="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" placeholder="Repeat the password" />
          <ul className="req">
            {rules.map((r) => (
              <li key={r.text} className={r.state}>
                <span className="tick">{r.state === "ok" ? <Icon name="check" size={12} /> : r.state === "bad" ? <Icon name="close" size={12} /> : null}</span>
                {r.text}
              </li>
            ))}
          </ul>
          <button className="primary big" disabled={!valid || busy}>{busy ? "Saving…" : "Save new password"}</button>
        </form>
      </AuthShell>
    );
  }

  if (step === 2) {
    return (
      <AuthShell title="Enter the code" subtitle={`We sent a 6-digit code to the email registered for ${userId.trim()}.`} userId={userId}>
        {err}
        {notice && !error && <p className="auth-note"><InfoIcon /><span>{notice}</span></p>}
        <form onSubmit={verify} className="auth-form auth-gap">
          <div className="field">
            <label htmlFor="otp">Verification code</label>
            <div className="input-wrap">
              <input id="otp" className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} placeholder="••••••"
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} autoFocus required />
            </div>
          </div>
          <button className="primary big" disabled={busy || otp.length !== 6}>{busy ? "Checking…" : "Verify code"}</button>
        </form>
        <p className="auth-back">
          <button type="button" className="auth-link" disabled={busy || wait > 0} onClick={() => sendCode(true)}>
            {wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
          </button>
          <span className="auth-dot">·</span>
          <button type="button" className="auth-link" onClick={() => { setStep(1); setError(""); setNotice(""); }}>Change User ID</button>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot password?" subtitle="Confirm your User ID and we will email a verification code to your registered email." userId={userId}>
      {err}
      <form onSubmit={(e) => { e.preventDefault(); sendCode(false); }} className="auth-form">
        <div className="field">
          <label htmlFor="userid">User ID</label>
          <div className="input-wrap">
            <span className="lead"><UserIcon /></span>
            <input id="userid" value={userId} placeholder="Enter your User ID" onChange={(e) => setUserId(e.target.value)}
              autoComplete="username" autoCapitalize="characters" spellCheck={false} autoFocus required />
          </div>
          <div className="auth-links"><Link className="auth-link" to="/forgot-user-id">Forgot User ID?</Link></div>
        </div>
        <button className="primary big" disabled={busy || !userId.trim()}>{busy ? "Sending…" : "Send verification code"}</button>
      </form>
      <p className="auth-back"><Link className="auth-link" to="/login">← Back to sign in</Link></p>
    </AuthShell>
  );
}
