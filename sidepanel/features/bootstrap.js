import {
  getTabState,
  setTabState,
  getSettings,
  setPrepSourceSelection,
  setMasterResume,
  onSettingsChanged
} from "../services/storage.js";
import { state } from "../state/store.js";
import {
  setupBanner,
  setupBannerBtn,
  openOptionsBtn,
  analyzeBtn,
  reanalyzeBtn,
  saveSheetsBtn,
  uploadResumeBtn,
  resumeFileInput,
  resumeSourceLine,
  resumeSourceText,
  clearResumeOverrideBtn,
  statusLine,
  applyStatusLine,
  drawerToggle,
  drawerBody,
  drawerChevron,
  resumeQuickEdit,
  saveResumeQuickBtn,
  resumeSavedTag,
  tabButtons,
  tabViewsByName,
  tabButtonsByName,
  coverLetterBtn,
  checkSalaryBtn,
  scanAndFilterBtn,
  prepSourcePickerSummary,
  sourceCheckboxes
} from "../ui/dom.js";
import { createStatusLine } from "../ui/statusLine.js";
import { renderReport, sanitizeSectionOrder, applySectionVisibilityAndOrder, buildResultFromSheetItem } from "./matcher.js";
import { loadTrackerIfNeeded, refreshTrackerStatusOptions, sanitizeTrackerStatusOptions, findSavedJobByUrl } from "./tracker.js";

export function effectiveResume() {
  return state.tab.resumeOverride || state.settings.masterResume;
}

export function hasUsableResume() {
  return !!effectiveResume();
}

export const setStatus = createStatusLine(statusLine);
export const setApplyStatus = createStatusLine(applyStatusLine);

// background.js gives every http/https tab its own dedicated side panel document, with that tab's
// id baked into the URL as ?tabId=. Reading it here (rather than querying "the active tab") is
// what makes this document's identity fixed to its own tab regardless of which tab the user is
// currently looking at — required for concurrent, non-clobbering analyses across tabs.
function getScopedTabIdFromUrl() {
  const raw = new URLSearchParams(location.search).get("tabId");
  const id = raw != null ? Number(raw) : NaN;
  return Number.isFinite(id) ? id : null;
}

async function getActiveTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

async function restoreTabState() {
  // Fall back to an active-tab query only if this document was somehow opened without the
  // tabId query param (e.g. manually navigated to sidepanel.html).
  state.tab.currentTabId = getScopedTabIdFromUrl() ?? (await getActiveTabId());
  if (state.tab.currentTabId == null) return;

  const saved = await getTabState(state.tab.currentTabId);
  if (saved) {
    state.matcher.lastJobText = saved.jobText || "";
    state.matcher.lastJobUrl = saved.jobUrl || "";
    state.matcher.lastResult = saved.result || null;
    state.matcher.savedToSheets = !!saved.savedToSheets;
    state.tab.resumeOverride = saved.resumeOverride || null;
    state.tab.resumeFileName = saved.resumeFileName || "";
    refreshResumeSourceLine();
  }

  if (state.matcher.lastResult) {
    renderReport(state.matcher.lastResult);
    setStatus("Restored previous analysis for this tab.", "ok");
    reanalyzeBtn.disabled = !state.matcher.lastJobText;
  } else {
    // No session-cached analysis for this tab — e.g. the side panel or the tab itself was closed
    // and reopened, which gives this document a fresh tabId with nothing in session storage even
    // though chrome.storage.session hasn't actually expired. Before making the user re-run Gemini
    // on a job that's already saved (from this device or another), check the sheet by URL.
    await tryLoadSavedAnalysisForCurrentTab();
  }
  refreshSaveSheetsButton();
  refreshApplyButtons();
}

