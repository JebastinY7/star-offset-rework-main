// Single source of truth for the sidebar and the topbar page title.
// admin: true  -> visible to superusers only (same rules as the old Django sidebar.html)
// A group has `children`; a plain link has `to`.
export const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: "home" },
  { to: "/customers", label: "Customers", icon: "users" },
  { to: "/billing", label: "Billing", icon: "billing" },
  { to: "/reports", label: "Reports", icon: "chart", admin: true },
  { to: "/orders", label: "Orders", icon: "cart" },
  { to: "/shop-orders", label: "Shop Orders", icon: "store", admin: true },
  { to: "/vendor-work", label: "Vendor Work", icon: "truck", admin: true },
  { to: "/shop-payments", label: "Shop Payments", icon: "card", admin: true },
  { to: "/quotations", label: "Quotations", icon: "quote" },
  { to: "/messages", label: "Messages", icon: "message", badge: "unread" },
  { to: "/offers", label: "Offers", icon: "gift", admin: true, end: true },
  {
    key: "history",
    label: "History",
    icon: "history",
    children: [
      { to: "/history", label: "Bills", icon: "billing" },
      { to: "/order-history", label: "Orders", icon: "cart" },
      { to: "/membership-history", label: "Membership", icon: "card", admin: true },
      { to: "/offers/history", label: "Offers", icon: "gift", admin: true },
    ],
  },
  // Price Setup is intentionally hidden because pricing is managed in backend code.
  // Keep this configuration commented for possible future re-enablement.
  // {
  //   key: "pricing",
  //   label: "Price Setup",
  //   icon: "tag",
  //   admin: true,
  //   children: [
  //     { to: "/pricing/setup", label: "Normal Price", icon: "printer" },
  //     { to: "/pricing/digital-price-setup", label: "Digital Price", icon: "monitor" },
  //   ],
  // },
  // { to: "/settings", label: "Settings", icon: "settings", admin: true },
];

// Keep only what this user may see (drops empty groups too)
export function visibleNav(isAdmin) {
  return NAV.filter((i) => isAdmin || !i.admin)
    .map((i) => (i.children ? { ...i, children: i.children.filter((c) => isAdmin || !c.admin) } : i))
    .filter((i) => !i.children || i.children.length > 0);
}

// Detail / form routes that are not in the sidebar but still need a topbar title
const EXTRA_TITLES = [
  [/^\/customers\/\d+/, "Customer Profile"],
  [/^\/shop-orders\/\d+/, "Shop Order Details"],
  [/^\/orders\/new/, "New Order"],
  [/^\/orders\/\d+\/edit/, "Edit Order"],
  [/^\/quotations\/new/, "New Quotation"],
  [/^\/quotations\/\d+\/edit/, "Edit Quotation"],
  [/^\/quotations\/\d+\/bill/, "Quotation Bill"],
  [/^\/billing\/\d+\/edit/, "Edit Bill"],
  [/^\/invoice\//, "Invoice"],
  [/^\/history\/\d+/, "Bill Details"],
  [/^\/messages\/.+/, "Chat"],
];

export function pageTitle(pathname) {
  for (const [re, title] of EXTRA_TITLES) if (re.test(pathname)) return title;
  const flat = NAV.flatMap((i) => (i.children ? i.children : [i]));
  const hits = flat.filter((i) => pathname === i.to || pathname.startsWith(i.to + "/"));
  hits.sort((a, b) => b.to.length - a.to.length); // most specific match wins (/offers/history > /offers)
  const hit = hits[0];
  if (!hit) return "Star Offset Printing";
  const parent = NAV.find((i) => i.children?.includes(hit));
  return parent ? `${parent.label} · ${hit.label}` : hit.label;
}

export function isPathInGroup(group, pathname) {
  return group.children.some((c) => pathname === c.to || pathname.startsWith(c.to + "/"));
}