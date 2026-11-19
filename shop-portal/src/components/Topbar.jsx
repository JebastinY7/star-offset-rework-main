import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import Icon from "./Icon";
import api from "../api";
import { useCart } from "../CartContext";
import { formatMoney, useWallet } from "../WalletContext";
import ShopBell from "./ShopBell";
import ThemeToggle from "./ThemeToggle";
import "../wallet.css";

// close a dropdown on outside click / Escape
function useDismiss(ref, open, close) {
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const esc = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [ref, open, close]);
}

export default function Topbar({ shop, onMenu, onToggleCollapse, onLogout }) {
  const nav = useNavigate();
  const { count } = useCart();
  const { balance } = useWallet();
  const balanceText = balance === null ? "—" : formatMoney(balance);
  const [q, setQ] = useState("");
  const [services, setServices] = useState(null); // null = not loaded yet
  const [loadFailed, setLoadFailed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const searchRef = useRef(null);
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef(null);
  useDismiss(userRef, userOpen, () => setUserOpen(false));
  useDismiss(searchRef, searchOpen, () => setSearchOpen(false));

  // load the service list once, the first time the person starts typing
  const term = q.trim();
  useEffect(() => {
    if (!term || services !== null) return;
    api.get("/shop/services/")
      .then((r) => setServices(r.data.services || []))
      .catch(() => { setServices([]); setLoadFailed(true); });
  }, [term, services]);

  // live matches while typing (service name or description)
  const results = useMemo(() => {
    if (!term || !services) return [];
    const t = term.toLowerCase();
    return services
      .filter((s) => s.name.toLowerCase().includes(t) || (s.description || "").toLowerCase().includes(t))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(t)) - Number(a.name.toLowerCase().startsWith(t)) || a.name.localeCompare(b.name))
      .slice(0, 6);
  }, [services, term]);

  const open = (s) => {
    setSearchOpen(false);
    setQ("");
    nav(`/prices/${s.kind}/${s.id}`);
  };

  const search = (e) => {
    e.preventDefault();
    if (!term) return;
    if (active >= 0 && results[active]) return open(results[active]);
    setSearchOpen(false);
    nav(`/prices?q=${encodeURIComponent(term)}`);
  };

  const onKey = (e) => {
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? results.length - 1 : i - 1)); }
  };

  const initials = (shop.name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  return (
    <header className="topbar">
      <button type="button" className="icon-btn only-mobile" onClick={onMenu} aria-label="Open menu"><Icon name="menu" size={22} /></button>
      <button type="button" className="icon-btn only-desktop" onClick={onToggleCollapse} aria-label="Collapse sidebar" title="Collapse / expand sidebar"><Icon name="panel" size={20} /></button>

      <form className="topbar-search" role="search" onSubmit={search} ref={searchRef} autoComplete="off">
        <Icon name="search" size={16} />
        <input value={q} placeholder="Search printing prices…" aria-label="Search"
          onChange={(e) => { setQ(e.target.value); setSearchOpen(true); setActive(-1); }}
          onFocus={() => setSearchOpen(true)} onKeyDown={onKey} />
        {searchOpen && term && (
          <div className="search-results" role="listbox">
            {services === null && <p className="sr-note">Searching…</p>}
            {services !== null && loadFailed && <p className="sr-note">Search is unavailable right now.</p>}
            {services !== null && !loadFailed && results.length === 0 && <p className="sr-note">Not available</p>}
            {results.map((s, i) => (
              <button type="button" role="option" aria-selected={i === active} key={s.key}
                className={`sr-item${i === active ? " active" : ""}`}
                onMouseEnter={() => setActive(i)} onClick={() => open(s)}>
                <span className="sr-name">{s.name}</span>
                <span className="sr-price">{s.from_price != null ? `From ₹${Number(s.from_price).toLocaleString("en-IN")}` : "Price varies"}</span>
              </button>
            ))}
          </div>
        )}
      </form>

      <div className="topbar-right">
        <ThemeToggle />
        <NavLink to="/wallet" title="My Wallet" aria-label={`My Wallet, available balance ${balanceText}`}
          className={({ isActive }) => `wallet-chip${isActive ? " active" : ""}`}>
          <span className="wc-ico"><Icon name="wallet" size={15} /></span>
          <b className="wc-amt">{balanceText}</b>
        </NavLink>
        <Link to="/cart" className="icon-btn cart-top" aria-label={`Order cart, ${count} item${count === 1 ? "" : "s"}`} title="Order Cart">
          <Icon name="cart" size={20} />
          {count > 0 && <span className="count-badge">{count > 99 ? "99+" : count}</span>}
        </Link>
        <ShopBell />

        <div className="user-menu" ref={userRef}>
          <button type="button" className="user-btn" onClick={() => setUserOpen((o) => !o)} aria-haspopup="menu" aria-expanded={userOpen}>
            <span className="avatar">{initials}</span>
            <span className="user-meta only-desktop"><strong>{shop.name}</strong></span>
            <Icon name="chevron" size={16} className={`chev${userOpen ? " open" : ""}`} />
          </button>
          {userOpen && (
            <div className="dropdown" role="menu">
              <div className="dropdown-head"><strong>{shop.name}</strong><small>{shop.username}</small></div>
              <Link to="/profile" role="menuitem" onClick={() => setUserOpen(false)}><Icon name="user" size={17} /> Shop Profile</Link>
              <Link to="/change-password" role="menuitem" onClick={() => setUserOpen(false)}><Icon name="lock" size={17} /> Change Password</Link>
              <button type="button" role="menuitem" className="dd-logout" onClick={onLogout}><Icon name="logout" size={17} /> Logout</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}