async function tryLoadSavedAnalysisForCurrentTab() {
  if (!state.settings.sheetsWebhookUrl) return;

  // Block Analyze for the whole duration of this check — otherwise a click landing mid-fetch
  // could kick off a real Gemini analysis (and re-enable it) right as this passive check was
  // about to find and show the already-saved summary for free.
  analyzeBtn.disabled = true;
  setStatus("Checking Google Sheets for a saved analysis...");

  try {
    const tab = await chrome.tabs.get(state.tab.currentTabId).catch(() => null);
    const url = tab?.url;
    if (!url || !/^https?:\/\//.test(url)) {
      setStatus("");
      return;
    }

    const saved = await findSavedJobByUrl(url);
    if (!saved) {
      setStatus("");
      return;
    }

    const result = buildResultFromSheetItem(saved);
    renderReport(result);
    state.matcher.lastResult = result;
    state.matcher.lastJobUrl = url;
    state.matcher.savedToSheets = true;
    setStatus("Loaded saved summary from Google Sheets (no tokens used) — click Analyze again for the full report.", "ok");
    await persistTabSessionState();
  } catch (err) {
    console.error("Could not check Sheets for an existing analysis.", err);
    setStatus("Could not check Google Sheets for a saved analysis.", "err");
  } finally {
    // Re-derive the real enabled/disabled state (API key/resume present, etc.) rather than just
    // flipping this back to enabled — refreshSetupBanner() runs right after restoreTabState()
    // returns in init(), but set it here too in case this ever gets called from elsewhere.
    refreshSetupBanner();
  }
}

export async function persistTabSessionState() {
  if (state.tab.currentTabId == null) return;
  await setTabState(state.tab.currentTabId, {
    result: state.matcher.lastResult,
    jobText: state.matcher.lastJobText,
    jobUrl: state.matcher.lastJobUrl,
    resumeOverride: state.tab.resumeOverride,
    resumeFileName: state.tab.resumeFileName,
    savedToSheets: state.matcher.savedToSheets
  });
}

export async function init() {
  const stored = await getSettings();
  state.settings.apiKey = stored.geminiApiKey || "";
  state.settings.masterResume = stored.masterResume || "";
  state.settings.sheetsWebhookUrl = stored.sheetsWebhookUrl || "";
  state.settings.tavilyKey = stored.tavilyKey || "";
  state.settings.deepseekKey = stored.deepseekKey || "";
  state.settings.deepseekModel = stored.deepseekModel || "deepseek-v4-flash";
  state.settings.openaiKey = stored.openaiKey || "";
  state.settings.openaiModel = stored.openaiModel || "gpt-5-mini";
  state.settings.perplexityKey = stored.perplexityKey || "";
  state.settings.perplexityModel = stored.perplexityModel || "sonar";
  state.settings.prepSourceSelection = { ...state.settings.prepSourceSelection, ...(stored.prepSourceSelection || {}) };
  applyTabVisibility(stored.visibleTabs);
  state.settings.resumeSectionOrder = sanitizeSectionOrder(stored.resumeSectionOrder);
  applySectionVisibilityAndOrder();
  if (stored.customInstructions) {
    state.settings.customInstructions = { ...state.settings.customInstructions, ...stored.customInstructions };
  }
  state.settings.trackerStatusOptions = sanitizeTrackerStatusOptions(stored.trackerStatusOptions);
  refreshTrackerStatusOptions();
  resumeQuickEdit.value = state.settings.masterResume;

  await restoreTabState();
  refreshSetupBanner();
  refreshSaveSheetsButton();
  refreshSourcePicker();
}

function refreshSourcePicker() {
  const keyBySource = {
    gemini: state.settings.apiKey,
    tavily: state.settings.tavilyKey,
    deepseek: state.settings.deepseekKey,
    openai: state.settings.openaiKey,
    perplexity: state.settings.perplexityKey
  };
  let activeCount = 0;
  for (const [source, checkbox] of Object.entries(sourceCheckboxes)) {
    if (!checkbox) continue;
    const hasKey = !!keyBySource[source];
    checkbox.checked = !!state.settings.prepSourceSelection[source];
    checkbox.disabled = !hasKey;
    checkbox.title = hasKey ? "" : "Add this provider's API key in Settings to enable it.";
    if (hasKey && checkbox.checked) activeCount++;
  }
  if (prepSourcePickerSummary) {
    prepSourcePickerSummary.textContent = `Scan Sources (${activeCount} selected)`;
  }
}

