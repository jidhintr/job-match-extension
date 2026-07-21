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
    "perplexityModel"
  ]);
  if (stored.geminiApiKey) apiKeyInput.value = stored.geminiApiKey;
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

loadSavedValues();
