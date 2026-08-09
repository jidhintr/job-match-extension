import { state } from "../state/store.js";
import { fetchFromSheets, postToSheets } from "../services/sheetsSync.js";
import { createStatusLine } from "../ui/statusLine.js";
import { splitCsv, parseSheetDate } from "../ui/format.js";
import { withinRange } from "./kpiMetrics.js";
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

// Default seed only — the actual set is fully user-editable via Settings > Tracker Statuses
// (rename, enable/disable, add up to MAX_TRACKER_STATUSES). google-apps-script.js no longer
// enforces a fixed enum, so any label configured here is valid to send/store as-is.
export const MAX_TRACKER_STATUSES = 5;
export const DEFAULT_TRACKER_STATUS_OPTIONS = [
  { label: "New", enabled: true },
  { label: "Pending", enabled: true },
  { label: "Applied", enabled: true },
  { label: "Rejected", enabled: true }
];

// Reserved system status. The matcher stamps it on every row it auto-saves the moment an analysis
// finishes, so it must always be filterable and selectable regardless of what the user configured
// in Settings — it is deliberately not part of the editable list and doesn't count toward the max.
export const ANALYSED_STATUS = "Analysed";
const ANALYSED_STATUS_COLOR = "#ec4899";

// Colors are assigned by position in the configured list, not by name — that's what lets a
// renamed status ("Open" instead of "New") keep a stable, distinguishing color.
const STATUS_COLOR_PALETTE = ["#4c8dff", "#d99a3d", "#34c07b", "#e5484d", "#8b5cf6"];
const UNKNOWN_STATUS_COLOR = "#8b90a0";

export function sanitizeTrackerStatusOptions(saved) {
  if (!Array.isArray(saved) || saved.length === 0) return DEFAULT_TRACKER_STATUS_OPTIONS.map((s) => ({ ...s }));
  const cleaned = saved
    .filter((s) => s && typeof s.label === "string" && s.label.trim())
    .filter((s) => s.label.trim().toLowerCase() !== ANALYSED_STATUS.toLowerCase())
    .slice(0, MAX_TRACKER_STATUSES)
    .map((s) => ({ label: s.label.trim(), enabled: s.enabled !== false }));
  return cleaned.length > 0 ? cleaned : DEFAULT_TRACKER_STATUS_OPTIONS.map((s) => ({ ...s }));
}

export function configuredStatuses() {
  return state.settings.trackerStatusOptions && state.settings.trackerStatusOptions.length > 0
    ? state.settings.trackerStatusOptions
    : DEFAULT_TRACKER_STATUS_OPTIONS;
}

export function enabledStatuses() {
  const enabled = configuredStatuses().filter((s) => s.enabled).map((s) => s.label);
  const base = enabled.length > 0 ? enabled : configuredStatuses().map((s) => s.label);
  return [ANALYSED_STATUS, ...base.filter((s) => s !== ANALYSED_STATUS)];
}

// A card's own current status must always be selectable even if the user later disabled or
// renamed it in Settings — otherwise changing any other card's status would silently reset this one.
function statusOptionsForItem(currentStatus) {
  const enabled = enabledStatuses();
  return enabled.includes(currentStatus) ? enabled : [...enabled, currentStatus];
}

export function colorForStatus(label) {
  if (label === ANALYSED_STATUS) return ANALYSED_STATUS_COLOR;
  const idx = configuredStatuses().findIndex((s) => s.label === label);
  return idx >= 0 ? STATUS_COLOR_PALETTE[idx % STATUS_COLOR_PALETTE.length] : UNKNOWN_STATUS_COLOR;
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

// Called on init and whenever Settings > Tracker Statuses changes.
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
  if (state.tracker.loading) return state.tracker.items;

  await clearTrackerCache();
  state.tracker.loaded = false;
  state.tracker.cachedAt = null;

  const items = await ensureTrackerItems({ force: true });
  renderTrackerList();
  window.dispatchEvent(new CustomEvent("tracker:updated", { detail: { count: items.length } }));
  return items;
}

export function warmTrackerCache() {
  if (!state.settings.sheetsWebhookUrl || state.tracker.loaded) return;
  ensureTrackerItems().then(renderTrackerList).catch((err) => console.error("Tracker cache warm-up failed.", err));
}

function formatDateTime(value) {
  const d = parseSheetDate(value);
  if (!d) return value ? String(value) : "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// GET is a plain fetch against the Apps Script webhook — application logic only, never an AI call.
async function loadTrackerData({ force = false } = {}) {
  if (state.tracker.loading) return;
  if (state.tracker.loaded && !force) {
    renderTrackerList();
    return;
  }

  refreshTrackerBtn.disabled = true;
  if (force) setTrackerStatus("Refreshing from Google Sheets...");

  try {
    await ensureTrackerItems({ force });
    renderTrackerList();
  } catch (err) {
    console.error(err);
    setTrackerStatus(err.message || "Could not load from Sheets.", "err");
  } finally {
    refreshTrackerBtn.disabled = false;
  }
}

// Renders instantly from whatever is already cached. The sheet is only re-read when the cache has
// expired, the Refresh button is pressed, or an analysis/scan save invalidates it.
export function loadTrackerIfNeeded() {
  loadTrackerData({ force: false });
}

export async function ensureTrackerItems({ force = false } = {}) {
  if (state.tracker.loaded && !force) return state.tracker.items;
  if (state.tracker.loading) return state.tracker.items;

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

// Used by matcher.js/bootstrap.js to check whether a job was already analyzed and saved (from
// this device or another one) before spending any Gemini tokens on it again.
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

function sortItems(items) {
  const [key, dir] = state.tracker.sortBy.split("-");
  const fieldBySortKey = { date: "dateTime", company: "companyName", title: "jobTitle", status: "status" };
  const field = fieldBySortKey[key] || "dateTime";
  const sorted = [...items].sort((a, b) => String(a[field] || "").localeCompare(String(b[field] || "")));
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
      withinRange(it, state.tracker.range) &&
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
  titleLink.href = item.jobUrl || "#";
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
