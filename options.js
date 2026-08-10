import {
  ANALYSED_STATUS,
  MAX_TRACKER_STATUSES,
  DEFAULT_TRACKER_STATUS_OPTIONS,
  DEFAULT_GUARD_MIN_ATS,
  DEFAULT_GUARD_MIN_CHANCE,
  DEFAULT_GUARD_KEYWORDS,
  sanitizeTrackerStatusOptions,
  sanitizeCacheTtlHours,
  sanitizeThreshold
} from "./shared/settingsSchema.js";

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
  tracker: document.getElementById("tabVisTracker"),
  kpi: document.getElementById("tabVisKpi")
};
const DEFAULT_VISIBLE_TABS = { scan: true, matcher: true, prep: true, tracker: true, kpi: true };

const guardMinAtsInput = document.getElementById("guardMinAts");
const guardMinChanceInput = document.getElementById("guardMinChance");
const guardKeywordsInput = document.getElementById("guardKeywords");
const saveGuardSettingsBtn = document.getElementById("saveGuardSettingsBtn");
const guardStatus = document.getElementById("guardStatus");

const cacheTtlInput = document.getElementById("cacheTtlHours");
const saveCacheTtlBtn = document.getElementById("saveCacheTtlBtn");
const clearCacheBtn = document.getElementById("clearCacheBtn");
const cacheTtlStatus = document.getElementById("cacheTtlStatus");

const trackerStatusOptionsStatus = document.getElementById("trackerStatusOptionsStatus");
const trackerStatusRows = document.getElementById("trackerStatusRows");
const addTrackerStatusBtn = document.getElementById("addTrackerStatusBtn");
let trackerStatusOptions = DEFAULT_TRACKER_STATUS_OPTIONS.map((s) => ({ ...s }));

async function saveTrackerStatusOptions() {
  await chrome.storage.local.set({ trackerStatusOptions });
}

function renderTrackerStatusRows() {
  trackerStatusRows.innerHTML = "";
  trackerStatusOptions.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "status-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = entry.enabled;
    checkbox.title = "Show in Tracker dropdowns";
    checkbox.addEventListener("change", async () => {
      const anyChecked = trackerStatusOptions.some((s, idx) => (idx === i ? checkbox.checked : s.enabled));
      if (!anyChecked) {
        checkbox.checked = true;
        flashStatus(trackerStatusOptionsStatus, "At least one status must stay enabled.", "err");
        return;
      }
      trackerStatusOptions[i].enabled = checkbox.checked;
      await saveTrackerStatusOptions();
      flashStatus(trackerStatusOptionsStatus, "Saved ✓", "ok");
    });

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = entry.label;
    textInput.maxLength = 24;
    textInput.placeholder = "Status name";
    const commitLabel = async () => {
      const value = textInput.value.trim();
      if (!value) {
        textInput.value = trackerStatusOptions[i].label;
        return;
      }
      if (value.toLowerCase() === ANALYSED_STATUS.toLowerCase()) {
        textInput.value = trackerStatusOptions[i].label;
        flashStatus(trackerStatusOptionsStatus, `"${ANALYSED_STATUS}" is reserved and always available.`, "err");
        return;
      }
      trackerStatusOptions[i].label = value;
      await saveTrackerStatusOptions();
      flashStatus(trackerStatusOptionsStatus, "Saved ✓", "ok");
    };
    textInput.addEventListener("change", commitLabel);
    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") textInput.blur();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "move-btn";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove status";
    removeBtn.disabled = trackerStatusOptions.length <= 1;
    removeBtn.addEventListener("click", async () => {
      if (trackerStatusOptions.length <= 1) return;
      trackerStatusOptions.splice(i, 1);
      await saveTrackerStatusOptions();
      renderTrackerStatusRows();
      flashStatus(trackerStatusOptionsStatus, "Saved ✓", "ok");
    });

    row.append(checkbox, textInput, removeBtn);
    trackerStatusRows.appendChild(row);
  });

  addTrackerStatusBtn.disabled = trackerStatusOptions.length >= MAX_TRACKER_STATUSES;
}

