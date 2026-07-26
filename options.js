const apiKeyInput = document.getElementById("apiKey");
const toggleKeyVisibilityBtn = document.getElementById("toggleKeyVisibility");
const saveKeyBtn = document.getElementById("saveKey");
const keyStatus = document.getElementById("keyStatus");

const sheetsWebhookUrlInput = document.getElementById("sheetsWebhookUrl");
const saveSheetsUrlBtn = document.getElementById("saveSheetsUrl");
const sheetsUrlStatus = document.getElementById("sheetsUrlStatus");

const tavilyKeyInput = document.getElementById("tavilyKey");
const deepseekKeyInput = document.getElementById("deepseekKey");
const deepseekModelInput = document.getElementById("deepseekModel");
const openaiKeyInput = document.getElementById("openaiKey");
const openaiModelInput = document.getElementById("openaiModel");
const perplexityKeyInput = document.getElementById("perplexityKey");
const perplexityModelInput = document.getElementById("perplexityModel");
const saveProvidersBtn = document.getElementById("saveProviders");
const providersStatus = document.getElementById("providersStatus");

const PROVIDER_DEFAULT_MODELS = {
  deepseek: "deepseek-v4-flash",
  openai: "gpt-5-mini",
  perplexity: "sonar"
};

const resumeInput = document.getElementById("resume");
const saveResumeBtn = document.getElementById("saveResume");
const resumeStatus = document.getElementById("resumeStatus");
const charCount = document.getElementById("charCount");

const tabVisibilityStatus = document.getElementById("tabVisibilityStatus");
const tabVisCheckboxes = {
  scan: document.getElementById("tabVisScan"),
  matcher: document.getElementById("tabVisMatcher"),
  prep: document.getElementById("tabVisPrep"),
  apply: document.getElementById("tabVisApply")
};
const DEFAULT_VISIBLE_TABS = { scan: true, matcher: true, prep: true, apply: true };

// Mirrors the id/label pairs in sidepanel.js's RESUME_SECTIONS registry —
// duplicated here since options.js and sidepanel.js are separate script
// contexts with no shared module. Keep in sync if a section is added there.
const RESUME_SECTION_LABELS = {
  missing_skills: "Missing Skills",
  resume_optimization: "Resume Optimization",
  stage_1_attention_test: "Stage 1 — Attention Test",
  stage_2_mindset_breakdown: "Stage 2 — Mindset Breakdown",
  stage_3_tech_gap_table: "Stage 3 — Tech Gap Table",
  why_good_fit: "Why You're a Good Fit",
  role_prep: "Interview & Role Prep",
  company_insights: "Company Insights"
};
const DEFAULT_SECTION_ORDER = Object.keys(RESUME_SECTION_LABELS).map((id) => ({ id, enabled: true }));
const resumeSectionsList = document.getElementById("resumeSectionsList");
let resumeSectionOrder = DEFAULT_SECTION_ORDER.map((s) => ({ ...s }));

function sanitizeSectionOrder(saved) {
  if (!Array.isArray(saved) || saved.length === 0) return DEFAULT_SECTION_ORDER.map((s) => ({ ...s }));
  const validIds = new Set(Object.keys(RESUME_SECTION_LABELS));
  const cleaned = saved.filter((s) => s && validIds.has(s.id)).map((s) => ({ id: s.id, enabled: s.enabled !== false }));
  const present = new Set(cleaned.map((s) => s.id));
  Object.keys(RESUME_SECTION_LABELS).forEach((id) => {
    if (!present.has(id)) cleaned.push({ id, enabled: true });
  });
  return cleaned;
}

async function saveResumeSectionOrder() {
  await chrome.storage.local.set({ resumeSectionOrder });
}

function renderResumeSectionsList() {
  resumeSectionsList.innerHTML = "";
  resumeSectionOrder.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "section-row";

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = entry.enabled;
    checkbox.addEventListener("change", async () => {
      resumeSectionOrder[i].enabled = checkbox.checked;
      await saveResumeSectionOrder();
    });
    label.append(checkbox, document.createTextNode(RESUME_SECTION_LABELS[entry.id] || entry.id));

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "move-btn";
    upBtn.textContent = "▲";
    upBtn.disabled = i === 0;
    upBtn.addEventListener("click", async () => {
      [resumeSectionOrder[i - 1], resumeSectionOrder[i]] = [resumeSectionOrder[i], resumeSectionOrder[i - 1]];
      await saveResumeSectionOrder();
      renderResumeSectionsList();
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "move-btn";
    downBtn.textContent = "▼";
    downBtn.disabled = i === resumeSectionOrder.length - 1;
    downBtn.addEventListener("click", async () => {
      [resumeSectionOrder[i + 1], resumeSectionOrder[i]] = [resumeSectionOrder[i], resumeSectionOrder[i + 1]];
      await saveResumeSectionOrder();
      renderResumeSectionsList();
    });

    row.append(label, upBtn, downBtn);
    resumeSectionsList.appendChild(row);
  });
}

