import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { errorText } from "../api";
import AuthShell from "../components/AuthShell";
import Icon from "../components/Icon";
import PasswordField from "../components/PasswordField";

// Target of the invitation link: /setup-password/:uid/:token
const MIN_PASSWORD_LEN = 6; // same rule as the server

export default function SetPassword() {
  const { uid, token } = useParams();
  const [info, setInfo] = useState(undefined); // undefined = checking the link, null = link not valid
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get("/auth/csrf/")
      .then(() => api.get(`/shop/auth/setup-password/${uid}/${token}/`))
      .then((r) => setInfo(r.data.valid ? r.data : null))
      .catch(() => setInfo(null));
  }, [uid, token]);

  const rules = [
    { text: `At least ${MIN_PASSWORD_LEN} characters`, state: !pw ? "" : pw.length >= MIN_PASSWORD_LEN ? "ok" : "bad" },
    { text: "Both passwords match", state: !confirm ? "" : pw === confirm ? "ok" : "bad" },
  ];
  const valid = rules.every((r) => r.state === "ok");

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await api.post("/shop/auth/setup-password/", { uid, token, password: pw, confirm_password: confirm });
      setDone(true);
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };

  if (info === undefined) return <AuthShell title="Checking your link…" />;

  if (info === null) {
    return (
      <AuthShell title="Link not valid" subtitle="This password setup link has expired or was already used.">
        <p className="muted">Please ask the Star Offset admin to send you a new link.</p>
        <Link className="btn-link" to="/login">Go to sign in</Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password saved" subtitle="You can now sign in with your new password.">
        <Link className="btn-link primary" to="/login">Go to sign in</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set your password" userId={info.username} subtitle={`Welcome${info.shop_name ? `, ${info.shop_name}` : ""}. Your User ID is ${info.username}.`}>
      {error && <div className="alert error" role="alert">{error}</div>}
      <form onSubmit={submit} className="auth-form">
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
        <button className="primary big" disabled={!valid || busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </AuthShell>
  );
}