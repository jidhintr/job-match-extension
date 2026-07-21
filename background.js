const PANEL_PATH = "sidepanel/sidepanel.html";
const SESSION_KEY_PREFIX = "jobMatchState:";

// Binding a tabId to the panel path (even the same path used as the default)
// gives that tab its own independent side panel document/instance instead of
// sharing the one global panel across every tab in the window. This is what
// lets you analyze different jobs on different tabs without one clobbering
// the other, and run analyses on two tabs at the same time.
async function enablePanelForTab(tabId) {
  try {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
  } catch {
    // Tabs that can't host extension UI (chrome://, the Web Store, etc.) — ignore.
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => (tab.id ? enablePanelForTab(tab.id) : null)));
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) enablePanelForTab(tab.id);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`${SESSION_KEY_PREFIX}${tabId}`).catch(() => {});
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("Job Match AI: failed to set panel behavior", err));
