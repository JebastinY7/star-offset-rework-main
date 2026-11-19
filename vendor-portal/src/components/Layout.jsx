import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import { useRealtime } from "../realtime";
import LiveToasts from "./LiveToasts";
import PushPrompt from "./PushPrompt";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

// sidebar + top bar + page. Loads the dashboard numbers once, so the sidebar badge,
// the bell and the dashboard page all read the same data (pages get it via useOutletContext()).
export default function Layout() {
  const { vendor, logout } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    api.get("/vendor/dashboard/", { signal: ctrl.signal })
      .then((r) => { setData(r.data); setError(""); })
      .catch((e) => { if (e.code !== "ERR_CANCELED") setError(errorText(e)); });
    return () => ctrl.abort();
  }, [tries, pathname]); // refresh when moving between pages

  useEffect(() => { setMenu(false); }, [pathname]);
  const reload = useCallback(() => setTries((t) => t + 1), []);
  // new price request / new work / job closed: re-read the numbers behind the sidebar badge and the bell at once
  useRealtime((m) => { if (m.type === "vendor_event" || m.type === "resync") reload(); });

  const doLogout = async () => { await logout(); nav("/login"); };

  return (
    <div className="shell">
      <Sidebar stats={data?.stats} open={menu} onNavigate={() => setMenu(false)} />
      {menu && <div className="sb-overlay" onClick={() => setMenu(false)} />}
      <LiveToasts />
      <PushPrompt />
      <div className="shell-main">
        <Topbar vendor={vendor} newCount={data?.stats?.new ?? 0} quoteCount={data?.stats?.quotes ?? 0} onLogout={doLogout} onMenu={() => setMenu(true)} />
        <main className="page"><Outlet context={{ data, error, reload }} /></main>
      </div>
    </div>
  );
}
