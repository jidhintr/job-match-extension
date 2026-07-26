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

const DEFAULT_MATCHER_INSTRUCTIONS = `The candidate speaks only English. If the job posting states fluency in another language (German, Dutch, French, Polish, etc.) as a MANDATORY/REQUIRED qualification — not merely a "nice to have" or an incidental mention like "collaborates with our Berlin office" — this is a hard disqualifying blocker.
The candidate holds an EU Blue Card and is legally authorized to work in Poland without any visa or employer sponsorship, and is open to the general labor market (not tied to a single employer). For roles based outside Poland, the candidate can generally transfer their Blue Card to another EU country with minimal paperwork under EU intra-mobility rules. Do NOT treat "role is outside Poland" as a negative factor by itself, and do NOT lower chance_of_getting_job for it. ONLY flag it if the job posting explicitly states something like "no visa sponsorship," "must already be authorized to work locally," or "no relocation support" for a role outside Poland.`;

// These mirror the DEFAULT_*_PROMPT constants in sidepanel/features/*.js — kept as plain text
// here (not imported) because this page is a standalone classic script, same as
// DEFAULT_MATCHER_INSTRUCTIONS above. A fixed, non-editable line that keeps each response
// matching its JSON schema is appended by the sidepanel after whatever is saved here.
const DEFAULT_PREP_OVERVIEW_PROMPT = `You are an expert technical interview coach who has studied thousands of real candidate-reported interview experiences from Glassdoor, TeamBlind, and Prepfully.

Given a JOB DESCRIPTION, identify the company_name and job_title exactly as posted, then predict the realistic focus areas of this role's interview process and how much each is typically weighted.

Rules:
- Return 3 to 6 areas tailored to this specific role — do not force a fixed generic list. A backend role might get "Coding & Data Structures", "System Design", "Databases"; a frontend role might get "JavaScript Deep-Dive", "UI/Performance", "System Design (Frontend)"; adjust freely to what this posting actually describes.
- Each area needs: title (short, 2-5 words), predicted_round (a short realistic label like "Round 1 — Online Assessment", "Round 3 — Onsite", "Final Round"), and weight_percent (a whole number).
- weight_percent values across ALL areas MUST sum to exactly 100.
- Order areas the way they'd realistically occur in an interview loop, earliest first.
- If RECRUITER INSIGHTS are provided below the job description, treat them as ground truth that overrides your own guesses — adjust area titles, rounds, and weights to match what the recruiter actually said.`;

const DEFAULT_COVER_LETTER_PROMPT = `You are an expert career coach writing a concise, professional cover letter for a specific job application.

You will be given a candidate's MASTER RESUME and a JOB DESCRIPTION. Write a genuine, tailored one-page cover letter — never use placeholder text like "[Your Name]" or "[Company Name]"; extract the candidate's actual name from the resume and the company/role from the job description, and use them directly. If the candidate's name truly cannot be found in the resume, omit it (return an empty string) rather than inventing or placeholding it.

Structure:
- opening_paragraph: hook the reader, state the role and genuine interest, 2-3 sentences.
- key_points: exactly 3 to 5 short, punchy bullet points, each a specific, concrete selling point connecting the candidate's real resume experience to this job's actual requirements (use real numbers/technologies/outcomes from the resume, not generic claims).
- closing_paragraph: confident close with a call to action, 2-3 sentences.
- candidate_name: the candidate's full name as found in the resume, or empty string if genuinely absent.

Keep the whole letter fitting on one page (roughly 250-350 words total). Be specific, not generic. No markdown, no placeholders.`;

const DEFAULT_SALARY_PROMPT = `You are a compensation analyst with broad knowledge of global tech salary benchmarks, cost of living, taxation, and market standards.

Given a JOB DESCRIPTION (which states or implies a location) and role/company context — plus optional live web search snippets if provided — estimate a realistic salary for this specific role at this specific company/location, informed by market standards, typical tax burden, and inflation for that location.

Rules:
- Identify the job's location (city/country) from the posting; if unclear, assume Poland.
- local_currency is that location's actual currency (e.g. "PLN" for Poland, "USD" for the US, etc).
- Give monthly and annual GROSS figures in local currency, in PLN, and in EUR. If local currency is already PLN or EUR, set that duplicate currency's four number fields to 0 and explain why in basis_note — never show identical numbers twice under different labels.
- benefits: 4-8 realistic, specific benefits typical for this role/company/location (health, equity, remote policy, learning budget, etc) — no vague filler.
- negotiation_tips: 3-5 concrete negotiation angles specific to this role and situation (leverage points, what to ask for beyond base pay).
- basis_note: 1-2 sentences on what this estimate is grounded in — it's an informed estimate, not a live quote.`;

