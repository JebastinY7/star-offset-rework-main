import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { errorText } from "../api";
import { useAuth } from "../AuthContext";
import AuthShell from "../components/AuthShell";
import PasswordField from "../components/PasswordField";
import { UserIcon } from "../components/AuthIcons";

export default function Login() {
  const { shop, login } = useAuth();
  const location = useLocation();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (shop) return <Navigate to={location.state?.from || "/"} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try { await login(userId.trim(), password); }   // the server still calls this field "username"
    catch (err) { setError(errorText(err)); setBusy(false); }
  };

  return (
    <AuthShell title="Shop sign in" subtitle="Sign in to manage your orders." userId={userId}>
      {error && <div className="alert error" role="alert">{error}</div>}
      <form onSubmit={submit} className="auth-form">
        <div className="field">
          <label htmlFor="userid">User ID</label>
          <div className="input-wrap">
            <span className="lead"><UserIcon /></span>
            <input id="userid" value={userId} placeholder="Enter your User ID" onChange={(e) => setUserId(e.target.value)}
              autoComplete="username" autoCapitalize="characters" spellCheck={false} autoFocus required />
          </div>
          <div className="auth-links"><Link className="auth-link" to="/forgot-user-id">Forgot User ID?</Link></div>
        </div>
        <div className="field">
          <PasswordField id="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <div className="auth-links"><Link className="auth-link" to="/forgot-password" state={{ userId: userId.trim() }}>Forgot password?</Link></div>
        </div>
        <button className="primary big" disabled={busy || !userId.trim() || !password}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </AuthShell>
  );
}
