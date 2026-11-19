import { NavLink } from "react-router-dom";
import Icon from "./Icon";
import { NAV } from "./navConfig";

// dark sidebar: brand, page links (with a count badge), support card
export default function Sidebar({ stats, open, onNavigate }) {
  return (
    <aside className={`sidebar${open ? " open" : ""}`} aria-label="Main navigation">
      <div className="sb-brand">
        <span className="sb-logo"><img src="/images/logo.png" alt="" /></span>
        <div><strong>Star Offset Printing</strong><span>Vendor Portal</span></div>
      </div>

      <nav className="sb-nav">
        {NAV.map((i) => {
          const count = i.badge ? stats?.[i.badge] ?? 0 : 0;
          return (
            <NavLink key={i.to} to={i.to} end={i.end} onClick={onNavigate} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon name={i.icon} size={20} />
              <span>{i.label}</span>
              {count > 0 && <em className="sb-badge" aria-label={`${count} new`}>{count}</em>}
            </NavLink>
          );
        })}
      </nav>

      <NavLink to="/support" className="sb-help" onClick={onNavigate}>
        <span className="sb-help-ico"><Icon name="headset" size={26} /></span>
        <span><b>Need Help?</b><small>Contact Support</small></span>
        <Icon name="chevright" size={16} />
      </NavLink>
    </aside>
  );
}