function flashStatus(el, message, kind) {
  el.textContent = message;
  el.classList.remove("ok", "err");
  el.classList.add(kind, "show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function updateCharCount() {
  charCount.textContent = `${resumeInput.value.length} characters`;
}

async function loadSavedValues() {
  const stored = await chrome.storage.local.get([
    "geminiApiKey",
    "sheetsWebhookUrl",
    "masterResume",
    "tavilyKey",
    "deepseekKey",
    "deepseekModel",
    "openaiKey",
    "openaiModel",
    "perplexityKey",
    "perplexityModel",
    "visibleTabs",
    "resumeSectionOrder"
  ]);
  if (stored.geminiApiKey) apiKeyInput.value = stored.geminiApiKey;

  resumeSectionOrder = sanitizeSectionOrder(stored.resumeSectionOrder);
  renderResumeSectionsList();

  const visibleTabs = { ...DEFAULT_VISIBLE_TABS, ...(stored.visibleTabs || {}) };
  Object.entries(tabVisCheckboxes).forEach(([key, checkbox]) => {
    if (checkbox) checkbox.checked = visibleTabs[key] !== false;
  });
  if (stored.sheetsWebhookUrl) sheetsWebhookUrlInput.value = stored.sheetsWebhookUrl;
  if (stored.masterResume) resumeInput.value = stored.masterResume;

  if (stored.tavilyKey) tavilyKeyInput.value = stored.tavilyKey;
  if (stored.deepseekKey) deepseekKeyInput.value = stored.deepseekKey;
  deepseekModelInput.value = stored.deepseekModel || PROVIDER_DEFAULT_MODELS.deepseek;
  if (stored.openaiKey) openaiKeyInput.value = stored.openaiKey;
  openaiModelInput.value = stored.openaiModel || PROVIDER_DEFAULT_MODELS.openai;
  if (stored.perplexityKey) perplexityKeyInput.value = stored.perplexityKey;
  perplexityModelInput.value = stored.perplexityModel || PROVIDER_DEFAULT_MODELS.perplexity;

  updateCharCount();
}

toggleKeyVisibilityBtn.addEventListener("click", () => {
  const isPassword = apiKeyInput.type === "password";
  apiKeyInput.type = isPassword ? "text" : "password";
  toggleKeyVisibilityBtn.textContent = isPassword ? "Hide" : "Show";
});

saveKeyBtn.addEventListener("click", async () => {
  const value = apiKeyInput.value.trim();
  if (!value) {
    flashStatus(keyStatus, "Enter a key first.", "err");
    return;
  }
  await chrome.storage.local.set({ geminiApiKey: value });
  flashStatus(keyStatus, "Saved ✓", "ok");
});

saveSheetsUrlBtn.addEventListener("click", async () => {
  const value = sheetsWebhookUrlInput.value.trim();
  if (value && !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(value)) {
    flashStatus(sheetsUrlStatus, "Doesn't look like an Apps Script /exec URL.", "err");
    return;
  }
  await chrome.storage.local.set({ sheetsWebhookUrl: value });
  flashStatus(sheetsUrlStatus, value ? "Saved ✓" : "Cleared ✓", "ok");
});

saveProvidersBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({
    tavilyKey: tavilyKeyInput.value.trim(),
    deepseekKey: deepseekKeyInput.value.trim(),
    deepseekModel: deepseekModelInput.value.trim() || PROVIDER_DEFAULT_MODELS.deepseek,
    openaiKey: openaiKeyInput.value.trim(),
    openaiModel: openaiModelInput.value.trim() || PROVIDER_DEFAULT_MODELS.openai,
    perplexityKey: perplexityKeyInput.value.trim(),
    perplexityModel: perplexityModelInput.value.trim() || PROVIDER_DEFAULT_MODELS.perplexity
  });
  // No per-source key is required — Gemini (saved above) drives consolidation on
  // its own; these are all optional extra scan sources.
  flashStatus(providersStatus, "Saved ✓", "ok");
});

saveResumeBtn.addEventListener("click", async () => {
  const value = resumeInput.value.trim();
  if (!value) {
    flashStatus(resumeStatus, "Resume is empty.", "err");
    return;
  }
  await chrome.storage.local.set({ masterResume: value });
  flashStatus(resumeStatus, "Saved ✓", "ok");
});

resumeInput.addEventListener("input", updateCharCount);

Object.entries(tabVisCheckboxes).forEach(([key, checkbox]) => {
  checkbox?.addEventListener("change", async () => {
    const anyChecked = Object.values(tabVisCheckboxes).some((cb) => cb?.checked);
    if (!anyChecked) {
      checkbox.checked = true;
      flashStatus(tabVisibilityStatus, "At least one tab must stay visible.", "err");
      return;
    }
    const visibleTabs = {};
    Object.entries(tabVisCheckboxes).forEach(([k, cb]) => {
      visibleTabs[k] = !!cb?.checked;
    });
    await chrome.storage.local.set({ visibleTabs });
    flashStatus(tabVisibilityStatus, "Saved ✓", "ok");
  });
});

loadSavedValues();
