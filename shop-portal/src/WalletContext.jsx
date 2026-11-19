import { createContext, useCallback, useContext, useEffect, useState } from "react";
import api, { errorText } from "./api";
import { useAuth } from "./AuthContext";

// Wallet balance + recent transactions, shared by the top bar chip and the My Wallet page.
// Call refresh() after anything that changes the balance (top-up, placing an order).
const WalletCtx = createContext(null);
export const useWallet = () => useContext(WalletCtx);

export const formatMoney = (v) =>
  `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function WalletStore({ shopId, children }) {
  const [data, setData] = useState({ balance: null, transactions: [] });
  const [loading, setLoading] = useState(Boolean(shopId));
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!shopId) return;
    try {
      const r = await api.get("/shop/wallet/");
      setData({ balance: r.data.balance, transactions: r.data.transactions || [] });
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => { refresh(); }, [refresh]);

  // pick up changes made elsewhere when the shop comes back to this tab
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return (
    <WalletCtx.Provider value={{ balance: data.balance, transactions: data.transactions, loading, error, refresh }}>
      {children}
    </WalletCtx.Provider>
  );
}

// keyed by shop so a different login never sees someone else's balance
export function WalletProvider({ children }) {
  const { shop } = useAuth();
  // no balance request while the shop still has to replace its temporary password (the API refuses it);
  // the store remounts - and loads - as soon as that is done
  const shopId = shop && !shop.must_change_password ? shop.id : null;
  return <WalletStore key={shopId ?? "none"} shopId={shopId}>{children}</WalletStore>;
}