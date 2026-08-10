const TAB_STATE_KEY_PREFIX = "jobMatchState:";

export async function getTabState(tabId) {
  if (tabId == null) return null;
  const key = TAB_STATE_KEY_PREFIX + tabId;
  const stored = await chrome.storage.session.get(key);
  return stored[key] || null;
}

export async function setTabState(tabId, data) {
  if (tabId == null) return;
  const key = TAB_STATE_KEY_PREFIX + tabId;
  await chrome.storage.session.set({ [key]: data });
}

export async function getSettings() {
  return chrome.storage.local.get([
    "geminiApiKey",
    "masterResume",
    "sheetsWebhookUrl",
    "tavilyKey",
    "deepseekKey",
    "deepseekModel",
    "openaiKey",
    "openaiModel",
    "perplexityKey",
    "perplexityModel",
    "prepSourceSelection",
    "visibleTabs",
    "resumeSectionOrder",
    "customInstructions",
    "trackerStatusOptions",
    "cacheTtlHours",
    "guardMinAts",
    "guardMinChance",
    "guardKeywords"
  ]);
}

export function setPrepSourceSelection(prepSourceSelection) {
  return chrome.storage.local.set({ prepSourceSelection });
}

export function setMasterResume(value) {
  return chrome.storage.local.set({ masterResume: value });
}

export function setPrepJobState(prepJobUrl, data) {
  return chrome.storage.session.set({ [prepJobUrl]: data });
}

export function onSettingsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    callback(changes);
  });
}
