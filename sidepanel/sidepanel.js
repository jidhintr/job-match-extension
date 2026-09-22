import { init } from "./features/bootstrap.js";
import "./features/matcher.js";
import "./features/prep.js";
import "./features/scan.js";
import "./features/tracker.js";
import "./features/kpi.js";
import "./features/highlights.js";

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
