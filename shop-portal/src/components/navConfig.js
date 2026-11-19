// Single source of truth for the Shop Portal sidebar.
// (Shop Profile and Change Password live in the top bar's user menu.)
export const NAV = [
  { to: "/", label: "Dashboard", icon: "home", end: true },
  { to: "/prices", label: "Printing Prices", icon: "tag" },
  { to: "/orders/new", label: "Place an Order", icon: "plus" },
  { to: "/cart", label: "Order Cart", icon: "cart" },
  { to: "/orders", label: "My Orders", icon: "quote", end: true },
  { to: "/order-history", label: "Order History", icon: "history" },
];