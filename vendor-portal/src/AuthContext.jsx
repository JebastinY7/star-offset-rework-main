import { createContext, useContext, useEffect, useState } from "react";
import api from "./api";
import { disablePush } from "./push";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [vendor, setVendor] = useState(undefined); // undefined = still loading, null = signed out

  useEffect(() => {
    api.get("/auth/csrf/").then(() => api.get("/vendor/me/"))
      .then((r) => setVendor(r.data.vendor))
      .catch(() => setVendor(null));
  }, []);

  const login = async (username, password) => {
    const r = await api.post("/vendor/auth/login/", { username, password });
    setVendor(r.data.vendor);
  };
  const logout = async () => {
    await disablePush(); // this browser stops getting the account's push alerts
    try { await api.post("/vendor/auth/logout/"); } finally { setVendor(null); }
  };

  return <AuthCtx.Provider value={{ vendor, login, logout }}>{children}</AuthCtx.Provider>;
}
