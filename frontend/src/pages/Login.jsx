import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import "./login.css";

// One sign-in for everybody: admin enters email or username, staff / manager enter their User ID (S0001 / M0001)
// and the server works out the role.
// Recovery (admin, manager and staff alike) goes through the email saved on the account:
//   Forgot user id?  -> email -> the User ID is emailed
//   Forgot password? -> email / User ID -> a reset link is emailed; the link opens /login?uid=..&token=..
//                       which shows the "choose a new password" step.
// Views: login | forgotId | forgotPw | sent | checking | reset | badlink.   One centred card, no page scroll.
// Icons are small inline SVGs (the app-wide Icon set is emoji based).

const MIN_PASSWORD_LEN = 6; // same rule as the server
const YEAR = new Date().getFullYear();

const GLYPHS = {
  eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeoff: <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><path d="M1 1l22 22" /></>,
  arrowRight: <path d="M5 12h14M12 5l7 7-7 7" />,
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  check: <path d="M20 6L9 17l-5-5" />,
  close: <path d="M18 6L6 18M6 6l12 12" />,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
  alert: <><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></>,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7l-10 7L2 7" /></>,
};

function Icon({ name, size = 18 }) {
  return (
    <svg className="lg-ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  );
}

function Alert({ type, children }) {
  return (
    <div className={`lg-alert ${type}`} role={type === "error" ? "alert" : "status"}>
      <Icon name={type === "success" ? "check" : type === "error" ? "alert" : "info"} size={16} />
      <div>{children}</div>
    </div>
  );
}

// label + input box with an optional icon on the left (children = the <input>, and the eye button for passwords)
function Field({ id, label, icon, children }) {
  return (
    <div className="lg-field">
      <label htmlFor={id}>{label}</label>
      <div className={`lg-input${icon ? " has-icon" : ""}`}>
        {icon && <span className="lg-lead"><Icon name={icon} size={18} /></span>}
        {children}
      </div>
    </div>
  );
}

// small row under a field: Caps Lock hint on the left, an optional link on the right
const Under = ({ caps, children }) => (
  <div className="lg-under">
    {caps && <span className="lg-caps">Caps Lock is on</span>}
    {children}
  </div>
);

// password box with the lock icon, the show/hide eye and a Caps Lock hint
function PasswordField({ id, label, value, onChange, autoComplete, autoFocus, placeholder = "Your password", children }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const watchCaps = (e) => setCaps(Boolean(e.getModifierState && e.getModifierState("CapsLock")));
  return (
    <div>
      <Field id={id} label={label} icon="lock">
        <input
          id={id} type={show ? "text" : "password"} value={value} placeholder={placeholder}
          onChange={onChange} onKeyDown={watchCaps} onKeyUp={watchCaps} onBlur={() => setCaps(false)}
          autoComplete={autoComplete} autoFocus={autoFocus}
        />
        <button type="button" className="lg-eye" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
          <Icon name={show ? "eyeoff" : "eye"} size={18} />
        </button>
      </Field>
      <Under caps={caps}>{children}</Under>
    </div>
  );
}

const Spinner = () => <span className="lg-spin" aria-hidden="true" />;

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// logo on the left, shop name beside it
const Brand = () => (
  <div className="lg-brand-name">
    <span className="lg-logo-tile"><img src="/images/logo.png" alt="" /></span>
    <span><b>Star Offset</b><small>Printing</small></span>
  </div>
);

export default function Login() {
  const { login } = useAuth();
  const [params, setParams] = useSearchParams();
  const linkUid = params.get("uid") || "";
  const linkToken = params.get("token") || "";

  const [view, setView] = useState(linkUid && linkToken ? "checking" : "login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");        // forgot user id
  const [fpIdent, setFpIdent] = useState("");    // forgot password: email or User ID
  const [sentText, setSentText] = useState("");
  const [resetUser, setResetUser] = useState(""); // User ID the reset link belongs to
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockLeft, setLockLeft] = useState(0); // sign-in lockout countdown (seconds)

  useEffect(() => { setPassword(""); }, []); // the password box always starts empty

  useEffect(() => {
    if (lockLeft <= 0) return;
    const t = setTimeout(() => setLockLeft(lockLeft - 1), 1000);
    return () => clearTimeout(t);
  }, [lockLeft]);

  // arrived from the emailed link: is it still valid?
  useEffect(() => {
    if (!linkUid || !linkToken) return;
    api.get(`/auth/reset-password/${encodeURIComponent(linkUid)}/${encodeURIComponent(linkToken)}/`)
      .then((r) => {
        if (r.data.valid) { setResetUser(r.data.username); setView("reset"); } else setView("badlink");
      })
      .catch(() => setView("badlink"));
  }, [linkUid, linkToken]);

  const go = (v) => {
    setError(""); setNotice(""); setView(v);
    if (linkUid || linkToken) setParams({}, { replace: true }); // drop ?uid=&token= from the address bar
  };

  // run one API step with the shared busy / error handling
  const run = async (fn) => {
    setError(""); setBusy(true);
    try { await fn(); } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };

  const submitLogin = (e) => {
    e.preventDefault();
    if (lockLeft > 0) return;
    if (!identifier.trim() || !password) { setError("Please enter both fields"); return; }
    setNotice("");
    setError(""); setBusy(true);
    login(identifier.trim(), password)
      .catch((err) => {
        setPassword("");
        if (err?.response?.status === 429) {
          setLockLeft(Number(err.response.data?.retry_after) || 600);
          setError("");
        } else {
          setError(errorText(err));
        }
      })
      .finally(() => setBusy(false));
  };

  const sendUserId = () => run(async () => {
    if (!email.trim()) throw new Error("Please enter your registered email");
    const r = await api.post("/auth/forgot-user-id/", { email: email.trim() });
    setSentText(r.data.message); setView("sent");
  });

  const sendLink = () => run(async () => {
    if (!fpIdent.trim()) throw new Error("Please enter your email or User ID");
    const r = await api.post("/auth/forgot-password/", { identifier: fpIdent.trim() });
    setSentText(r.data.message); setView("sent");
  });

  const rules = [
    { text: `At least ${MIN_PASSWORD_LEN} characters`, state: !newPw ? "" : newPw.length >= MIN_PASSWORD_LEN ? "ok" : "bad" },
    { text: "Both passwords match", state: !confirmPw ? "" : newPw === confirmPw ? "ok" : "bad" },
  ];
  const resetReady = rules.every((r) => r.state === "ok");

  const resetPassword = () => run(async () => {
    await api.post("/auth/reset-password/", { uid: linkUid, token: linkToken, password: newPw, confirm_password: confirmPw });
    setIdentifier(resetUser); setPassword("");
    setNewPw(""); setConfirmPw("");
    setParams({}, { replace: true });
    setNotice("Password updated. Sign in with your new password.");
    setView("login");
  });

  const backToLogin = <button type="button" className="lg-link back" onClick={() => go("login")}><Icon name="back" size={16} />Back to sign in</button>;

  return (
    <div className="lg-shell">
      <main className="lg-main">
        <div className="lg-card">
          <Brand />

          {view === "login" && (
            <div className="lg-view" key="login">
              <div className="lg-head">
                <h1>Sign in</h1>
                <p>Admins use their email or username &amp; staff / managers use their User ID.</p>
              </div>
              {notice && <Alert type="success">{notice}</Alert>}
              <form className="lg-form" onSubmit={submitLogin} noValidate>
                {lockLeft > 0 && (
                  <Alert type="error">
                    Too many failed attempts. You can try again in <strong className="lg-tnum">{mmss(lockLeft)}</strong>.
                  </Alert>
                )}
                {error && <Alert type="error">{error}</Alert>}
                <div>
                  <Field id="lg-id" label="Email, Username or User ID" icon="user">
                    <input
                      id="lg-id" type="text"
                      placeholder="Email, username or User ID"
                      value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                      autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus
                    />
                  </Field>
                  <Under>
                    <button type="button" className="lg-link" onClick={() => go("forgotId")}>Forgot user id?</button>
                  </Under>
                </div>
                <PasswordField id="lg-pw" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password">
                  <button type="button" className="lg-link" onClick={() => go("forgotPw")}>Forgot password?</button>
                </PasswordField>
                <button className="lg-btn" disabled={busy || lockLeft > 0}>
                  {busy ? <><Spinner />Signing in…</> : <>Sign in<Icon name="arrowRight" size={18} /></>}
                </button>
              </form>
            </div>
          )}

          {view === "forgotId" && (
            <div className="lg-view" key="forgotId">
              <div className="lg-head">
                <h1>Forgot user id?</h1>
                <p>Enter the email saved on your account and we'll email your User ID to it.</p>
              </div>
              <form className="lg-form" onSubmit={(e) => { e.preventDefault(); sendUserId(); }} noValidate>
                {error && <Alert type="error">{error}</Alert>}
                <Field id="lg-email" label="Registered email" icon="mail">
                  <input id="lg-email" type="email" placeholder="name@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
                </Field>
                <button className="lg-btn" disabled={busy}>{busy ? <><Spinner />Sending…</> : <>Send User ID<Icon name="arrowRight" size={18} /></>}</button>
              </form>
              <div className="lg-aside">{backToLogin}</div>
            </div>
          )}

          {view === "forgotPw" && (
            <div className="lg-view" key="forgotPw">
              <div className="lg-head">
                <h1>Forgot password?</h1>
                <p>Enter your email or User ID and we'll email you a link to set a new password.</p>
              </div>
              <form className="lg-form" onSubmit={(e) => { e.preventDefault(); sendLink(); }} noValidate>
                {error && <Alert type="error">{error}</Alert>}
                <Field id="lg-fp" label="Email or User ID" icon="user">
                  <input id="lg-fp" type="text" placeholder="name@gmail.com or S0001" value={fpIdent} onChange={(e) => setFpIdent(e.target.value)}
                    autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus />
                </Field>
                <button className="lg-btn" disabled={busy}>{busy ? <><Spinner />Sending…</> : <>Send reset link<Icon name="arrowRight" size={18} /></>}</button>
              </form>
              <div className="lg-aside">{backToLogin}</div>
            </div>
          )}

          {view === "sent" && (
            <div className="lg-view lg-sent" key="sent">
              <span className="lg-sent-ico"><Icon name="mail" size={26} /></span>
              <div className="lg-head">
                <h1>Check your email</h1>
                <p>{sentText}</p>
              </div>
              <p className="lg-fine">Nothing arrived? Look in spam, or ask the admin to help under Settings → Staff &amp; Roles.</p>
              <div className="lg-aside">{backToLogin}</div>
            </div>
          )}

          {view === "checking" && (
            <div className="lg-view lg-sent" key="checking">
              <div className="lg-head"><h1>Checking your link…</h1></div>
              <Spinner />
            </div>
          )}

          {view === "badlink" && (
            <div className="lg-view" key="badlink">
              <div className="lg-head"><h1>Link not valid</h1></div>
              <Alert type="error">This link has expired or was already used. Please request a new one.</Alert>
              <button type="button" className="lg-btn" onClick={() => go("forgotPw")}>Request a new link<Icon name="arrowRight" size={18} /></button>
              <div className="lg-aside">{backToLogin}</div>
            </div>
          )}

          {view === "reset" && (
            <div className="lg-view" key="reset">
              <div className="lg-head">
                <h1>Choose a new password</h1>
                <p>For User ID <strong>{resetUser}</strong></p>
              </div>
              <form className="lg-form" onSubmit={(e) => { e.preventDefault(); if (resetReady) resetPassword(); }}>
                {error && <Alert type="error">{error}</Alert>}
                <PasswordField id="lg-new" label="New password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" autoFocus placeholder="New password" />
                <PasswordField id="lg-confirm" label="Confirm new password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" placeholder="Type it again" />
                <ul className="lg-req" aria-label="Password requirements">
                  {rules.map((r) => (
                    <li key={r.text} className={r.state}>
                      <span className="tick">{r.state === "ok" ? <Icon name="check" size={12} /> : r.state === "bad" ? <Icon name="close" size={12} /> : null}</span>
                      {r.text}
                    </li>
                  ))}
                </ul>
                <button className="lg-btn" disabled={busy || !resetReady}>{busy ? <><Spinner />Saving…</> : <>Save password<Icon name="arrowRight" size={18} /></>}</button>
              </form>
            </div>
          )}
        </div>
        <p className="lg-foot">© {YEAR} Star Offset Printing</p>
      </main>
    </div>
  );
}