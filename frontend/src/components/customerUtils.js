// Small helpers shared by the customers list, the customer form and the profile page.
export const CATEGORIES = ["Customer", "Student", "Shop"];

export const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

// "2026-10-12" or an ISO timestamp -> "12 Oct 2026"
export const fmtDate = (d) => {
  if (!d) return "—";
  const date = new Date(d.length === 10 ? d + "T00:00:00" : d);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}, ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
};

// local "YYYY-MM-DD" (call it inside a useState initializer)
export const todayStr = () => new Date().toLocaleDateString("en-CA");

// active / expired / none  (same rule the API uses)
export function membershipOf(c, today) {
  if (!c.is_member) return "none";
  if (c.expiry_date && c.expiry_date < today) return "expired";
  return "active";
}
export const MEMBERSHIP_LABEL = { active: "Active", expired: "Expired", none: "None" };
export const MEMBERSHIP_PILL = { active: "green", expired: "red", none: "" };

export const initials = (name = "") =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";