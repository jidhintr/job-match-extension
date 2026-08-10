import { state } from "../state/store.js";
import { fetchFromSheets, postToSheets } from "../services/sheetsSync.js";
import { createStatusLine } from "../ui/statusLine.js";
import { splitCsv, parseSheetDate, safeHttpUrl, withinDays } from "../ui/format.js";
import {
  ANALYSED_STATUS,
  DEFAULT_TRACKER_STATUS_OPTIONS,
  MAX_TRACKER_STATUSES,
  sanitizeTrackerStatusOptions
} from "../../shared/settingsSchema.js";
export { ANALYSED_STATUS, MAX_TRACKER_STATUSES, sanitizeTrackerStatusOptions };
import { readTrackerCache, writeTrackerCache, clearTrackerCache, isCacheFresh, cacheAgeLabel } from "../services/trackerCache.js";
import {
  trackerSearchInput,
  trackerStatusFilter,
  trackerRangeSelect,
  trackerSortSelect,
  refreshTrackerBtn,
  trackerStatusLine,
  trackerList,
  trackerEmptyState
} from "../ui/dom.js";

const setTrackerStatus = createStatusLine(trackerStatusLine);

const ANALYSED_STATUS_COLOR = "#ec4899";
const NEUTRAL_STATUS_COLOR = "#8b90a0";

const PROGRESS_GREENS = ["#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#16a34a", "#0f9d58"];

const PROGRESS_KEYWORDS = [
  "recruiter", "screen", "call", "interview", "round", "tech", "coding", "assessment",
  "hiring manager", "engineering manager", "system design", "architect", "panel",
  "onsite", "on-site", "final", "offer", "hr"
];

const STATUS_COLOR_RULES = [
  { match: ["kee"], color: "#fbd38d" },
  { match: ["ignore", "skip", "archiv", "withdraw", "not interested", "closed"], color: NEUTRAL_STATUS_COLOR },
  { match: ["reject", "declin", "ghost", "no response", "unsuccessful"], color: "#e5484d" },
  { match: ["pending", "waiting", "on hold", "follow up", "in review"], color: "#e0b341" },
  { match: ["applied", "apply", "submitted"], color: "#4c8dff" }
];

export function configuredStatuses() {
  return state.settings.trackerStatusOptions && state.settings.trackerStatusOptions.length > 0
    ? state.settings.trackerStatusOptions
    : DEFAULT_TRACKER_STATUS_OPTIONS;
}

function statusesInSheet() {
  const seen = [];
  state.tracker.items.forEach((it) => {
    const label = String(it.status || "").trim();
    if (label && !seen.includes(label)) seen.push(label);
  });
  return seen.sort((a, b) => a.localeCompare(b));
}

function withSheetStatuses(base) {
  const ordered = [ANALYSED_STATUS, ...base.filter((s) => s !== ANALYSED_STATUS)];
  statusesInSheet().forEach((s) => {
    if (!ordered.includes(s)) ordered.push(s);
  });
  return ordered;
}

export function allStatuses() {
  return withSheetStatuses(configuredStatuses().map((s) => s.label));
}

export function enabledStatuses() {
  const enabled = configuredStatuses().filter((s) => s.enabled).map((s) => s.label);
  return withSheetStatuses(enabled.length > 0 ? enabled : configuredStatuses().map((s) => s.label));
}

function statusOptionsForItem(currentStatus) {
  const enabled = enabledStatuses();
  return enabled.includes(currentStatus) ? enabled : [...enabled, currentStatus];
}

function ruleColorFor(label) {
  const key = String(label || "").trim().toLowerCase();
  const rule = STATUS_COLOR_RULES.find((r) => r.match.some((m) => key.includes(m)));
  return rule ? rule.color : null;
}

function isProgressStatus(label) {
  const key = String(label || "").trim().toLowerCase();
  return !ruleColorFor(key) && PROGRESS_KEYWORDS.some((k) => key.includes(k));
}

function progressStatuses() {
  return allStatuses().filter((s) => s !== ANALYSED_STATUS && isProgressStatus(s));
}

