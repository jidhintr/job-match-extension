export const MAX_TRACKER_STATUSES = 5;
export const ANALYSED_STATUS = "Analysed";
export const DEFAULT_TRACKER_STATUS_OPTIONS = [
  { label: "New", enabled: true },
  { label: "Pending", enabled: true },
  { label: "Applied", enabled: true },
  { label: "Rejected", enabled: true }
];

export const DEFAULT_CACHE_TTL_HOURS = 2;
export const MIN_CACHE_TTL_HOURS = 1;
export const MAX_CACHE_TTL_HOURS = 24;

export const DEFAULT_GUARD_MIN_ATS = 50;
export const DEFAULT_GUARD_MIN_CHANCE = 40;
export const DEFAULT_GUARD_KEYWORDS = ".net";

export function sanitizeTrackerStatusOptions(saved) {
  if (!Array.isArray(saved) || saved.length === 0) return DEFAULT_TRACKER_STATUS_OPTIONS.map((s) => ({ ...s }));
  const cleaned = saved
    .filter((s) => s && typeof s.label === "string" && s.label.trim())
    .filter((s) => s.label.trim().toLowerCase() !== ANALYSED_STATUS.toLowerCase())
    .slice(0, MAX_TRACKER_STATUSES)
    .map((s) => ({ label: s.label.trim(), enabled: s.enabled !== false }));
  return cleaned.length > 0 ? cleaned : DEFAULT_TRACKER_STATUS_OPTIONS.map((s) => ({ ...s }));
}

export function sanitizeCacheTtlHours(value) {
  const hours = Math.round(Number(value));
  if (!Number.isFinite(hours)) return DEFAULT_CACHE_TTL_HOURS;
  return Math.min(MAX_CACHE_TTL_HOURS, Math.max(MIN_CACHE_TTL_HOURS, hours));
}

export function sanitizeThreshold(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, n));
}
