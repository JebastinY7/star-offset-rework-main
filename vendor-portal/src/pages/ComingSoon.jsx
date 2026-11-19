import { useLocation } from "react-router-dom";
import Icon from "../components/Icon";
import { NAV } from "../components/navConfig";

// placeholder for sidebar pages that are not built yet
export default function ComingSoon() {
  const { pathname } = useLocation();
  const item = NAV.find((i) => i.to === pathname);
  return (
    <div className="vd">
      <div className="vd-card soon">
        <span className="vd-empty-ico"><Icon name={item?.icon || "info"} size={28} /></span>
        <h1>{item?.label || "This page"}</h1>
        <p>This page is coming soon. For now, you can follow your work from the Dashboard.</p>
      </div>
    </div>
  );
}
