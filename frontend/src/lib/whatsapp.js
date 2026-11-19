// Small helpers shared by the Messages inbox and the chat screen.

// "06 Oct, 3:42 pm" (the API already sends local-time ISO strings)
export const fmtWhen = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
      })
    : "";

const dayKey = (d) => d.toLocaleDateString("en-CA"); // 2026-10-12 in local time

// "8:32 PM"
export const fmtClock = (iso) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase() : "";

// day heading inside a chat: Today / Yesterday / 06 Oct 2026
export const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "Today";
  if (dayKey(d) === dayKey(yest)) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
export const sameDay = (a, b) => dayKey(new Date(a)) === dayKey(new Date(b));

// time column in the inbox / chat list: 8:32 PM today, Yesterday, 06 Oct, 06 Oct 25
export const fmtListTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return fmtClock(iso);
  if (dayKey(d) === dayKey(yest)) return "Yesterday";
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", ...(sameYear ? {} : { year: "2-digit" }) });
};

// avatar letters + a stable colour per phone number
export const initials = (name) => {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
};
const TONES = ["#0e7c66", "#2563eb", "#9333ea", "#c2410c", "#be185d", "#0f766e", "#4f46e5", "#a16207"];
export const avatarColor = (key) => {
  let h = 0;
  for (const ch of String(key || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
};

// One-line preview of a message for the inbox list
export function previewText(m) {
  const who = m.direction === "out" ? "You: " : "";
  const caption = m.body ? ` - ${m.body}` : "";
  let text;
  switch (m.message_type) {
    case "image": text = `📷 Photo${caption}`; break;
    case "video": text = `🎥 Video${caption}`; break;
    case "audio": text = "🎤 Voice message"; break;
    case "sticker": text = "Sticker"; break;
    case "document": text = `📎 ${m.media_filename || "Document"}`; break;
    default: text = m.body || "(non-text message)";
  }
  text = text.replace(/\s+/g, " ");
  return who + (text.length > 60 ? text.slice(0, 60) + "…" : text);
}

// "YYYY-MM-DD" range for the inbox date filter
export function rangeDates(range, from, to) {
  const fmt = (d) => d.toLocaleDateString("en-CA");
  const today = new Date();
  const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
  switch (range) {
    case "today": return { from: fmt(today), to: fmt(today) };
    case "yesterday": return { from: fmt(back(1)), to: fmt(back(1)) };
    case "7d": return { from: fmt(back(6)), to: fmt(today) };
    case "30d": return { from: fmt(back(29)), to: fmt(today) };
    case "custom": return { from, to };
    default: return { from: "", to: "" };
  }
}