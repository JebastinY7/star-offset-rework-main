// Pricing rules ported 1:1 from the old billing.html script.
// Pure functions only (no DOM), so they can be unit-tested.

export const round2 = (n) => Math.round(n * 100) / 100;

// 0.5 and above rounds up (same as customRoundAmount in the old page)
export function customRound(amount) {
  const whole = Math.floor(amount);
  return amount - whole < 0.5 ? whole : whole + 1;
}

/* ---------------- PAPER PRICE ----------------
   Paper price per sheet is typed in Settings > Paper Price and arrives from the server in
   dbData.paper_rates (GET /billing/price/). These numbers are only a fallback for when the
   server did not send any (old response / offline), so a bill is never priced with NaN. */
export const DEFAULT_PAPER_RATES = {
  standard_original: 0.42, // A4 original paper
  low_original: 0.35,      // A4 original paper, "low" print
  duplicate: 0.3,          // A4 duplicate paper
  legal_original: 0.6,     // Legal original paper
  legal_duplicate: 0.4,    // Legal duplicate paper
};

// Use the server value for every key; anything missing / not a positive number falls back to the default
export function resolvePaperRates(rates) {
  const out = { ...DEFAULT_PAPER_RATES };
  for (const k of Object.keys(out)) {
    const n = parseFloat(rates?.[k]);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

/* ---------------- BILL BOOK ---------------- */
export function billBookRoundOff(amount) {
  const rounded = Math.round(amount);
  const d = rounded % 10;
  if (d === 0 || d === 5) return rounded;
  if (d >= 1 && d <= 4) return rounded + (5 - d);
  return rounded + (10 - d);
}

const A4_TABLE = [[100,150],[200,180],[300,200],[500,250],[1000,250],[2000,500],[3000,750],[4000,1000],[5000,1250],[10000,2500]];
const A5_TABLE = [[100,150],[200,150],[300,180],[500,200],[1000,250],[2000,250],[3000,500],[4000,500],[5000,750],[10000,1250]];
const A6_TABLE = [[400,150],[600,150],[800,180],[1200,200],[1500,250],[4000,250],[6000,500],[8000,750],[12000,1000],[15000,1250],[40000,2500]];
const LGL_TABLE = [[100,180],[200,200],[300,220],[500,270],[1000,300],[2000,600],[3000,900],[4000,1200],[5000,1500],[10000,3000]];

export function billBookPrintCost(totalPapers, isLegal, isA5, isA6) {
  const table = isLegal ? LGL_TABLE : isA5 ? A5_TABLE : isA6 ? A6_TABLE : A4_TABLE;
  if (totalPapers <= 0) return 0;
  for (const [limit, cost] of table) if (totalPapers <= limit) return cost;
  const last = table[table.length - 1];
  const prev = table[table.length - 2];
  const ratePer1000 = (last[1] - prev[1]) / ((last[0] - prev[0]) / 1000);
  const extraSteps = Math.ceil((totalPapers - last[0]) / 1000);
  return Math.round((last[1] + extraSteps * ratePer1000) * 100) / 100;
}

export function calculateBillBookPrice(qty, job, variantText, sizeText, paperRates) {
  const rates = resolvePaperRates(paperRates);
  qty = parseFloat(qty) || 0;
  job = parseFloat(job) || 1;
  variantText = (variantText || "").toLowerCase();
  sizeText = (sizeText || "").toLowerCase();

  const totalBooks = qty;
  const totalPapers = totalBooks * 100;
  const isLegal = sizeText.includes("legal");
  const isA5 = sizeText.includes("a5");
  const isA6 = sizeText.includes("a6");

  let originalRate, duplicateRate, designChargeAmount;
  if (isLegal) {
    originalRate = rates.legal_original; duplicateRate = rates.legal_duplicate; designChargeAmount = 200;
  } else {
    const baseOriginal = variantText.includes("low") ? rates.low_original : rates.standard_original;
    const baseDuplicate = rates.duplicate;
    if (isA5) { originalRate = baseOriginal / 2; duplicateRate = baseDuplicate / 2; designChargeAmount = 100; }
    else if (isA6) { originalRate = baseOriginal / 4; duplicateRate = baseDuplicate / 4; designChargeAmount = 100; }
    else { originalRate = baseOriginal; duplicateRate = baseDuplicate; designChargeAmount = 150; }
  }

  const paperRate = variantText.includes("dupl") ? originalRate + duplicateRate : originalRate;
  const paperCost = Math.round(totalPapers * paperRate * 100) / 100;
  const printCost = billBookPrintCost(totalPapers, isLegal, isA5, isA6);
  const designCharge = totalBooks > 0 ? designChargeAmount : 0;

  let bindingRate;
  if (isLegal) bindingRate = totalBooks <= 10 ? 60 : totalBooks <= 30 ? 50 : 40;
  else if (isA5) bindingRate = totalBooks <= 10 ? 30 : totalBooks <= 30 ? 25 : 20;
  else if (isA6) bindingRate = totalBooks <= 10 ? 20 : totalBooks <= 30 ? 15 : 12;
  else bindingRate = totalBooks <= 10 ? 50 : totalBooks <= 30 ? 40 : 30;

  const bindingCost = totalBooks * bindingRate;
  const gross = Math.round((paperCost + printCost + designCharge + bindingCost) * job * 100) / 100;
  return billBookRoundOff(gross);
}

/* ---------------- NOTICE ---------------- */
export function calculateNoticePrice(qty, job, sizeText, variantText, paperRates) {
  const rates = resolvePaperRates(paperRates);
  qty = parseFloat(qty) || 0;
  job = parseFloat(job) || 1;
  sizeText = (sizeText || "").toLowerCase();
  variantText = (variantText || "").toLowerCase();

  const isLegal = sizeText.includes("legal") || sizeText.includes("lgl");
  const isA5 = sizeText.includes("a5");

  // Notice paper = the original paper price (A5 is half of A4)
  const paperRate = isLegal ? rates.legal_original : isA5 ? rates.standard_original / 2 : rates.standard_original;
  const paperCost = Math.round(qty * paperRate * 100) / 100;
  let designCharge = qty > 0 ? (isLegal ? 200 : isA5 ? 100 : 150) : 0;

  const printSlab = (q) => (q <= 0 ? 0 : q <= 100 ? 150 : q <= 200 ? 180 : q < 500 ? 200 : 250);
  let printCost = Math.floor(qty / 1000) * 250 + printSlab(qty % 1000);

  if (variantText.includes("double")) { printCost *= 2; designCharge *= 2; }
  return Math.round((paperCost + designCharge + printCost) * job * 100) / 100;
}

/* ---------------- NORMAL PRINT: gross amount ----------------
   category / size / variant are lower-cased names, dbPrice is the
   per-unit price from the price table. Returns {gross, price}. */
export function normalGross({ category, size, variant, qty, job, dbPrice, paperRates }) {
  let price = dbPrice;
  let gross = 0;
  const has = (s, t) => s.includes(t);

  if (["banner", "poster", "letter pad", "printing", "invitation"].some((t) => has(category, t))) {
    gross = price * job;
  } else if (has(category, "notice")) {
    gross = calculateNoticePrice(qty, job, size, variant, paperRates);
    price = gross;
  } else if (has(category, "bill book")) {
    gross = calculateBillBookPrice(qty, job, variant, size, paperRates);
    price = gross;
  } else if (has(category, "train ticket")) {
    if (has(size, "minimum")) gross = 50 + (qty - 1) * 20;
    else if (has(size, "thakkal")) gross = 75 + (qty - 1) * 20;
    else if (has(size, "premium")) gross = 100 + (qty - 1) * 20;
    if (gross) price = gross;
  } else if (has(category, "online application")) {
    if (has(size, "patta") || has(size, "chitta") || has(size, "ec")) {
      gross = qty <= 3 ? 20 : 20 + (qty - 3) * 5;
    } else gross = qty * price * job;
  } else if (has(category, "print out")) {
    const blackS = has(variant, "black s"), blackD = has(variant, "black d");
    const inkS = has(variant, "color inkjet s"), inkD = has(variant, "color inkjet d");
    const a4 = has(size, "a4") || has(size, "legal");
    const regular = qty * price * job;

    if (has(size, "sticker")) {
      gross = regular;
    } else if (blackS || blackD) {
      if (a4) {
        if (blackS) {
          if (qty <= 10) { gross = 10 + (qty - 1) * 3; price = gross; }
          else if (qty <= 20) { gross = 37 + (qty - 10) * 3; price = gross; }
          else gross = regular;
        } else {
          if (qty <= 10) { gross = 10 + (qty - 1) * 4; price = gross; }
          else if (qty <= 20) { gross = 46 + (qty - 10) * 4; price = gross; }
          else gross = regular;
        }
      } else if (has(size, "a3")) {
        if (qty <= 9) { gross = (blackS ? 15 : 20) + (qty - 1) * 7; price = gross; }
        else gross = regular;
      } else gross = regular;
    } else if (inkS || inkD) {
      if (a4) {
        if (qty <= 10) { gross = (inkS ? 15 : 25) + (qty - 1) * 10; price = gross; }
        else gross = regular;
      } else gross = regular;
    } else gross = regular;
  } else {
    gross = qty * price * job;
  }
  return { gross, price };
}

// Categories that are priced by a formula even when no row exists in the price table
export const FORMULA_CATEGORIES = ["print out", "bill book", "notice"];

// Discount % for an item, by customer type ("shop" | "member" | "customer")
export function discountPercent({ category, qty, customerType, shopDiscount, csDiscount }) {
  let shop, member;
  if (category.includes("print out")) {
    if (qty <= 1) { shop = 40; member = 25; } else { shop = 25; member = 10; }
  } else { shop = shopDiscount; member = csDiscount; }
  return customerType === "shop" ? shop : customerType === "member" ? member : 0;
}

// Full preview of one normal-print line. Returns null when no price can be worked out.
export function previewNormal({ category, size, variant, qty, job, extraCharge, dbData, customerType, remainingOldDue }) {
  const dbPrice = parseFloat(dbData.price || 0);

  // Shop customers use the final Shop Portal amount (already includes the
  // correct shop rate-card slab). Never apply an additional discount.
  if (customerType === "shop" && dbData.shop_available && dbData.shop_total != null) {
    const gross = round2(parseFloat(dbData.shop_total || 0) * (parseFloat(job) || 1));
    return {
      // Display the actual backend slab rate, not rounded total / quantity.
      // The total can be rounded independently (e.g. 31 × ₹2.50 = ₹77.50 -> ₹78).
      price: round2(parseFloat(dbData.shop_rate ?? (qty > 0 ? gross / qty : 0)) * (parseFloat(job) || 1)),
      gross,
      discountPercent: 0,
      fullDiscount: 0,
      discount: 0,
      total: gross + extraCharge,
    };
  }

  if (dbPrice <= 0 && !FORMULA_CATEGORIES.some((t) => category.includes(t))) return null;

  const { gross, price } = normalGross({ category, size, variant, qty, job, dbPrice, paperRates: dbData.paper_rates });
  const pct = discountPercent({
    category, qty, customerType,
    shopDiscount: parseFloat(dbData.shop_discount || 0),
    csDiscount: parseFloat(dbData.cs_discount || 0),
  });
  // fullDiscount is remembered on the item; it only takes effect once no old due is pending
  const fullDiscount = gross * (pct / 100);
  const discount = remainingOldDue <= 0 ? fullDiscount : 0;
  return { price, gross, discountPercent: pct, fullDiscount, discount, total: gross - discount + extraCharge };
}

// Digital print: slab price, one rate per line (not qty x price)
export function previewDigital({ data, job, extraCharge, customerType }) {
  const shop = customerType === "shop";
  const member = customerType === "member";
  const basePrice = shop ? parseFloat(data.shop_rate || 0) : parseFloat(data.customer_rate || 0);
  const pct = member ? parseFloat(data.customer_discount || 0) : 0;
  const gross = basePrice * job;
  const discount = gross * (pct / 100);
  return { price: basePrice, gross, discountPercent: pct, fullDiscount: discount, discount, total: gross - discount + extraCharge };
}
