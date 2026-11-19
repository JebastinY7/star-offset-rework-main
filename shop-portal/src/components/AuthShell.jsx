import "../auth.css";

// centred card used by the sign-in, forgot-ID / forgot-password and set-password pages
// (no logo is shown here any more - only the title and subtitle)
export default function AuthShell({ title, subtitle, children }) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <header className="auth-head">
          <h1>{title}</h1>
          {subtitle && <p className="auth-sub">{subtitle}</p>}
        </header>
        {children}
      </section>
      <p className="auth-foot">© {new Date().getFullYear()} Star Offset Printing · Shop Portal</p>
    </main>
  );
}