export function colorForStatus(label) {
  if (label === ANALYSED_STATUS) return ANALYSED_STATUS_COLOR;
  const ruleColor = ruleColorFor(label);
  if (ruleColor) return ruleColor;
  const idx = progressStatuses().indexOf(label);
  return idx >= 0 ? PROGRESS_GREENS[idx % PROGRESS_GREENS.length] : NEUTRAL_STATUS_COLOR;
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function applyStatusColor(item, selectEl, cardEl) {
  const color = colorForStatus(item.status);
  selectEl.style.backgroundColor = hexToRgba(color, 0.2);
  selectEl.style.color = color;
  cardEl.style.setProperty("--rb-accent", color);
  cardEl.style.setProperty("--rb-bg", hexToRgba(color, 0.09));
  cardEl.style.setProperty("--rb-border", hexToRgba(color, 0.3));
}

function renderStatusFilterOptions() {
  const enabled = enabledStatuses();
  const previous = trackerStatusFilter.value || state.tracker.statusFilter;
  trackerStatusFilter.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = "All";
  allOpt.textContent = "All Statuses";
  trackerStatusFilter.appendChild(allOpt);

  enabled.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    trackerStatusFilter.appendChild(opt);
  });

  state.tracker.statusFilter = previous === "All" || enabled.includes(previous) ? previous : "All";
  trackerStatusFilter.value = state.tracker.statusFilter;
}

export function refreshTrackerStatusOptions() {
  renderStatusFilterOptions();
  renderTrackerList();
}

window.addEventListener("tracker:refresh", () => {
  refreshTrackerFromSheet().catch((err) => {
    console.error(err);
    setTrackerStatus(err.message || "Could not refresh from Sheets.", "err");
  });
});

export async function refreshTrackerFromSheet() {
  await clearTrackerCache();
  state.tracker.loaded = false;
  state.tracker.cachedAt = null;

  const items = await ensureTrackerItems({ force: true });
  refreshTrackerStatusOptions();
  window.dispatchEvent(new CustomEvent("tracker:updated", { detail: { count: items.length } }));
  return items;
}

export function warmTrackerCache() {
  if (!state.settings.sheetsWebhookUrl || state.tracker.loaded) return;
  ensureTrackerItems().then(refreshTrackerStatusOptions).catch((err) => console.error("Tracker cache warm-up failed.", err));
}

function formatDateTime(value) {
  const d = parseSheetDate(value);
  if (!d) return value ? String(value) : "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function loadTrackerData({ force = false } = {}) {
  if (state.tracker.loaded && !force) {
    refreshTrackerStatusOptions();
    return;
  }

  refreshTrackerBtn.disabled = true;
  if (force) setTrackerStatus("Refreshing from Google Sheets...");

  try {
    await ensureTrackerItems({ force });
    refreshTrackerStatusOptions();
  } catch (err) {
    console.error(err);
    setTrackerStatus(err.message || "Could not load from Sheets.", "err");
  } finally {
    refreshTrackerBtn.disabled = false;
  }
}

export function loadTrackerIfNeeded() {
  loadTrackerData({ force: false });
}

let loadQueue = Promise.resolve();

export function ensureTrackerItems({ force = false } = {}) {
  if (state.tracker.loaded && !force) return Promise.resolve(state.tracker.items);
  const run = loadQueue.then(() => loadTrackerItems(force), () => loadTrackerItems(force));
  loadQueue = run.catch(() => {});
  return run;
}

async function loadTrackerItems(force) {
  if (state.tracker.loaded && !force) return state.tracker.items;

  if (!force) {
    const cache = await readTrackerCache();
    if (isCacheFresh(cache, state.settings.cacheTtlHours)) {
      state.tracker.items = cache.items;
      state.tracker.cachedAt = cache.savedAt;
      state.tracker.loaded = true;
      return state.tracker.items;
    }
  }

  if (!state.settings.sheetsWebhookUrl) throw new Error("Add a Google Sheets Webhook URL in Settings first.");

  try {
    state.tracker.loading = true;
    state.tracker.items = await fetchFromSheets(state.settings.sheetsWebhookUrl);
    state.tracker.cachedAt = await writeTrackerCache(state.tracker.items);
    state.tracker.loaded = true;
  } finally {
    state.tracker.loading = false;
  }
  return state.tracker.items;
}

