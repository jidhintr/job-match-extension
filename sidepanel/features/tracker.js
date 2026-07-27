import { state } from "../state/store.js";
import { fetchFromSheets, postToSheets } from "../services/sheetsSync.js";
import { createStatusLine } from "../ui/statusLine.js";
import {
  trackerStatusFilter,
  trackerSortSelect,
  refreshTrackerBtn,
  trackerStatusLine,
  trackerList,
  trackerEmptyState
} from "../ui/dom.js";

const setTrackerStatus = createStatusLine(trackerStatusLine);

const STATUS_ENUM = ["New", "Pending", "Applied", "Rejected"];

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Stored dateTime is "YYYY-MM-DD HH:mm:ss" captured from the saver's device clock in UTC
// (new Date().toISOString()) — reinterpreting it as UTC and letting toLocaleString() convert
// back reproduces the original click moment in whichever device's local time is viewing it.
function formatDateTime(value) {
  if (!value) return "—";
  const asUtc = `${String(value).replace(" ", "T")}Z`;
  const d = new Date(asUtc);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// GET is a plain fetch against the Apps Script webhook — application logic only, never an AI call.
async function loadTrackerData({ force = false } = {}) {
  if (!state.settings.sheetsWebhookUrl) {
    setTrackerStatus("Add a Google Sheets Webhook URL in Settings first.", "err");
    return;
  }
  if (state.tracker.loading) return;
  if (state.tracker.loaded && !force) {
    renderTrackerList();
    return;
  }

  state.tracker.loading = true;
  refreshTrackerBtn.disabled = true;
  setTrackerStatus("Loading from Google Sheets...");

  try {
    const items = await fetchFromSheets(state.settings.sheetsWebhookUrl);
    state.tracker.items = items;
    state.tracker.loaded = true;
    renderTrackerList();
    setTrackerStatus(`Loaded ${items.length} tracked job${items.length === 1 ? "" : "s"}.`, "ok");
  } catch (err) {
    console.error(err);
    setTrackerStatus(err.message || "Could not load from Sheets.", "err");
  } finally {
    state.tracker.loading = false;
    refreshTrackerBtn.disabled = false;
  }
}

// Called on first tab activation only — cached data renders instantly on later visits,
// the explicit Refresh button is the only thing that re-fetches.
export function loadTrackerIfNeeded() {
  loadTrackerData({ force: false });
}

function sortItems(items) {
  const [key, dir] = state.tracker.sortBy.split("-");
  const fieldBySortKey = { date: "dateTime", company: "companyName", title: "jobTitle", status: "status" };
  const field = fieldBySortKey[key] || "dateTime";
  const sorted = [...items].sort((a, b) => String(a[field] || "").localeCompare(String(b[field] || "")));
  return dir === "desc" ? sorted.reverse() : sorted;
}

function filteredSortedItems() {
  const filtered = state.tracker.statusFilter === "All"
    ? state.tracker.items
    : state.tracker.items.filter((it) => (it.status || "Pending") === state.tracker.statusFilter);
  return sortItems(filtered);
}

async function changeStatus(item, newStatus, selectEl) {
  const previous = item.status;
  item.status = newStatus;
  selectEl.className = `tracker-status-select status-${newStatus.toLowerCase()}`;
  try {
    await postToSheets(state.settings.sheetsWebhookUrl, {
      type: "update_status",
      jobUrl: item.jobUrl,
      status: newStatus
    });
    setTrackerStatus(`Status updated to ${newStatus}.`, "ok");
  } catch (err) {
    console.error(err);
    item.status = previous;
    selectEl.value = previous;
    selectEl.className = `tracker-status-select status-${previous.toLowerCase()}`;
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

  const statusValue = STATUS_ENUM.includes(item.status) ? item.status : "Pending";
  const statusSelect = document.createElement("select");
  statusSelect.className = `tracker-status-select status-${statusValue.toLowerCase()}`;
  STATUS_ENUM.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    if (s === statusValue) opt.selected = true;
    statusSelect.appendChild(opt);
  });
  statusSelect.addEventListener("change", () => changeStatus(item, statusSelect.value, statusSelect));

  header.append(titleGroup, statusSelect);

  const meta = document.createElement("div");
  meta.className = "tracker-card-meta";
  const scoreParts = [];
  if (item.atsScore !== "" && item.atsScore != null) scoreParts.push(`ATS ${item.atsScore}%`);
  if (item.interviewChance !== "" && item.interviewChance != null) scoreParts.push(`Chance ${item.interviewChance}%`);
  meta.textContent = [formatDateTime(item.dateTime), ...scoreParts].join(" · ");

  card.append(header, meta);

  appendTagRow(card, "Missing Skills", [{ tags: splitTags(item.missingSkills), pillClass: "missing", prefix: "" }]);
  appendTagRow(card, "Resume Optimization", [
    { tags: splitTags(item.addSkills), pillClass: "add", prefix: "+" },
    { tags: splitTags(item.removeSkills), pillClass: "remove", prefix: "−" }
  ]);

  return card;
}

function renderTrackerList() {
  const items = filteredSortedItems();
  trackerList.innerHTML = "";
  trackerEmptyState.classList.toggle("hidden", state.tracker.items.length > 0);

  if (state.tracker.items.length > 0 && items.length === 0) {
    const none = document.createElement("p");
    none.className = "tracker-no-match";
    none.textContent = "No jobs match this filter.";
    trackerList.appendChild(none);
    return;
  }

  items.forEach((item) => trackerList.appendChild(buildCard(item)));
}

trackerStatusFilter.addEventListener("change", () => {
  state.tracker.statusFilter = trackerStatusFilter.value;
  renderTrackerList();
});

trackerSortSelect.addEventListener("change", () => {
  state.tracker.sortBy = trackerSortSelect.value;
  renderTrackerList();
});

refreshTrackerBtn.addEventListener("click", () => loadTrackerData({ force: true }));
