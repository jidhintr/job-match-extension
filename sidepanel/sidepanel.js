import { init } from "./features/bootstrap.js";
import "./features/matcher.js";
import "./features/prep.js";
import "./features/coverLetter.js";
import "./features/salary.js";
import "./features/scan.js";
import "./features/tracker.js";
import "./features/kpi.js";

const panelTabId = Number(new URLSearchParams(location.search).get("tabId"));
if (Number.isFinite(panelTabId)) {
  chrome.runtime.connect({ name: `panel:${panelTabId}` });
}

function focusPanel() {
  window.focus();
  if (!document.activeElement || document.activeElement === document.body) {
    document.body.focus({ preventScroll: true });
  }
}

focusPanel();
window.addEventListener("load", focusPanel);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) focusPanel();
});

init();
