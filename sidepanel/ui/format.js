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

export function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