addTrackerStatusBtn.addEventListener("click", () => {
  if (trackerStatusOptions.length >= MAX_TRACKER_STATUSES) return;
  trackerStatusOptions.push({ label: "", enabled: true });
  renderTrackerStatusRows();
  const inputs = trackerStatusRows.querySelectorAll('input[type="text"]');
  inputs[inputs.length - 1]?.focus();
});

const DEFAULT_MATCHER_INSTRUCTIONS = `The candidate speaks only English. If the job posting states fluency in another language (German, Dutch, French, Polish, etc.) as a MANDATORY/REQUIRED qualification — not merely a "nice to have" or an incidental mention like "collaborates with our Berlin office" — this is a hard disqualifying blocker.
The candidate holds an EU Blue Card and is legally authorized to work in Poland without any visa or employer sponsorship, and is open to the general labor market (not tied to a single employer). For roles based outside Poland, the candidate can generally transfer their Blue Card to another EU country with minimal paperwork under EU intra-mobility rules. Do NOT treat "role is outside Poland" as a negative factor by itself, and do NOT lower chance_of_getting_job for it. ONLY flag it if the job posting explicitly states something like "no visa sponsorship," "must already be authorized to work locally," or "no relocation support" for a role outside Poland.`;

const DEFAULT_PREP_OVERVIEW_PROMPT = `You are an expert technical interview coach who has studied thousands of real candidate-reported interview experiences from Glassdoor, TeamBlind, and Prepfully.

Given a JOB DESCRIPTION, identify the company_name and job_title exactly as posted, then predict the realistic focus areas of this role's interview process and how much each is typically weighted.

Rules:
- Return 3 to 6 areas tailored to this specific role — do not force a fixed generic list. A backend role might get "Coding & Data Structures", "System Design", "Databases"; a frontend role might get "JavaScript Deep-Dive", "UI/Performance", "System Design (Frontend)"; adjust freely to what this posting actually describes.
- Each area needs: title (short, 2-5 words), predicted_round (a short realistic label like "Round 1 — Online Assessment", "Round 3 — Onsite", "Final Round"), and weight_percent (a whole number).
- weight_percent values across ALL areas MUST sum to exactly 100.
- Order areas the way they'd realistically occur in an interview loop, earliest first.
- If RECRUITER INSIGHTS are provided below the job description, treat them as ground truth that overrides your own guesses — adjust area titles, rounds, and weights to match what the recruiter actually said.`;

const DEFAULT_BULK_MATCH_PROMPT = `You are a fast ATS matching engine. Given a candidate's resume and one job posting (title/company/description, which may be brief), return a realistic match percentage and exactly 7 key technical skills/technologies this posting asks for.

Rules:
- match_percent: whole number 0-100 reflecting realistic fit between resume and posting.
- tech_stack: exactly 7 short tags (e.g. "React", "AWS", "Kubernetes") — the most specific, concrete technologies/skills named in the posting. If the posting text is too short to find 7 distinct technical items, fill remaining slots with the closest relevant domain/soft skills implied by the title — never leave fewer than 7.`;

const INSTR_DEFAULTS = {
  matcher: DEFAULT_MATCHER_INSTRUCTIONS,
  prep: DEFAULT_PREP_OVERVIEW_PROMPT,
  scan: DEFAULT_BULK_MATCH_PROMPT
};

