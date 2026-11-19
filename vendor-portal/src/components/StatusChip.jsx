// "2026-10-20" or a full ISO timestamp -> 20 Oct 2026
export const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

// what Star Offset pays the vendor; "—" when not set yet
export const money = (v) => (v !== null && v !== undefined && v !== "" ? `₹${Number(v).toLocaleString("en-IN")}` : "—");

// pass the whole job row: a past-due open job shows as "Overdue" whatever its real status is
export default function StatusChip({ status, label, overdue }) {
  if (overdue) return <span className="vchip overdue">Overdue</span>;
  return <span className={`vchip ${status}`}>{label || status}</span>;
}