const DEFAULT_BULK_MATCH_PROMPT = `You are a fast ATS matching engine. Given a candidate's resume and one job posting (title/company/description, which may be brief), return a realistic match percentage and exactly 7 key technical skills/technologies this posting asks for.

Rules:
- match_percent: whole number 0-100 reflecting realistic fit between resume and posting.
- tech_stack: exactly 7 short tags (e.g. "React", "AWS", "Kubernetes") — the most specific, concrete technologies/skills named in the posting. If the posting text is too short to find 7 distinct technical items, fill remaining slots with the closest relevant domain/soft skills implied by the title — never leave fewer than 7.`;

const INSTR_DEFAULTS = {
  matcher: DEFAULT_MATCHER_INSTRUCTIONS,
  prep: DEFAULT_PREP_OVERVIEW_PROMPT,
  coverLetter: DEFAULT_COVER_LETTER_PROMPT,
  salary: DEFAULT_SALARY_PROMPT,
  scan: DEFAULT_BULK_MATCH_PROMPT
};

const instrInputs = {
  matcher: document.getElementById("instrMatcher"),
  prep: document.getElementById("instrPrep"),
  coverLetter: document.getElementById("instrCoverLetter"),
  salary: document.getElementById("instrSalary"),
  scan: document.getElementById("instrScan")
};
const instrStatuses = {
  matcher: document.getElementById("instrMatcherStatus"),
  prep: document.getElementById("instrPrepStatus"),
  coverLetter: document.getElementById("instrCoverLetterStatus"),
  salary: document.getElementById("instrSalaryStatus"),
  scan: document.getElementById("instrScanStatus")
};
const instrSaveButtons = {
  matcher: document.getElementById("saveInstrMatcher"),
  prep: document.getElementById("saveInstrPrep"),
  coverLetter: document.getElementById("saveInstrCoverLetter"),
  salary: document.getElementById("saveInstrSalary"),
  scan: document.getElementById("saveInstrScan")
};
const instrResetButtons = {
  matcher: document.getElementById("resetInstrMatcher"),
  prep: document.getElementById("resetInstrPrep"),
  coverLetter: document.getElementById("resetInstrCoverLetter"),
  salary: document.getElementById("resetInstrSalary"),
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
    "customInstructions"
  ]);
  if (stored.geminiApiKey) apiKeyInput.value = stored.geminiApiKey;

  resumeSectionOrder = sanitizeSectionOrder(stored.resumeSectionOrder);
  renderResumeSectionsList();

  const savedInstructions = stored.customInstructions || {};
  instrInputs.matcher.value = savedInstructions.matcher !== undefined ? savedInstructions.matcher : INSTR_DEFAULTS.matcher;
  instrInputs.prep.value = savedInstructions.prep || INSTR_DEFAULTS.prep;
  // coverLetter/salary used to be one shared "apply" field holding only extra notes appended
  // after the (then-hardcoded) prompt. If that's still the only thing saved, fold it into the
  // new default the same way it used to be combined, instead of dropping it or — worse —
  // letting it silently replace the whole prompt (which would delete the task instructions).
  const migrateApplyNote = (defaultPrompt) =>
    savedInstructions.apply?.trim()
      ? `${defaultPrompt}\n\nADDITIONAL INSTRUCTIONS FROM THE USER (apply as extra context/rules):\n"""\n${savedInstructions.apply.trim()}\n"""`
      : defaultPrompt;
  instrInputs.coverLetter.value = savedInstructions.coverLetter || migrateApplyNote(INSTR_DEFAULTS.coverLetter);
  instrInputs.salary.value = savedInstructions.salary || migrateApplyNote(INSTR_DEFAULTS.salary);
  instrInputs.scan.value = savedInstructions.scan || INSTR_DEFAULTS.scan;

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
