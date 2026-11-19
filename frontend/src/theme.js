// Light / dark theme store. The choice is saved in localStorage ("theme") and applied as
// <html data-theme="dark|light">; dark.css does the rest. index.html sets the attribute before
// the first paint so there is no white flash on reload.
import { useSyncExternalStore } from "react";

const KEY = "theme";
const listeners = new Set();

const read = () => {
  try { const v = localStorage.getItem(KEY); if (v === "dark" || v === "light") return v; } catch { /* storage blocked */ }
  return "light"; // default; change to the OS setting with: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
};

let current = read();

function apply(t) {
  document.documentElement.setAttribute("data-theme", t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "dark" ? "#1a202b" : "#ffffff");
}

const emit = () => listeners.forEach((l) => l());

export function initTheme() { apply(current); }

export function setTheme(t) {
  current = t === "dark" ? "dark" : "light";
  try { localStorage.setItem(KEY, current); } catch { /* storage blocked - theme lasts until reload */ }
  apply(current);
  emit();
}

export const toggleTheme = () => setTheme(current === "dark" ? "light" : "dark");

// keep several open tabs in sync
window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  current = read();
  apply(current);
  emit();
});

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => current
  );
  return { theme, setTheme, toggle: toggleTheme };
}