export function trackerSourceLabel() {
  if (!state.tracker.cachedAt) return "";
  return ` Cached ${cacheAgeLabel(state.tracker.cachedAt)}.`;
}

export async function findSavedJobByUrl(jobUrl) {
  if (!jobUrl || !state.settings.sheetsWebhookUrl) return null;
  try {
    const items = await ensureTrackerItems();
    return items.find((it) => it.jobUrl === jobUrl) || null;
  } catch (err) {
    console.error("Could not check Sheets for an existing analysis.", err);
    return null;
  }
}

const TEXT_SORT_FIELDS = { date: "dateTime", company: "companyName", title: "jobTitle", status: "status" };
const SCORE_SORT_FIELDS = { ats: "atsScore", chance: "interviewChance" };

function scoreValue(raw) {
  if (raw === "" || raw == null) return -1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : -1;
}

function sortItems(items) {
  const [key, dir] = state.tracker.sortBy.split("-");
  const scoreField = SCORE_SORT_FIELDS[key];
  const sorted = [...items];

  if (scoreField) {
    sorted.sort((a, b) => scoreValue(a[scoreField]) - scoreValue(b[scoreField]));
  } else {
    const field = TEXT_SORT_FIELDS[key] || "dateTime";
    sorted.sort((a, b) => String(a[field] || "").localeCompare(String(b[field] || "")));
  }

  return dir === "desc" ? sorted.reverse() : sorted;
}

function matchesSearch(item, query) {
  if (!query) return true;
  return `${item.companyName || ""} ${item.jobTitle || ""}`.toLowerCase().includes(query);
}

function filteredSortedItems() {
  const query = state.tracker.searchQuery.trim().toLowerCase();
  const filtered = state.tracker.items.filter(
    (it) =>
      withinDays(it.dateTime, state.tracker.range) &&
      (state.tracker.statusFilter === "All" || (it.status || "Pending") === state.tracker.statusFilter) &&
      matchesSearch(it, query)
  );
  return sortItems(filtered);
}

async function changeStatus(item, newStatus, selectEl, cardEl) {
  const previous = item.status;
  item.status = newStatus;
  applyStatusColor(item, selectEl, cardEl);
  try {
    await postToSheets(state.settings.sheetsWebhookUrl, {
      type: "update_status",
      jobUrl: item.jobUrl,
      status: newStatus
    });
    await writeTrackerCache(state.tracker.items, state.tracker.cachedAt || Date.now());
    setTrackerStatus(`Status updated to ${newStatus}.`, "ok");
  } catch (err) {
    console.error(err);
    item.status = previous;
    selectEl.value = previous;
    applyStatusColor(item, selectEl, cardEl);
    setTrackerStatus("Could not update status — check the webhook URL.", "err");
  }
}

function appendTagRow(card, label, groups) {
  const hasAny = groups.some((g) => g.tags.length > 0);
  if (!hasAny) return;
  const row = document.createElement("div");
  row.className = "pill-row tracker-tag-row";
  const labelEl = document.createElement("span");
  labelEl.className = "tracker-tag-label";
  labelEl.textContent = label;
  row.appendChild(labelEl);
  groups.forEach(({ tags, pillClass, prefix }) => {
    tags.forEach((s) => {
      const pill = document.createElement("span");
      pill.className = `pill ${pillClass}`;
      pill.textContent = prefix ? `${prefix} ${s}` : s;
      row.appendChild(pill);
    });
  });
  card.appendChild(row);
}

