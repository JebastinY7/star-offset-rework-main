import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { errorText } from "../api";
import { useAuth } from "../AuthContext";
import AuthShell from "../components/AuthShell";
import PasswordField from "../components/PasswordField";

export default function Login() {
  const { vendor, login } = useAuth();
  const location = useLocation();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const notice = location.state?.notice; // e.g. "Password changed" after a reset

  if (vendor) return <Navigate to={location.state?.from || "/"} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try { await login(userId.trim(), password); } // the API field is still called "username": it holds the User ID
    catch (err) { setError(errorText(err)); setBusy(false); }
  };

  return (
    <AuthShell title="Vendor sign in" subtitle="Sign in to view and manage the jobs assigned to you.">
      {notice && !error && <div className="alert success" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}
      <form onSubmit={submit} className="auth-form">
        <div className="field">
          <label htmlFor="user-id">User ID</label>
          <input id="user-id" placeholder="Enter your User ID" value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="username" autoCapitalize="characters" spellCheck={false} autoFocus required />
        </div>
        <Link to="/forgot-user-id" className="auth-link">Forgot User ID?</Link>

        <PasswordField id="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <Link to="/forgot-password" className="auth-link">Forgot password?</Link>

        <button className="primary big" disabled={busy || !userId.trim() || !password}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </AuthShell>
  );
}
