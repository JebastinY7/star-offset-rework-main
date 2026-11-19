import { createContext, useContext, useEffect, useState } from "react";
import api from "./api";
import { disablePush } from "./push";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [shop, setShop] = useState(undefined); // undefined = still loading, null = signed out

  useEffect(() => {
    api.get("/auth/csrf/").then(() => api.get("/shop/me/"))
      .then((r) => setShop(r.data.shop))
      .catch(() => setShop(null));
  }, []);

  const login = async (username, password) => {
    const r = await api.post("/shop/auth/login/", { username, password });
    setShop(r.data.shop);
  };
  const logout = async () => {
    await disablePush(); // this browser stops getting the account's push alerts
    try { await api.post("/shop/auth/logout/"); } finally { setShop(null); }
  };

  // re-read the signed-in shop (e.g. after the temporary password was replaced)
  const refresh = async () => {
    const r = await api.get("/shop/me/");
    setShop(r.data.shop);
  };

  // shop logo shown at the top of the sidebar
  const uploadLogo = async (file) => {
    const body = new FormData();
    body.append("logo", file);
    const r = await api.post("/shop/logo/", body);
    setShop((s) => (s ? { ...s, logo_url: r.data.logo_url } : s));
  };
  const removeLogo = async () => {
    await api.delete("/shop/logo/");
    setShop((s) => (s ? { ...s, logo_url: "" } : s));
  };

  return <AuthCtx.Provider value={{ shop, login, logout, refresh, uploadLogo, removeLogo }}>{children}</AuthCtx.Provider>;
}
