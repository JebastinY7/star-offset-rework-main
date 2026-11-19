import { createContext, useContext, useEffect, useState } from "react";
import api from "./api";
import { disablePush } from "./push";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still loading

  useEffect(() => {
    api.get("/auth/csrf/").then(() => api.get("/auth/me/"))
      .then((r) => setUser(r.data.user))
      .catch(() => setUser(null));
  }, []);

  // one sign-in for admin and staff - the server decides the role from the account
  const login = async (identifier, password) => {
    const r = await api.post("/auth/login/", { identifier, password });
    setUser(r.data.user);
  };
  const logout = async () => {
    await disablePush(); // this browser stops getting the account's push alerts
    await api.post("/auth/logout/");
    setUser(null);
  };

  return <AuthCtx.Provider value={{ user, login, logout }}>{children}</AuthCtx.Provider>;
}
