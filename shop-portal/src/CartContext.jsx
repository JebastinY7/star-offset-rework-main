import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { deleteFiles, loadFiles, saveFiles } from "./fileStore";

// The order cart.  Item details live in localStorage (per shop); each item's artwork files live in
// IndexedDB (files cannot be stored as text).  The estimate on an item is only a preview - the server
// re-prices everything when the order is sent.
const CartCtx = createContext(null);
export const useCart = () => useContext(CartCtx);

const keyFor = (shopId) => `shop-cart-${shopId}`;
const fileKey = (shopId, itemId) => `${shopId}:${itemId}`;

function load(shopId) {
  if (!shopId) return [];
  try {
    const items = JSON.parse(localStorage.getItem(keyFor(shopId)) || "[]");
    return Array.isArray(items) ? items : [];
  } catch { return []; }
}

function CartStore({ shopId, children }) {
  const [items, setItems] = useState(() => load(shopId));
  const [files, setFiles] = useState({}); // item id -> File[]

  // bring back the artwork of items added earlier (before a refresh / new visit)
  useEffect(() => {
    let live = true;
    Promise.all(items.map(async (i) => [i.id, await loadFiles(fileKey(shopId, i.id))])).then((pairs) => {
      if (!live) return;
      const restored = Object.fromEntries(pairs.filter(([, f]) => Array.isArray(f) && f.length));
      setFiles((now) => ({ ...restored, ...now }));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only once, when the cart first opens
  }, []);

  const save = (next) => {
    setItems(next);
    try { localStorage.setItem(keyFor(shopId), JSON.stringify(next)); } catch { /* storage blocked - cart lasts for this visit only */ }
  };

  const setItemFiles = (id, list) => {
    setFiles((now) => ({ ...now, [id]: list }));
    if (list.length) saveFiles(fileKey(shopId, id), list); else deleteFiles([fileKey(shopId, id)]);
  };

  const addItem = (item, itemFiles = []) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    save([...items, { ...item, id }]);
    if (itemFiles.length) setItemFiles(id, itemFiles);
    return id;
  };
  const removeItem = (id) => {
    save(items.filter((i) => i.id !== id));
    setFiles(({ [id]: _gone, ...rest }) => rest);
    deleteFiles([fileKey(shopId, id)]);
  };
  const clear = () => {
    deleteFiles(items.map((i) => fileKey(shopId, i.id)));
    setFiles({});
    save([]);
  };
  const filesOf = (id) => files[id] || [];

  return (
    <CartCtx.Provider value={{ items, count: items.length, addItem, removeItem, clear, filesOf, setItemFiles }}>
      {children}
    </CartCtx.Provider>
  );
}

// keyed by shop so a different login never sees someone else's cart
export function CartProvider({ children }) {
  const { shop } = useAuth();
  return <CartStore key={shop?.id ?? "none"} shopId={shop?.id}>{children}</CartStore>;
}