const instrInputs = {
  matcher: document.getElementById("instrMatcher"),
  prep: document.getElementById("instrPrep"),
  scan: document.getElementById("instrScan")
};
const instrStatuses = {
  matcher: document.getElementById("instrMatcherStatus"),
  prep: document.getElementById("instrPrepStatus"),
  scan: document.getElementById("instrScanStatus")
};
const instrSaveButtons = {
  matcher: document.getElementById("saveInstrMatcher"),
  prep: document.getElementById("saveInstrPrep"),
  scan: document.getElementById("saveInstrScan")
};
const instrResetButtons = {
  matcher: document.getElementById("resetInstrMatcher"),
  prep: document.getElementById("resetInstrPrep"),
  scan: document.getElementById("resetInstrScan")
};

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
    "resumeSectionOrder",
    "customInstructions",
    "trackerStatusOptions",
    "cacheTtlHours",
    "guardMinAts",
    "guardMinChance",
    "guardKeywords"
  ]);
  cacheTtlInput.value = String(sanitizeCacheTtlHours(stored.cacheTtlHours));
  guardMinAtsInput.value = String(sanitizeThreshold(stored.guardMinAts, DEFAULT_GUARD_MIN_ATS));
  guardMinChanceInput.value = String(sanitizeThreshold(stored.guardMinChance, DEFAULT_GUARD_MIN_CHANCE));
  guardKeywordsInput.value = stored.guardKeywords === undefined ? DEFAULT_GUARD_KEYWORDS : stored.guardKeywords;
  if (stored.geminiApiKey) apiKeyInput.value = stored.geminiApiKey;

  resumeSectionOrder = sanitizeSectionOrder(stored.resumeSectionOrder);
  renderResumeSectionsList();

  const savedInstructions = stored.customInstructions || {};
  instrInputs.matcher.value = savedInstructions.matcher !== undefined ? savedInstructions.matcher : INSTR_DEFAULTS.matcher;
  instrInputs.prep.value = savedInstructions.prep || INSTR_DEFAULTS.prep;
  instrInputs.scan.value = savedInstructions.scan || INSTR_DEFAULTS.scan;

  const visibleTabs = { ...DEFAULT_VISIBLE_TABS, ...(stored.visibleTabs || {}) };
  Object.entries(tabVisCheckboxes).forEach(([key, checkbox]) => {
    if (checkbox) checkbox.checked = visibleTabs[key] !== false;
  });

  trackerStatusOptions = sanitizeTrackerStatusOptions(stored.trackerStatusOptions);
  renderTrackerStatusRows();
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

saveGuardSettingsBtn.addEventListener("click", async () => {
  const guardMinAts = sanitizeThreshold(guardMinAtsInput.value, DEFAULT_GUARD_MIN_ATS);
  const guardMinChance = sanitizeThreshold(guardMinChanceInput.value, DEFAULT_GUARD_MIN_CHANCE);
  guardMinAtsInput.value = String(guardMinAts);
  guardMinChanceInput.value = String(guardMinChance);
  await chrome.storage.local.set({ guardMinAts, guardMinChance, guardKeywords: guardKeywordsInput.value.trim() });
  flashStatus(guardStatus, "Saved ✓", "ok");
});

saveCacheTtlBtn.addEventListener("click", async () => {
  const hours = sanitizeCacheTtlHours(cacheTtlInput.value);
  cacheTtlInput.value = String(hours);
  await chrome.storage.local.set({ cacheTtlHours: hours });
  flashStatus(cacheTtlStatus, `Saved ✓ — cache lasts ${hours}h`, "ok");
});

clearCacheBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("trackerCache");
  flashStatus(cacheTtlStatus, "Cache cleared — next view refetches.", "ok");
});

Object.entries(instrSaveButtons).forEach(([key, btn]) => {
  btn?.addEventListener("click", async () => {
    const stored = await chrome.storage.local.get("customInstructions");
    const customInstructions = { ...(stored.customInstructions || {}), [key]: instrInputs[key].value.trim() };
    await chrome.storage.local.set({ customInstructions });
    flashStatus(instrStatuses[key], "Saved ✓", "ok");
  });
});

Object.entries(instrResetButtons).forEach(([key, btn]) => {
  btn?.addEventListener("click", () => {
    instrInputs[key].value = INSTR_DEFAULTS[key];
    flashStatus(instrStatuses[key], "Reset — click Save to keep it.", "ok");
  });
});

loadSavedValues();
