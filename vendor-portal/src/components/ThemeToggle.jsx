import { useCallback, useEffect, useState } from "react";

const KEY = "vp-theme";
const read = () => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

// light / dark switch for the top bar. The theme is stored in localStorage and applied as
// <html data-theme="light|dark"> (index.html sets it before first paint, dark.css styles it).
export default function ThemeToggle() {
  const [theme, setTheme] = useState(read);
  const dark = theme === "dark";

  const apply = useCallback((next) => {
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY, next); } catch { /* private mode: still works for this visit */ }
    setTheme(next);
  }, []);

  // keep several open tabs in sync
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== KEY) return;
      const next = e.newValue === "dark" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      setTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <button type="button" role="switch" aria-checked={dark} className={`theme-toggle${dark ? " on" : ""}`}
      onClick={() => apply(dark ? "light" : "dark")} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}>
      <svg className="tt-sun" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg className="tt-moon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
      <span className="tt-knob" />
    </button>
  );
}
