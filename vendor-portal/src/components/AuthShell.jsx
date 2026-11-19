// sign-in layout: light blue background with a centred white card (no logo / shop name on the card)
export default function AuthShell({ title, subtitle, children }) {
  return (
    <main className="login">
      <div className="login-card">
        <div className="login-head">
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>

        {children}
      </div>
      <p className="login-foot muted">© {new Date().getFullYear()} Star Offset Printing · Vendor Portal</p>
    </main>
  );
}
