const SESSION_KEY_PREFIX = "jobMatchState:";

// Lets Chrome open the side panel natively when the toolbar icon is clicked, instead of the
// extension calling chrome.sidePanel.open() itself after an await. That await was the bug: it let
// the click's "user gesture" expire before open() ran, which on some machines/Chrome versions
// throws "may only be called in response to a user gesture" and the panel never opens.
function enableOpenOnActionClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.error("MatchResumer: failed to set side panel behavior", err);
  });
}
chrome.runtime.onInstalled.addListener(enableOpenOnActionClick);
chrome.runtime.onStartup.addListener(enableOpenOnActionClick);

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-side-panel") {
    if (!tab?.id) return;
    // Call open() synchronously, first thing in the listener — same gesture-timing rule as above.
    chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
      console.error("MatchResumer: failed to open panel via shortcut", err);
    });
  } else if (command === "analyze-resume") {
    // No-op if the side panel isn't open — there's nothing listening on the other end yet.
    chrome.runtime.sendMessage({ type: "JOB_MATCH_SHORTCUT_ANALYZE" }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`${SESSION_KEY_PREFIX}${tabId}`).catch(() => {});
});
