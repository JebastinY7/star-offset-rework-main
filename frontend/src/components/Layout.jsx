import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import { useAuth } from "../AuthContext";
import { makePoller, useRealtime } from "../realtime";
import LiveToasts from "./LiveToasts";
import PushPrompt from "./PushPrompt";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

const COLLAPSE_KEY = "sidebar-collapsed";

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [unread, setUnread] = useState(0); // WhatsApp conversations with new customer messages
  const [mobileOpen, setMobileOpen] = useState(false); // phone drawer
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  }); // desktop icon-rail

  const loadUnread = useCallback(() => api.get("/messages/unread/").then((r) => setUnread(r.data.count)).catch(() => {}), []);

  // refresh the badge right after every page change (opening a chat marks it read on the server a moment later);
  // new customer messages arrive over the WebSocket, the timer is only a fallback while that is down
  useEffect(() => {
    loadUnread();
    const soon = setTimeout(loadUnread, 1200);
    const stop = makePoller(loadUnread);
    return () => { clearTimeout(soon); stop(); };
  }, [pathname, loadUnread]);
  useRealtime((m) => { if (m.type === "messages" || m.type === "resync") loadUnread(); });

  // phone drawer: lock page scroll while open, close on Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const esc = (e) => { if (e.key === "Escape") setMobileOpen(false); };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", esc); };
  }, [mobileOpen]);

  const setCollapsedSaved = (v) => {
    setCollapsed(v);
    try { localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0"); } catch { /* storage blocked - ignore */ }
  };

  const doLogout = async () => { await logout(); nav("/login"); };

  return (
    <div className={`shell${collapsed ? " collapsed" : ""}`}>
      <Sidebar
        isAdmin={!!user.is_superuser}
        unread={unread}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onExpand={() => setCollapsedSaved(false)}
        onClose={() => setMobileOpen(false)}
        onLogout={doLogout}
      />
      {mobileOpen && <div className="overlay no-print" onClick={() => setMobileOpen(false)} />}
      <LiveToasts />
      <PushPrompt />

      <div className="main-col">
        <Topbar
          user={user}
          unread={unread}
          onMenu={() => setMobileOpen(true)}
          onToggleCollapse={() => setCollapsedSaved(!collapsed)}
          onLogout={doLogout}
        />
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}