import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import Icon from "./Icon";
import { isPathInGroup, visibleNav } from "./navConfig";

function Item({ item, sub, unread, onNavigate }) {
  const count = item.badge === "unread" ? unread : 0;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={item.label}
      onClick={onNavigate}
      className={({ isActive }) => `sb-link${sub ? " sub" : ""}${isActive ? " active" : ""}`}
    >
      <Icon name={item.icon} size={sub ? 17 : 20} />
      <span className="sb-label">{item.label}</span>
      {count > 0 && <span className="sb-badge">{count}</span>}
    </NavLink>
  );
}

function Group({ group, collapsed, onExpand, onNavigate }) {
  const { pathname } = useLocation();
  const active = isPathInGroup(group, pathname);
  const [manual, setManual] = useState(null); // null = follow the route, true/false = user toggled
  const open = (manual ?? active) && !collapsed;

  const toggle = () => {
    if (collapsed) { onExpand(); setManual(true); return; } // icon rail: expand first
    setManual(!open);
  };

  return (
    <div className="sb-group">
      <button type="button" title={group.label} onClick={toggle}
        className={`sb-link group-btn${active ? " active-parent" : ""}`} aria-expanded={open}>
        <Icon name={group.icon} />
        <span className="sb-label">{group.label}</span>
        <Icon name="chevron" size={16} className={`chev${open ? " open" : ""}`} />
      </button>
      <div className={`sb-sub${open ? " show" : ""}`}>
        <div>
          {group.children.map((c) => <Item key={c.to} item={c} sub onNavigate={onNavigate} />)}
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({ isAdmin, unread, collapsed, mobileOpen, onExpand, onClose, onLogout }) {
  const items = visibleNav(isAdmin);
  return (
    <aside className={`sidebar no-print${isAdmin ? "" : " staff"}${mobileOpen ? " open" : ""}`}>
      <div className="sb-brand">
        <img src="/images/logo.png" alt="Star Offset Printing" className="sb-logo" />
        <div className="sb-brand-text">
          <strong>Star Offset</strong>
          <span>Printing</span>
        </div>
        <button type="button" className="icon-btn sb-close" onClick={onClose} aria-label="Close menu">
          <Icon name="close" />
        </button>
      </div>

      <nav className="sb-nav">
        {items.map((i) =>
          i.children
            ? <Group key={i.key} group={i} collapsed={collapsed} onExpand={onExpand} onNavigate={onClose} />
            : <Item key={i.to} item={i} unread={unread} onNavigate={onClose} />
        )}
      </nav>

      <div className="sb-foot">
        <button type="button" className="sb-link" title="Logout" onClick={onLogout}>
          <Icon name="logout" />
          <span className="sb-label">Logout</span>
        </button>
      </div>
    </aside>
  );
}