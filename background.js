const SESSION_KEY_PREFIX = "jobMatchState:";
const PANEL_PATH = "sidepanel/sidepanel.html";

function disablePanelByDefault() {
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
}
chrome.runtime.onInstalled.addListener(disablePanelByDefault);
chrome.runtime.onStartup.addListener(disablePanelByDefault);

function openForTab(tabId) {
  chrome.sidePanel.setOptions({ tabId, path: `${PANEL_PATH}?tabId=${tabId}`, enabled: true }).catch(() => {});
  chrome.sidePanel.open({ tabId }).catch((err) => {
    console.error("MatchResumer: failed to open panel", err);
  });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "MR_HL_OPEN_PANEL") return;
  if (sender.tab?.id != null) openForTab(sender.tab.id);
});

chrome.action.onClicked.addListener((tab) => {
  if (tab?.id) openForTab(tab.id);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-side-panel") {
    if (tab?.id) openForTab(tab.id);
  } else if (command === "analyze-resume") {
    if (!tab?.id) return;
    chrome.runtime.sendMessage({ type: "JOB_MATCH_SHORTCUT_ANALYZE", tabId: tab.id }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`${SESSION_KEY_PREFIX}${tabId}`).catch(() => {});
});