function buildCard(item) {
  const statusValue = item.status && String(item.status).trim() ? String(item.status).trim() : "Pending";
  item.status = statusValue;

  const card = document.createElement("div");
  card.className = "prep-area-card tracker-card";

  const header = document.createElement("div");
  header.className = "tracker-card-header";

  const titleGroup = document.createElement("div");
  titleGroup.className = "tracker-card-title-group";

  const titleLink = document.createElement("a");
  titleLink.className = "tracker-card-title";
  titleLink.textContent = item.jobTitle || "(untitled role)";
  titleLink.href = safeHttpUrl(item.jobUrl) || "#";
  titleLink.target = "_blank";
  titleLink.rel = "noopener noreferrer";

  const companyLine = document.createElement("div");
  companyLine.className = "tracker-card-company";
  companyLine.textContent = item.companyName || "Unknown company";

  titleGroup.append(titleLink, companyLine);

  const statusSelect = document.createElement("select");
  statusSelect.className = "tracker-status-select";
  statusOptionsForItem(statusValue).forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    if (s === statusValue) opt.selected = true;
    statusSelect.appendChild(opt);
  });
  applyStatusColor(item, statusSelect, card);
  statusSelect.addEventListener("change", () => changeStatus(item, statusSelect.value, statusSelect, card));

  header.append(titleGroup, statusSelect);

  const meta = document.createElement("div");
  meta.className = "tracker-card-meta";
  const scoreParts = [];
  if (item.atsScore !== "" && item.atsScore != null) scoreParts.push(`ATS ${item.atsScore}%`);
  if (item.interviewChance !== "" && item.interviewChance != null) scoreParts.push(`Chance ${item.interviewChance}%`);
  meta.textContent = [formatDateTime(item.dateTime), ...scoreParts].join(" · ");

  card.append(header, meta);

  appendTagRow(card, "Missing Skills", [{ tags: splitCsv(item.missingSkills), pillClass: "missing", prefix: "" }]);
  appendTagRow(card, "Resume Optimization", [
    { tags: splitCsv(item.addSkills), pillClass: "add", prefix: "+" },
    { tags: splitCsv(item.removeSkills), pillClass: "remove", prefix: "−" }
  ]);

  return card;
}

function renderTrackerCount(shown, total) {
  if (total === 0) {
    setTrackerStatus("");
    return;
  }
  const label = shown < total
    ? `${shown}/${total} jobs match`
    : `${total} tracked job${total === 1 ? "" : "s"}`;
  setTrackerStatus(`${label}.${trackerSourceLabel()}`, "ok");
}

function renderTrackerList() {
  const items = filteredSortedItems();
  const total = state.tracker.items.length;

  trackerList.innerHTML = "";
  trackerEmptyState.classList.toggle("hidden", total > 0);
  renderTrackerCount(items.length, total);

  if (total > 0 && items.length === 0) {
    const none = document.createElement("p");
    none.className = "tracker-no-match";
    none.textContent = "No jobs match this filter.";
    trackerList.appendChild(none);
    return;
  }

  items.forEach((item) => trackerList.appendChild(buildCard(item)));
}

window.addEventListener("app:navigate", (e) => {
  if (e.detail?.tab !== "tracker") return;

  const status = e.detail.status || "All";
  if (![...trackerStatusFilter.options].some((o) => o.value === status)) {
    const opt = document.createElement("option");
    opt.value = status;
    opt.textContent = status;
    trackerStatusFilter.appendChild(opt);
  }

  state.tracker.statusFilter = status;
  state.tracker.searchQuery = e.detail.search || "";
  state.tracker.range = trackerRangeSelect.options[0].value;
  trackerStatusFilter.value = status;
  trackerSearchInput.value = state.tracker.searchQuery;
  trackerRangeSelect.value = state.tracker.range;
  renderTrackerList();
});

trackerSearchInput.addEventListener("input", () => {
  state.tracker.searchQuery = trackerSearchInput.value;
  renderTrackerList();
});

trackerStatusFilter.addEventListener("change", () => {
  state.tracker.statusFilter = trackerStatusFilter.value;
  renderTrackerList();
});

trackerRangeSelect.addEventListener("change", () => {
  state.tracker.range = trackerRangeSelect.value;
  renderTrackerList();
});

trackerSortSelect.addEventListener("change", () => {
  state.tracker.sortBy = trackerSortSelect.value;
  renderTrackerList();
});

refreshTrackerBtn.addEventListener("click", () => loadTrackerData({ force: true }));
