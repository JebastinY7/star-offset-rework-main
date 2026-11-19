import { useTheme } from "../theme";
import "./ThemeToggle.css";

// Sky-scene switch: day = blue sky + cloud + sun, night = starry sky + moon. The knob slides and the sun
// spins into the moon.
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={label}
      title={label}
      className={`theme-toggle${dark ? " is-dark" : ""}`}
      onClick={toggle}
    >
      <span className="tt-track" aria-hidden="true">
        <span className="tt-stars"><i /><i /><i /><i /><i /></span>
        <span className="tt-cloud"><b /></span>
      </span>
      <span className="tt-knob" aria-hidden="true">
        <svg className="tt-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
          <path d="M12 2.6v2.4M12 19v2.4M2.6 12H5M19 12h2.4M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7" />
        </svg>
        <svg className="tt-moon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.3 14.6A8.4 8.4 0 0 1 9.4 3.7a.6.6 0 0 0-.8-.7A9.4 9.4 0 1 0 21 15.4a.6.6 0 0 0-.7-.8z" />
        </svg>
      </span>
    </button>
  );
}
