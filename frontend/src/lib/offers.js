// [value sent to the API, label shown in the UI]
export const OFFER_GROUPS = [
  ["all", "All Customers"],
  ["members", "Members"],
  ["non_members", "Non-Members"],
  ["selected", "Selected Customers"],
];
export const OFFER_CATEGORIES = [["all", "All Categories"], ["student", "Students"], ["customer", "Customer"], ["shop", "Shop"]];

// delivery status -> [label, .pill colour]
export const OFFER_STATUS = {
  draft: ["Draft", ""],
  sending: ["Sending", "blue"],
  sent: ["Sent", "green"],
  partial: ["Partial", "amber"],
  failed: ["Failed", "red"],
};

export const offerLabel = (list, v) => (list.find(([k]) => k === v) || [v, v])[1];

// "19 Jul 2026" from an ISO date or datetime
export const fmtOfferDate = (iso) =>
  iso ? new Date(iso.length > 10 ? iso : iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

// "Valid from 1 Oct 2026 to 5 Oct 2026" (same wording the server adds to the WhatsApp text)
export function validityText(from, until) {
  if (from && until) return `Valid from ${fmtOfferDate(from)} to ${fmtOfferDate(until)}`;
  if (until) return `Valid until ${fmtOfferDate(until)}`;
  if (from) return `Valid from ${fmtOfferDate(from)}`;
  return "";
}

// The text a customer receives: the approved template body with the 3 slots filled in.
export function offerBody({ title, message, valid_from, valid_until, shop_number }, name = "Customer") {
  const offer = [`${title.trim()} - ${message.trim()}`, validityText(valid_from, valid_until) && `(${validityText(valid_from, valid_until)})`]
    .filter(Boolean).join(" ");
  return `Hello ${name}, ${offer}. For details call us on ${shop_number.trim()}.`.replace(/\s+/g, " ");
}
