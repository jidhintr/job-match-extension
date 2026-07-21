const PANEL_PATH = "sidepanel/sidepanel.html";
const SESSION_KEY_PREFIX = "jobMatchState:";

// Binding a tabId to the panel path (even the same path used as the default)
// gives that tab its own independent side panel document/instance instead of
// sharing the one global panel across every tab in the window. This is what
// lets you analyze different jobs on different tabs without one clobbering
// the other, and run analyses on two tabs at the same time.
//
// Chrome keeps the side panel open across tab switches for any tab that has
// it enabled — so enabling it globally on every new tab (the old behavior)
// meant it followed you onto unrelated tabs too (social media, etc). Instead
// we only enable+open it for a tab the moment the user actually clicks the
// toolbar icon on that tab, so it stays absent everywhere else by default.
async function enablePanelForTab(tabId) {
  try {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
  } catch {
    // Tabs that can't host extension UI (chrome://, the Web Store, etc.) — ignore.
  }
}

// manifest.json's side_panel.default_path implicitly enables the panel
// globally on every tab unless overridden — so this override is required,
// not optional, otherwise every tab (including ones we never touch) would
// still inherit an enabled, followable panel regardless of the per-tab logic
// above. Set on both install and browser startup since it's the kind of
// override that's easy to silently lose otherwise.
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