Object.entries(sourceCheckboxes).forEach(([source, checkbox]) => {
  checkbox?.addEventListener("change", () => {
    state.settings.prepSourceSelection = { ...state.settings.prepSourceSelection, [source]: checkbox.checked };
    setPrepSourceSelection(state.settings.prepSourceSelection);
    refreshSourcePicker();
  });
});

function refreshSetupBanner() {
  const missing = !state.settings.apiKey || !hasUsableResume();
  setupBanner.classList.toggle("hidden", !missing);
  analyzeBtn.disabled = missing;
  refreshScanButton();
}

function refreshResumeSourceLine() {
  if (state.tab.resumeOverride) {
    resumeSourceText.textContent = `Using uploaded resume for this tab: ${state.tab.resumeFileName}`;
    resumeSourceLine.classList.remove("hidden");
  } else {
    resumeSourceLine.classList.add("hidden");
  }
}

export function refreshSaveSheetsButton() {
  saveSheetsBtn.classList.remove("saved");
  if (!state.settings.sheetsWebhookUrl) {
    saveSheetsBtn.disabled = true;
    saveSheetsBtn.textContent = "💾 Save to Google Sheets";
    saveSheetsBtn.title = "Add a Google Sheets Webhook URL in Settings first.";
  } else if (!state.matcher.lastResult) {
    saveSheetsBtn.disabled = true;
    saveSheetsBtn.textContent = "💾 Save to Google Sheets";
    saveSheetsBtn.title = "Run an analysis first.";
  } else if (state.matcher.savedToSheets) {
    saveSheetsBtn.disabled = true;
    saveSheetsBtn.classList.add("saved");
    saveSheetsBtn.textContent = "✓ Saved to Google Sheets";
    saveSheetsBtn.title = "Already saved to Google Sheets.";
  } else {
    saveSheetsBtn.disabled = false;
    saveSheetsBtn.textContent = "💾 Save to Google Sheets";
    saveSheetsBtn.title = "";
  }
}

openOptionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
setupBannerBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

function activateTab(target) {
  tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === target));
  Object.entries(tabViewsByName).forEach(([name, view]) => view.classList.toggle("hidden", name !== target));
  if (target === "apply") refreshApplyButtons();
  if (target === "scan") refreshScanButton();
  if (target === "tracker") loadTrackerIfNeeded();
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

function applyTabVisibility(visibleTabs) {
  const visible = { scan: true, matcher: true, prep: true, apply: true, tracker: true, ...(visibleTabs || {}) };
  const anyVisible = Object.values(visible).some(Boolean);

  Object.entries(tabButtonsByName).forEach(([name, btn]) => {
    btn.classList.toggle("hidden", !anyVisible ? false : !visible[name]);
  });

  const activeBtn = Array.from(tabButtons).find((b) => b.classList.contains("active"));
  if (!activeBtn || activeBtn.classList.contains("hidden")) {
    const firstVisible = Array.from(tabButtons).find((b) => !b.classList.contains("hidden"));
    if (firstVisible) activateTab(firstVisible.dataset.tab);
  }
}

function refreshScanButton() {
  scanAndFilterBtn.disabled = !(state.settings.apiKey && effectiveResume());
  scanAndFilterBtn.title = scanAndFilterBtn.disabled ? "Add your Gemini API key and resume in Settings first." : "";
}

export function refreshApplyButtons() {
  const ready = !!(state.settings.apiKey && state.matcher.lastResult && state.matcher.lastJobText && effectiveResume());
  coverLetterBtn.disabled = !ready;
  checkSalaryBtn.disabled = !ready;
  const title = ready ? "" : "Run Resume Matcher analysis on this job first.";
  coverLetterBtn.title = title;
  checkSalaryBtn.title = title;
}

