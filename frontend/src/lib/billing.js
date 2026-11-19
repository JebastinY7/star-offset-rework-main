import { customRound } from "./pricing";

const todayStr = () => new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd, local time

// Same rule as the old page / backend: shop > active member > customer
export function customerTypeOf(c) {
  if (!c) return "customer";
  if ((c.category || "").toLowerCase() === "shop") return "shop";
  if (c.is_member && c.expiry_date && c.expiry_date >= todayStr()) return "member";
  return "customer";
}

export const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// All bill totals in one place (port of calculateTotal)
export function computeTotals({ items, previousDue, oldDuePay, extraDiscount, paidInput }) {
  const prev = num(previousDue);
  const oldPaid = Math.min(Math.max(num(oldDuePay), 0), prev);
  const remainingOldDue = prev - oldPaid;

  // no item discounts while old due is pending
  const lines = items.map((i) =>
    remainingOldDue > 0 ? { ...i, discount: 0, total: i.gross + i.extraCharge } : i
  );

  const gross = lines.reduce((s, i) => s + i.gross, 0);
  const extraCharge = lines.reduce((s, i) => s + i.extraCharge, 0);
  const itemDiscount = lines.reduce((s, i) => s + i.discount, 0);
  const totalDiscount = itemDiscount + Math.max(num(extraDiscount), 0);

  const net = Math.max(gross + extraCharge - totalDiscount, 0);
  const final = customRound(net);

  const paid = paidInput === null ? final : Math.min(Math.max(num(paidInput), 0), final);
  const currentDue = Math.max(final - paid, 0);
  const totalDue = currentDue + remainingOldDue;
  const status = paid >= final ? "PAID" : paid > 0 ? "PARTIAL" : "DUE";

  return { lines, gross, extraCharge, totalDiscount, net, final, paid, oldPaid, remainingOldDue, currentDue, totalDue, status };
}
