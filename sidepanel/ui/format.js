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

export function parseSheetDate(value) {
  if (!value) return null;
  const d = new Date(`${String(value).replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

const TRACKING_PARAM =
  /^(utm_.*|ga_.*|fbclid|gclid|msclkid|mc_cid|mc_eid|igshid|ref|referrer|source|src|trk|trackingid|origin|position|refid|pagenum|lipi|eBP)$/i;

export function canonicalJobUrl(value) {
  const href = safeHttpUrl(value);
  if (!href) return "";
  try {
    const url = new URL(href);
    url.protocol = "https:";
    url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    url.hash = "";
    [...url.searchParams.keys()].forEach((key) => {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    });
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function withinDays(value, days) {
  const d = parseSheetDate(value);
  if (!d) return false;
  return Date.now() - d.getTime() <= Number(days) * 86400000;
}

export function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