onSettingsChanged((changes) => {
  if (changes.geminiApiKey) state.settings.apiKey = changes.geminiApiKey.newValue || "";
  if (changes.sheetsWebhookUrl) state.settings.sheetsWebhookUrl = changes.sheetsWebhookUrl.newValue || "";
  if (changes.masterResume) {
    state.settings.masterResume = changes.masterResume.newValue || "";
    if (document.activeElement !== resumeQuickEdit) resumeQuickEdit.value = state.settings.masterResume;
  }
  if (changes.tavilyKey) state.settings.tavilyKey = changes.tavilyKey.newValue || "";
  if (changes.deepseekKey) state.settings.deepseekKey = changes.deepseekKey.newValue || "";
  if (changes.deepseekModel) state.settings.deepseekModel = changes.deepseekModel.newValue || "deepseek-v4-flash";
  if (changes.openaiKey) state.settings.openaiKey = changes.openaiKey.newValue || "";
  if (changes.openaiModel) state.settings.openaiModel = changes.openaiModel.newValue || "gpt-5-mini";
  if (changes.perplexityKey) state.settings.perplexityKey = changes.perplexityKey.newValue || "";
  if (changes.perplexityModel) state.settings.perplexityModel = changes.perplexityModel.newValue || "sonar";
  if (changes.visibleTabs) applyTabVisibility(changes.visibleTabs.newValue);
  if (changes.resumeSectionOrder) {
    state.settings.resumeSectionOrder = sanitizeSectionOrder(changes.resumeSectionOrder.newValue);
    applySectionVisibilityAndOrder();
  }
  if (changes.customInstructions) {
    state.settings.customInstructions = { ...state.settings.customInstructions, ...changes.customInstructions.newValue };
  }
  if (changes.trackerStatusOptions) {
    state.settings.trackerStatusOptions = sanitizeTrackerStatusOptions(changes.trackerStatusOptions.newValue);
    refreshTrackerStatusOptions();
  }
  refreshSetupBanner();
  refreshSaveSheetsButton();
  refreshSourcePicker();
});

drawerToggle.addEventListener("click", () => {
  const isHidden = drawerBody.classList.toggle("hidden");
  drawerChevron.textContent = isHidden ? "▾" : "▴";
});

saveResumeQuickBtn.addEventListener("click", async () => {
  const value = resumeQuickEdit.value.trim();
  if (!value) return;
  state.settings.masterResume = value;
  await setMasterResume(value);
  resumeSavedTag.classList.remove("hidden");
  setTimeout(() => resumeSavedTag.classList.add("hidden"), 1800);
  refreshSetupBanner();
});

uploadResumeBtn.addEventListener("click", () => resumeFileInput.click());

resumeFileInput.addEventListener("change", async () => {
  const file = resumeFileInput.files?.[0];
  resumeFileInput.value = "";
  if (!file) return;

  uploadResumeBtn.disabled = true;
  setStatus(`Reading ${file.name}...`);
  try {
    const { parseResumeFile } = await import(chrome.runtime.getURL("sidepanel/services/resumeParser.js"));
    const text = await parseResumeFile(file);
    state.tab.resumeOverride = text;
    state.tab.resumeFileName = file.name;
    await persistTabSessionState();
    refreshResumeSourceLine();
    refreshSetupBanner();
    setStatus(`Using ${file.name} as the resume for this tab only.`, "ok");
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Couldn't read that file.", "err");
  } finally {
    uploadResumeBtn.disabled = false;
  }
});

clearResumeOverrideBtn.addEventListener("click", async () => {
  state.tab.resumeOverride = null;
  state.tab.resumeFileName = "";
  await persistTabSessionState();
  refreshResumeSourceLine();
  refreshSetupBanner();
  setStatus("Switched back to your master resume for this tab.", "ok");
});
