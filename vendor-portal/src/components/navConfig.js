// Single source of truth for the Vendor Portal sidebar.
// `built: true` = a real page exists. Everything else opens a "coming soon" placeholder
// (see App.jsx) - when you build a page, add `built: true` and give it a <Route> in App.jsx.
// `badge` names a key of dashboard stats that is shown as a red count next to the label.
export const NAV = [
  { to: "/", label: "Dashboard", icon: "home", end: true, built: true },
  { to: "/assigned", label: "Assigned Work", icon: "file", badge: "new", built: true },
  { to: "/in-progress", label: "In Progress", icon: "play", built: true },
  { to: "/ready", label: "Ready for Pickup", icon: "box", built: true },
  { to: "/completed", label: "Completed", icon: "checkcircle", built: true },
  { to: "/price-requests", label: "Price Requests", icon: "quote", badge: "quotes", built: true },
  { to: "/history", label: "History", icon: "history" },
];