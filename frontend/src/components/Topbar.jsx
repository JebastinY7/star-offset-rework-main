import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Icon from "./Icon";
import NotificationBell from "./NotificationBell";
import ThemeToggle from "./ThemeToggle";
import { pageTitle } from "./navConfig";

export default function Topbar({ user, onMenu, onToggleCollapse, onLogout }) {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef(null);

  // close the user dropdown on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setMenuOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [menuOpen]);

  const initial = (user.username || "?").charAt(0).toUpperCase();

  return (
    <header className="topbar no-print">
      <button type="button" className="icon-btn only-mobile" onClick={onMenu} aria-label="Open menu">
        <Icon name="menu" size={22} />
      </button>
      <button type="button" className="icon-btn only-desktop" onClick={onToggleCollapse} aria-label="Collapse sidebar" title="Collapse / expand sidebar">
        <Icon name="panel" size={20} />
      </button>

      <h2 className="topbar-title">{pageTitle(pathname)}</h2>

      <div className="topbar-right">
        <NotificationBell />

        <ThemeToggle />

        <div className="user-menu" ref={ref}>
          <button type="button" className="user-btn" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
            <span className="avatar">{initial}</span>
            <span className="user-meta only-desktop">
              <strong>{user.username}</strong>
              <small>{user.role}</small>
            </span>
            <Icon name="chevron" size={16} className={`chev${menuOpen ? " open" : ""}`} />
          </button>

          {menuOpen && (
            <div className="dropdown" role="menu">
              <div className="dropdown-head">
                <strong>{user.username}</strong>
                <small>{user.role}</small>
              </div>
              {user.is_superuser && (
                <Link to="/settings" role="menuitem" onClick={() => setMenuOpen(false)}>
                  <Icon name="settings" size={17} /> Settings
                </Link>
              )}
              <button type="button" role="menuitem" className="dd-logout" onClick={onLogout}>
                <Icon name="logout" size={17} /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}