import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useRealtime } from "../realtime";
import { useWallet } from "../WalletContext";
import LiveToasts from "./LiveToasts";
import PushPrompt from "./PushPrompt";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

const COLLAPSE_KEY = "shop-sidebar-collapsed";

// sidebar + topbar + page + footer
export default function Layout() {
  const { shop, logout } = useAuth();
  const nav = useNavigate();
  const { refresh: refreshWallet } = useWallet();
  const [mobileOpen, setMobileOpen] = useState(false); // phone drawer
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  }); // desktop icon-rail

  // phone drawer: lock page scroll while open, close on Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const esc = (e) => { if (e.key === "Escape") setMobileOpen(false); };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", esc); };
  }, [mobileOpen]);

  const toggleCollapsed = () => {
    const v = !collapsed;
    setCollapsed(v);
    try { localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0"); } catch { /* storage blocked - ignore */ }
  };

  // wallet money arrived / left: re-read the balance at once
  useRealtime((m) => { if (m.type === "wallet" || m.type === "resync") refreshWallet(); });

  const doLogout = async () => { await logout(); nav("/login"); };

  return (
    <div className={`shell${collapsed ? " collapsed" : ""}`}>
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      {mobileOpen && <div className="overlay" onClick={() => setMobileOpen(false)} />}
      <LiveToasts />
      <PushPrompt />

      <div className="main-col">
        <Topbar shop={shop} onMenu={() => setMobileOpen(true)} onToggleCollapse={toggleCollapsed} onLogout={doLogout} />
        <main className="content"><Outlet /></main>
        <footer className="footer">© {new Date().getFullYear()} Star Offset Printing · Shop Portal</footer>
      </div>
    </div>
  );
}