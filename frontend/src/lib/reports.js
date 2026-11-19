// Helpers shared by the Reports pages (Reports.jsx, ReportDetail.jsx, components/ReportPeriod.jsx)

export const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

// Short money for chart axes: ₹1.2k, ₹4.5L, ₹1.1Cr
export function compactMoney(n) {
  const v = Number(n || 0);
  const trim = (x) => String(Math.round(x * 10) / 10);
  if (v >= 1e7) return `₹${trim(v / 1e7)}Cr`;
  if (v >= 1e5) return `₹${trim(v / 1e5)}L`;
  if (v >= 1e3) return `₹${trim(v / 1e3)}k`;
  return `₹${Math.round(v)}`;
}

// "14 Oct" (this year) / "14 Oct 25" (other years). Takes a "YYYY-MM-DD" string.
export function fmtDay(d) {
  if (!d) return "—";
  const date = new Date(d + "T00:00:00");
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", ...(sameYear ? {} : { year: "2-digit" }) });
}

// local-time YYYY-MM-DD (toISOString would shift the day for users ahead of UTC, like India)
export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const PRESETS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["month", "This Month"],
  ["last_month", "Last Month"],
  ["year", "This Year"],
  ["custom", "Custom"],
];

export function presetRange(key, now = new Date()) {
  const day = (y, m, d) => new Date(y, m, d);
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = day(y, m, now.getDate());
  const back = (n) => day(y, m, now.getDate() - n);
  switch (key) {
    case "today": return { from: iso(today), to: iso(today) };
    case "yesterday": return { from: iso(back(1)), to: iso(back(1)) };
    case "7d": return { from: iso(back(6)), to: iso(today) };
    case "30d": return { from: iso(back(29)), to: iso(today) };
    case "last_month": return { from: iso(day(y, m - 1, 1)), to: iso(day(y, m, 0)) };
    case "year": return { from: iso(day(y, 0, 1)), to: iso(today) };
    case "month":
    default: return { from: iso(day(y, m, 1)), to: iso(today) };
  }
}

// which preset (if any) a from/to pair equals - so the dropdown shows "This Month" after a reload
export function detectPreset(from, to) {
  const hit = PRESETS.find(([k]) => {
    if (k === "custom") return false;
    const r = presetRange(k);
    return r.from === from && r.to === to;
  });
  return hit ? hit[0] : "custom";
}

// the applied period lives in the URL (?date_from=&date_to=) so links, refresh and Back all keep it
export function periodFromParams(sp) {
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
  const def = presetRange("month");
  const from = ok(sp.get("date_from")) ? sp.get("date_from") : def.from;
  const to = ok(sp.get("date_to")) ? sp.get("date_to") : def.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

export const periodQuery = ({ from, to }) => `date_from=${from}&date_to=${to}`;

// the file downloads straight from the API (session cookie is sent, same as the other exports)
export function downloadReport(kind, file, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== "" && v != null) qs.set(k, v); });
  qs.set("file", file);
  window.open(`/api/reports/${kind}/export/?${qs.toString()}`, "_blank");
}

export const REPORTS = {
  sales: { title: "Sales Report", blurb: "Sales trends, bills and discounts", icon: "chart", tone: "gold" },
  collections: { title: "Collection Report", blurb: "Payments by date and payment mode", icon: "card", tone: "green" },
  outstanding: { title: "Outstanding Report", blurb: "Customer dues, unpaid bills and ageing", icon: "billing", tone: "red" },
  pnl: { title: "Profit & Loss Report", blurb: "Revenue, printing costs, operating expenses and net profit.", icon: "trend", tone: "teal" },
  orders: { title: "Printing & Orders", blurb: "Popular print jobs, order status", icon: "printer", tone: "blue" },
  customers: { title: "Customer Report", blurb: "Customer purchases, membership and renewals", icon: "users", tone: "purple" },
  shop: { title: "Shop Portal Report", blurb: "Wallet payments received from shops and what they spent on orders", icon: "store", tone: "blue" },
};