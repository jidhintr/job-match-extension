import { clampScore, splitCsv } from "../ui/format.js";
import { saveGuardModal, saveGuardReasons, saveGuardConfirmBtn, saveGuardDiscardBtn } from "../ui/dom.js";

export const DEFAULT_GUARD_MIN_ATS = 50;
export const DEFAULT_GUARD_MIN_CHANCE = 40;
export const DEFAULT_GUARD_KEYWORDS = ".net";

export function sanitizeThreshold(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, n));
}

export function matchesAutoSaveKeyword(jobText, keywords) {
  const list = splitCsv(keywords).map((k) => k.toLowerCase());
  if (list.length === 0) return null;
  const haystack = String(jobText || "").toLowerCase();
  return list.find((k) => haystack.includes(k)) || null;
}

export function evaluateSaveGuard(result, jobText, settings) {
  const ats = Math.round(clampScore(result?.ats_score));
  const chance = Math.round(clampScore(result?.chance_of_getting_job));
  const minAts = sanitizeThreshold(settings.guardMinAts, DEFAULT_GUARD_MIN_ATS);
  const minChance = sanitizeThreshold(settings.guardMinChance, DEFAULT_GUARD_MIN_CHANCE);

  const languageBarrier = String(result?.warnings?.language_barrier || "").trim();
  if (languageBarrier) {
    return { needsConfirm: true, reasons: [`Language barrier — ${languageBarrier}`] };
  }

  const keyword = matchesAutoSaveKeyword(jobText, settings.guardKeywords);
  if (keyword) return { needsConfirm: false, reasons: [], bypass: `"${keyword}" found in the posting` };

  if (ats < minAts && chance < minChance) {
    return {
      needsConfirm: true,
      reasons: [`ATS ${ats}% is below ${minAts}%`, `Chance ${chance}% is below ${minChance}%`]
    };
  }

  return { needsConfirm: false, reasons: [] };
}

let pendingResolve = null;

function close(decision) {
  saveGuardModal.classList.add("hidden");
  const resolve = pendingResolve;
  pendingResolve = null;
  if (resolve) resolve(decision);
}

export function confirmSave(reasons) {
  saveGuardReasons.innerHTML = "";
  reasons.forEach((reason) => {
    const li = document.createElement("li");
    li.textContent = reason;
    saveGuardReasons.appendChild(li);
  });

  saveGuardModal.classList.remove("hidden");
  saveGuardDiscardBtn.focus();

  return new Promise((resolve) => {
    pendingResolve = resolve;
  });
}

saveGuardConfirmBtn.addEventListener("click", () => close(true));
saveGuardDiscardBtn.addEventListener("click", () => close(false));
saveGuardModal.addEventListener("click", (e) => {
  if (e.target === saveGuardModal) close(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && pendingResolve) close(false);
});
