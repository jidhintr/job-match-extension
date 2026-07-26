const PANEL_PATH = "sidepanel/sidepanel.html";
const SESSION_KEY_PREFIX = "jobMatchState:";

async function enablePanelForTab(tabId) {
  try {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
  } catch {
    
  }
}

function disablePanelByDefault() {
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
}
chrome.runtime.onInstalled.addListener(disablePanelByDefault);
chrome.runtime.onStartup.addListener(disablePanelByDefault);

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await enablePanelForTab(tab.id);
  chrome.sidePanel.open({ tabId: tab.id }).catch((err) => console.error("MatchResumer: failed to open panel", err));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`${SESSION_KEY_PREFIX}${tabId}`).catch(() => {});
});
