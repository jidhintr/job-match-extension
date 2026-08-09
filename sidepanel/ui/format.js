export function clampScore(n) {
  const num = Number(n);
  if (Number.isNaN(num)) return 0;
  const normalized = num > 0 && num < 1 ? num * 100 : num;
  return Math.max(0, Math.min(100, normalized));
}

export function fmtMoney(amount, currency) {
  if (!amount) return null;
  return `${Math.round(amount).toLocaleString()} ${currency}`;
}

export function slugify(text, index) {
  const base = (text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return base ? `${base}-${index}` : `area-${index}`;
}

// Stored dateTime is "YYYY-MM-DD HH:mm:ss" captured from the saver's device clock in UTC
// (new Date().toISOString()) — reinterpreting it as UTC and letting the browser convert back
// reproduces the original click moment in whichever device's local time is viewing it.
export function parseSheetDate(value) {
  if (!value) return null;
  const d = new Date(`${String(value).replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
