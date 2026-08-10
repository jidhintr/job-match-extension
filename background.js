const SESSION_KEY_PREFIX = "jobMatchState:";
const PANEL_PATH = "sidepanel/sidepanel.html";

function disablePanelByDefault() {
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
}
chrome.runtime.onInstalled.addListener(disablePanelByDefault);
chrome.runtime.onStartup.addListener(disablePanelByDefault);

const openPanels = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("panel:")) return;
  const tabId = Number(port.name.slice("panel:".length));
  if (!Number.isFinite(tabId)) return;
  openPanels.add(tabId);
  port.onDisconnect.addListener(() => openPanels.delete(tabId));
});

function openForTab(tabId) {
  chrome.sidePanel.setOptions({ tabId, path: `${PANEL_PATH}?tabId=${tabId}`, enabled: true }).catch(() => {});
  chrome.sidePanel.open({ tabId }).catch((err) => {
    console.error("MatchResumer: failed to open panel", err);
  });
}

function closeForTab(tabId) {
  openPanels.delete(tabId);
  chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
}

function togglePanelForTab(tabId) {
  if (openPanels.has(tabId)) closeForTab(tabId);
  else openForTab(tabId);
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  togglePanelForTab(tab.id);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-side-panel") {
    if (!tab?.id) return;
    togglePanelForTab(tab.id);
  } else if (command === "analyze-resume") {
    if (!tab?.id) return;
    chrome.runtime.sendMessage({ type: "JOB_MATCH_SHORTCUT_ANALYZE", tabId: tab.id }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  openPanels.delete(tabId);
  chrome.storage.session.remove(`${SESSION_KEY_PREFIX}${tabId}`).catch(() => {});
});
