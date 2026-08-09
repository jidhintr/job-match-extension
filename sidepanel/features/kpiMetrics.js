import { clampScore, splitCsv, parseSheetDate } from "../ui/format.js";

export const SCORE_BANDS = [
  { label: "Weak (0–49)", min: 0, max: 49, colorVar: "--red" },
  { label: "Borderline (50–75)", min: 50, max: 75, colorVar: "--yellow" },
  { label: "Strong (76–100)", min: 76, max: 100, colorVar: "--green" }
];

export function withinRange(item, days) {
  const d = parseSheetDate(item.dateTime);
  if (!d) return false;
  return Date.now() - d.getTime() <= Number(days) * 86400000;
}

function average(values) {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, n) => sum + n, 0) / values.length);
}

function scoresOf(items, field) {
  return items
    .filter((it) => it[field] !== "" && it[field] != null)
    .map((it) => clampScore(it[field]));
}

export function headline(items) {
  const dates = items.map((it) => parseSheetDate(it.dateTime)).filter(Boolean);
  const days = Math.max(1, Math.ceil((Date.now() - Math.min(...dates.map((d) => d.getTime()))) / 86400000));
  return {
    total: items.length,
    companies: new Set(items.map((it) => String(it.companyName || "").trim().toLowerCase()).filter(Boolean)).size,
    avgAts: average(scoresOf(items, "atsScore")),
    avgChance: average(scoresOf(items, "interviewChance")),
    perWeek: dates.length === 0 ? 0 : Math.round((items.length / days) * 7 * 10) / 10
  };
}

export function pipelineByStatus(items, orderedStatuses) {
  const counts = new Map(orderedStatuses.map((s) => [s, 0]));
  items.forEach((it) => {
    const status = String(it.status || "Pending").trim() || "Pending";
    counts.set(status, (counts.get(status) || 0) + 1);
  });

  return [...counts.entries()].map(([status, count]) => ({
    status,
    count,
    pct: items.length > 0 ? Math.round((count / items.length) * 100) : 0,
    avgAts: average(scoresOf(items.filter((it) => (it.status || "Pending") === status), "atsScore"))
  }));
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export function activityOverTime(items, rangeDays) {
  const days = Number(rangeDays);
  const byDay = days <= 14;
  const startOf = byDay ? startOfDay : startOfWeek;
  const stepDays = byDay ? 1 : 7;

  const latest = startOf(new Date());
  const keys = [];
  for (let cursor = new Date(latest); keys.length * stepDays < days; cursor.setDate(cursor.getDate() - stepDays)) {
    keys.unshift(new Date(cursor));
  }

  const counts = new Map(keys.map((d) => [d.getTime(), 0]));
  items.forEach((it) => {
    const d = parseSheetDate(it.dateTime);
    if (!d) return;
    const key = startOf(d).getTime();
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  });

  const labelOpts = byDay ? { weekday: "narrow" } : { month: "short", day: "numeric" };
  return keys.map((d) => ({
    label: d.toLocaleDateString(undefined, labelOpts),
    full: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    count: counts.get(d.getTime())
  }));
}

export function scoreBands(items, field) {
  const scores = scoresOf(items, field);
  return SCORE_BANDS.map((band) => {
    const count = scores.filter((n) => n >= band.min && n <= band.max).length;
    return {
      ...band,
      count,
      pct: scores.length > 0 ? Math.round((count / scores.length) * 100) : 0
    };
  });
}

export function scoreScatter(items) {
  return items
    .filter((it) => it.atsScore !== "" && it.atsScore != null && it.interviewChance !== "" && it.interviewChance != null)
    .map((it) => ({
      ats: clampScore(it.atsScore),
      chance: clampScore(it.interviewChance),
      label: `${it.jobTitle || "Untitled"} — ${it.companyName || "Unknown"}`,
      company: String(it.companyName || "").trim(),
      status: String(it.status || "Pending").trim() || "Pending"
    }));
}

function frequency(values, limit) {
  const counts = new Map();
  values.forEach((raw) => {
    const key = raw.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { label: raw, count: 1 });
  });
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}

export function topMissingSkills(items, limit = 8) {
  return frequency(items.flatMap((it) => splitCsv(it.missingSkills)), limit);
}

export function topTitles(items, limit = 6) {
  return frequency(items.map((it) => String(it.jobTitle || "").trim()).filter(Boolean), limit);
}

export function topCompanies(items, limit = 5) {
  return frequency(items.map((it) => String(it.companyName || "").trim()).filter(Boolean), limit);
}
