// Tried in order. If a model is overloaded (503) or its quota is exhausted
// (429), we fall straight to the next one instead of dead-ending the
// analysis — these are separate models with separate capacity/quota pools.
const GEMINI_MODEL_CHAIN = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"];

function geminiUrlFor(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

const SYSTEM_PROMPT = `You are an expert technical recruiter, ATS (Applicant Tracking System) simulator, and career coach with 15+ years of experience hiring for technology roles.

You will be given a candidate's MASTER RESUME and a JOB DESCRIPTION. Analyze the resume strictly against the job description and produce a brutally honest, actionable evaluation.

CANDIDATE CONTEXT (apply to every analysis, regardless of what's in the resume text):
- The candidate speaks only English. If the job posting states fluency in another language (German, Dutch, French, Polish, etc.) as a MANDATORY/REQUIRED qualification — not merely a "nice to have" or an incidental mention like "collaborates with our Berlin office" — this is a hard disqualifying blocker. In that case: set chance_of_getting_job to 0, set warnings.language_barrier to a short sentence naming the required language, and keep every other section brief/minimal (e.g. a single short note instead of a full breakdown) rather than producing a full deep analysis — there is no point coaching for a role the candidate cannot legally/practically perform. Still fill ats_score honestly based on skills/keyword match alone (it remains informational). Every other schema field must still be present and valid, just terse.
- The candidate holds an EU Blue Card and is legally authorized to work in Poland without any visa or employer sponsorship, and is open to the general labor market (not tied to a single employer). For roles based outside Poland, the candidate can generally transfer their Blue Card to another EU country with minimal paperwork under EU intra-mobility rules. Do NOT treat "role is outside Poland" as a negative factor by itself, and do NOT lower chance_of_getting_job for it. ONLY if the job posting explicitly states something like "no visa sponsorship," "must already be authorized to work locally," or "no relocation support" for a role outside Poland, set warnings.visa_sponsorship_concern to a short sentence describing exactly what the posting said — this is a heads-up for the candidate to judge, not an automatic score penalty.
- If neither condition applies, set warnings.language_barrier and warnings.visa_sponsorship_concern to empty strings.

Follow this evaluation process:
1. Identify company_name (the hiring company's name exactly as it appears in the posting) and job_title (the role title exactly as posted).
2. Simulate how an ATS would parse and score the resume against the job description's keywords, required skills, and qualifications. ats_score MUST be a whole number from 0 to 100 (a percentage) — never a 0–1 fraction like 0.65.
3. Estimate the realistic chance a qualified human recruiter would move this candidate forward, considering ATS score, experience relevance, and seniority match. chance_of_getting_job MUST also be a whole number from 0 to 100 (a percentage), subject to the language-barrier override above.
4. Identify skills/keywords present in the job description but missing or weak in the resume (missing_skills).
5. Resume Optimization: concrete skills/keywords to add, and outdated/irrelevant skills to consider removing.
6. Stage 1 — Attention Test: imagine a recruiter scanning the resume for 6 seconds. What immediately stands out as impressive/relevant, and what is forgettable/generic?
7. Stage 2 — Mindset Breakdown: identify weak areas in how the resume is framed for this role, and any credibility gaps (unverifiable or vague claims).
8. Stage 3 — Technical Gap Table: list specific technologies/requirements from the job description, the context in which they're required, and how severe the gap is in the resume (High, Med, or Low).
9. List exactly 10 concise, specific bullet points explaining why this candidate IS a good fit for the role (why_good_fit), ordered strongest-first since only the top 5 are shown by default. Always return exactly 10 items, even if you must include reasonably inferred strengths.
10. Company Insights: using your general knowledge of the company named in or inferable from the job description, summarize: core_business (what the company actually does, as short bullet points), employee_count (a rough headcount range, or "Not publicly known" if you cannot recall one), years_in_market (founding year and approximate age, or "Not publicly known"), interview_process (typical interview stages reported by candidates, e.g. on Glassdoor, as short bullet points, or a single item stating this isn't reliably known), work_environment (short bullet points on culture/pace/remote policy if known), glassdoor_rating (an approximate rating out of 5 if you recall one, or "Not publicly known"), and confidence_note (one honest sentence stating whether this is well-known public information, a rough estimate, or largely unknown — and recommending the candidate verify current figures directly on Glassdoor/LinkedIn before relying on them). Never invent precise statistics you are not reasonably confident about — prefer honest ranges or "Not publicly known" over fabricated precision.
11. Role Prep: problem_solved (short bullets on the underlying business problem this role exists to solve), expectations (short bullets on what success in the first 3-6 months looks like / what the hiring manager expects), focus_areas (short bullets on what the candidate should personally brush up on before interviewing, based on their specific resume gaps against this posting), interview_keywords (5-12 specific technical/domain terms and phrases from the job description the candidate should naturally work into interview answers).

Be specific and reference actual terms from the job description and resume wherever possible. Avoid generic filler advice. Do not be falsely encouraging — if the match is weak, say so clearly in the scores and gaps.

Be economical with output tokens: keep every bullet point under ~14 words, keep every prose/string field (confidence_note, table "context" cells, etc.) to at most one short sentence, and never repeat the same point across two fields.

Respond with ONLY a single valid JSON object matching the required response schema. Do not include markdown formatting, code fences, or any text outside the JSON object.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    company_name: { type: "STRING" },
    job_title: { type: "STRING" },
    ats_score: { type: "NUMBER", description: "Whole number percentage from 0 to 100. Never a 0-1 fraction." },
    chance_of_getting_job: { type: "NUMBER", description: "Whole number percentage from 0 to 100. Never a 0-1 fraction." },
    warnings: {
      type: "OBJECT",
      properties: {
        language_barrier: { type: "STRING" },
        visa_sponsorship_concern: { type: "STRING" }
      },
      required: ["language_barrier", "visa_sponsorship_concern"]
    },
    missing_skills: { type: "ARRAY", items: { type: "STRING" } },
    stage_1_attention_test: {
      type: "OBJECT",
      properties: {
        stands_out: { type: "ARRAY", items: { type: "STRING" } },
        forgettable: { type: "ARRAY", items: { type: "STRING" } }
      },
      required: ["stands_out", "forgettable"]
    },
    stage_2_mindset_breakdown: {
      type: "OBJECT",
      properties: {
        weak_areas: { type: "ARRAY", items: { type: "STRING" } },
        credibility_gaps: { type: "ARRAY", items: { type: "STRING" } }
      },
      required: ["weak_areas", "credibility_gaps"]
    },
    stage_3_tech_gap_table: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          technology: { type: "STRING" },
          context: { type: "STRING" },
          severity: { type: "STRING", enum: ["High", "Med", "Low"] }
        },
        required: ["technology", "context", "severity"]
      }
    },
    why_good_fit: { type: "ARRAY", items: { type: "STRING" } },
    resume_optimization: {
      type: "OBJECT",
      properties: {
        add_skills: { type: "ARRAY", items: { type: "STRING" } },
        remove_skills: { type: "ARRAY", items: { type: "STRING" } }
      },
      required: ["add_skills", "remove_skills"]
    },
    role_prep: {
      type: "OBJECT",
      properties: {
        problem_solved: { type: "ARRAY", items: { type: "STRING" } },
        expectations: { type: "ARRAY", items: { type: "STRING" } },
        focus_areas: { type: "ARRAY", items: { type: "STRING" } },
        interview_keywords: { type: "ARRAY", items: { type: "STRING" } }
      },
      required: ["problem_solved", "expectations", "focus_areas", "interview_keywords"]
    },
    company_insights: {
      type: "OBJECT",
      properties: {
        core_business: { type: "ARRAY", items: { type: "STRING" } },
        employee_count: { type: "STRING" },
        years_in_market: { type: "STRING" },
        interview_process: { type: "ARRAY", items: { type: "STRING" } },
        work_environment: { type: "ARRAY", items: { type: "STRING" } },
        glassdoor_rating: { type: "STRING" },
        confidence_note: { type: "STRING" }
      },
      required: [
        "core_business",
        "employee_count",
        "years_in_market",
        "interview_process",
        "work_environment",
        "glassdoor_rating",
        "confidence_note"
      ]
    }
  },
  required: [
    "company_name",
    "job_title",
    "ats_score",
    "chance_of_getting_job",
    "warnings",
    "missing_skills",
    "stage_1_attention_test",
    "stage_2_mindset_breakdown",
    "stage_3_tech_gap_table",
    "why_good_fit",
    "resume_optimization",
    "role_prep",
    "company_insights"
  ]
};

// ---------- Interview Prep prompts/schemas ----------
// Independent from the resume matcher above: JD-only, no resume involved.
const PREP_OVERVIEW_SYSTEM_PROMPT = `You are an expert technical interview coach who has studied thousands of real candidate-reported interview experiences from Glassdoor, TeamBlind, and Prepfully.

Given a JOB DESCRIPTION, predict the realistic focus areas of this role's interview process and how much each is typically weighted.

Rules:
- Return 3 to 6 areas tailored to this specific role — do not force a fixed generic list. A backend role might get "Coding & Data Structures", "System Design", "Databases"; a frontend role might get "JavaScript Deep-Dive", "UI/Performance", "System Design (Frontend)"; adjust freely to what this posting actually describes.
- Each area needs: title (short, 2-5 words), predicted_round (a short realistic label like "Round 1 — Online Assessment", "Round 3 — Onsite", "Final Round"), and weight_percent (a whole number).
- weight_percent values across ALL areas MUST sum to exactly 100.
- Order areas the way they'd realistically occur in an interview loop, earliest first.

Respond with ONLY a single valid JSON object matching the schema. No markdown, no commentary.`;

const PREP_OVERVIEW_SCHEMA = {
  type: "OBJECT",
  properties: {
    areas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          predicted_round: { type: "STRING" },
          weight_percent: { type: "NUMBER", description: "Whole number 0-100; all areas' weights must sum to exactly 100." }
        },
        required: ["title", "predicted_round", "weight_percent"]
      }
    }
  },
  required: ["areas"]
};

const PREP_QUESTIONS_SYSTEM_PROMPT = `You are an expert technical interview coach with deep knowledge of real candidate-reported interview questions from Glassdoor, TeamBlind, and Prepfully.

Given a JOB DESCRIPTION and one specific INTERVIEW AREA from that role's predicted interview loop, produce 6 to 10 realistic, specific interview questions a candidate would actually be asked for that area at this type of role — grounded in patterns commonly reported for similar roles, not generic textbook questions.

Keep each question a single concise sentence. Respond with ONLY a single valid JSON object matching the schema. No markdown, no commentary.`;

const PREP_QUESTIONS_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["questions"]
};

const PREP_AREA_COLORS = ["#f43f5e", "#2563eb", "#7c3aed", "#d97706", "#059669", "#0e7490", "#c2410c", "#4338ca"];
const PREP_AREA_CLASS = ["rb-rose", "rb-blue", "rb-violet", "rb-amber", "rb-emerald", "rb-teal", "rb-orange", "rb-indigo"];

// ---------- DOM refs ----------
const setupBanner = document.getElementById("setupBanner");
const setupBannerBtn = document.getElementById("setupBannerBtn");
const openOptionsBtn = document.getElementById("openOptions");

const analyzeBtn = document.getElementById("analyzeBtn");
const reanalyzeBtn = document.getElementById("reanalyzeBtn");
const saveSheetsBtn = document.getElementById("saveSheetsBtn");
const uploadResumeBtn = document.getElementById("uploadResumeBtn");
const resumeFileInput = document.getElementById("resumeFileInput");
const resumeSourceLine = document.getElementById("resumeSourceLine");
const resumeSourceText = document.getElementById("resumeSourceText");
const clearResumeOverrideBtn = document.getElementById("clearResumeOverrideBtn");
const statusLine = document.getElementById("statusLine");

const drawerToggle = document.getElementById("drawerToggle");
const drawerBody = document.getElementById("drawerBody");
const drawerChevron = document.getElementById("drawerChevron");
const resumeQuickEdit = document.getElementById("resumeQuickEdit");
const saveResumeQuickBtn = document.getElementById("saveResumeQuick");
const resumeSavedTag = document.getElementById("resumeSavedTag");

const dashboard = document.getElementById("dashboard");
const glitterLayer = document.getElementById("glitterLayer");

const atsGauge = {
  card: document.getElementById("atsGaugeCard"),
  arc: document.getElementById("atsGaugeArc"),
  needle: document.getElementById("atsGaugeNeedle"),
  value: document.getElementById("atsScoreValue")
};
const chanceGauge = {
  card: document.getElementById("chanceGaugeCard"),
  arc: document.getElementById("chanceGaugeArc"),
  needle: document.getElementById("chanceGaugeNeedle"),
  value: document.getElementById("chanceValue")
};

const jobIdentity = document.getElementById("jobIdentity");
const jobRoleTitle = document.getElementById("jobRoleTitle");
const jobCompanyName = document.getElementById("jobCompanyName");

const goodFitList = document.getElementById("goodFitList");
const goodFitListMore = document.getElementById("goodFitListMore");
const goodFitToggle = document.getElementById("goodFitToggle");

const report = document.getElementById("report");
const emptyState = document.getElementById("emptyState");
const warningsBanner = document.getElementById("warningsBanner");

// ---------- Tab switcher ----------
const tabButtons = document.querySelectorAll(".tab-btn");
const matcherView = document.getElementById("matcherView");
const prepView = document.getElementById("prepView");

// ---------- Interview Prep DOM refs ----------
const generatePrepBtn = document.getElementById("generatePrepBtn");
const regeneratePrepBtn = document.getElementById("regeneratePrepBtn");
const prepStatusLine = document.getElementById("prepStatusLine");
const prepEmptyState = document.getElementById("prepEmptyState");
const prepDashboard = document.getElementById("prepDashboard");
const prepProgressValue = document.getElementById("prepProgressValue");
const prepProgressFill = document.getElementById("prepProgressFill");
const prepDonutSvg = document.getElementById("prepDonutSvg");
const prepDonutLegend = document.getElementById("prepDonutLegend");
const prepAreasList = document.getElementById("prepAreasList");

// ---------- State ----------
let apiKey = "";
let masterResume = "";
let sheetsWebhookUrl = "";
let lastJobText = "";
let lastJobUrl = "";
let lastCompanyGuess = "";
let lastResult = null;
let currentTabId = null;

// A resume uploaded via "Upload Resume" applies only to this tab's analyses
// and is never written to the saved master resume — see effectiveResume().
let tabResumeOverride = null;
let tabResumeFileName = "";

function effectiveResume() {
  return tabResumeOverride || masterResume;
}

function hasUsableResume() {
  return !!effectiveResume();
}

// Interview Prep is independent of the matcher above (JD-only, no resume),
// but reuses lastJobText/lastJobUrl/extractJobTextFromActiveTab() when
// available so it doesn't force a second page scrape.
let prepAreas = []; // [{ id, title, predictedRound, weightPercent, masterChecked, questionsFetched, questions: [{id,text,checked}] }]
let prepJobUrl = "";
const PREP_STATE_KEY_PREFIX = "interviewPrep:";

const TAB_STATE_KEY_PREFIX = "jobMatchState:";

// ---------- Per-tab persistence ----------
// Each tab gets its own side panel document (see background.js), so this
// module-level state is already isolated per tab. We additionally persist
// state to chrome.storage.session so it survives the browser discarding/
// reloading a hidden panel document, and restore it on load — switching back
// to a tab always shows what you last analyzed (and uploaded) there.
async function restoreTabState() {
  try {
    const tab = await chrome.tabs.getCurrent();
    currentTabId = tab?.id ?? null;
  } catch {
    currentTabId = null;
  }
  if (currentTabId == null) return;

  const key = TAB_STATE_KEY_PREFIX + currentTabId;
  const stored = await chrome.storage.session.get(key);
  const saved = stored[key];
  if (!saved) return;

  lastJobText = saved.jobText || "";
  lastJobUrl = saved.jobUrl || "";
  lastResult = saved.result || null;
  tabResumeOverride = saved.resumeOverride || null;
  tabResumeFileName = saved.resumeFileName || "";
  refreshResumeSourceLine();

  if (lastResult) {
    renderReport(lastResult);
    setStatus("Restored previous analysis for this tab.", "ok");
    reanalyzeBtn.disabled = !lastJobText;
  }
  refreshSaveSheetsButton();
}

async function persistTabSessionState() {
  if (currentTabId == null) return;
  const key = TAB_STATE_KEY_PREFIX + currentTabId;
  await chrome.storage.session.set({
    [key]: {
      result: lastResult,
      jobText: lastJobText,
      jobUrl: lastJobUrl,
      resumeOverride: tabResumeOverride,
      resumeFileName: tabResumeFileName
    }
  });
}

// ---------- Init ----------
async function init() {
  const stored = await chrome.storage.local.get(["geminiApiKey", "masterResume", "sheetsWebhookUrl"]);
  apiKey = stored.geminiApiKey || "";
  masterResume = stored.masterResume || "";
  sheetsWebhookUrl = stored.sheetsWebhookUrl || "";
  resumeQuickEdit.value = masterResume;
  // Restore per-tab state (including any uploaded-resume override) before
  // computing button states, so a tab with an override but no saved master
  // resume doesn't start with Analyze incorrectly disabled.
  await restoreTabState();
  await restorePrepStateForCurrentTab();
  refreshSetupBanner();
  refreshSaveSheetsButton();
}

function refreshSetupBanner() {
  const missing = !apiKey || !hasUsableResume();
  setupBanner.classList.toggle("hidden", !missing);
  analyzeBtn.disabled = missing;
}

function refreshResumeSourceLine() {
  if (tabResumeOverride) {
    resumeSourceText.textContent = `Using uploaded resume for this tab: ${tabResumeFileName}`;
    resumeSourceLine.classList.remove("hidden");
  } else {
    resumeSourceLine.classList.add("hidden");
  }
}

function refreshSaveSheetsButton() {
  saveSheetsBtn.classList.remove("saved");
  if (!sheetsWebhookUrl) {
    saveSheetsBtn.disabled = true;
    saveSheetsBtn.title = "Add a Google Sheets Webhook URL in Settings first.";
  } else if (!lastResult) {
    saveSheetsBtn.disabled = true;
    saveSheetsBtn.title = "Run an analysis first.";
  } else {
    saveSheetsBtn.disabled = false;
    saveSheetsBtn.title = "";
  }
}

openOptionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
setupBannerBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

// ---------- Tab switcher ----------
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
    const isPrep = btn.dataset.tab === "prep";
    matcherView.classList.toggle("hidden", isPrep);
    prepView.classList.toggle("hidden", !isPrep);
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.geminiApiKey) apiKey = changes.geminiApiKey.newValue || "";
  if (changes.sheetsWebhookUrl) sheetsWebhookUrl = changes.sheetsWebhookUrl.newValue || "";
  if (changes.masterResume) {
    masterResume = changes.masterResume.newValue || "";
    if (document.activeElement !== resumeQuickEdit) resumeQuickEdit.value = masterResume;
  }
  refreshSetupBanner();
  refreshSaveSheetsButton();
});

// ---------- Drawer ----------
drawerToggle.addEventListener("click", () => {
  const isHidden = drawerBody.classList.toggle("hidden");
  drawerChevron.textContent = isHidden ? "▾" : "▴";
});

saveResumeQuickBtn.addEventListener("click", async () => {
  const value = resumeQuickEdit.value.trim();
  if (!value) return;
  masterResume = value;
  await chrome.storage.local.set({ masterResume: value });
  resumeSavedTag.classList.remove("hidden");
  setTimeout(() => resumeSavedTag.classList.add("hidden"), 1800);
  refreshSetupBanner();
});

// ---------- Per-job resume upload (PDF/DOCX) ----------
// Overrides masterResume for this tab only, per effectiveResume() — never
// written to chrome.storage.local, so your saved master resume is untouched.
uploadResumeBtn.addEventListener("click", () => resumeFileInput.click());

resumeFileInput.addEventListener("change", async () => {
  const file = resumeFileInput.files?.[0];
  resumeFileInput.value = ""; // allow re-selecting the same file later
  if (!file) return;

  uploadResumeBtn.disabled = true;
  setStatus(`Reading ${file.name}...`);
  try {
    const { parseResumeFile } = await import(chrome.runtime.getURL("sidepanel/resumeParser.js"));
    const text = await parseResumeFile(file);
    tabResumeOverride = text;
    tabResumeFileName = file.name;
    await persistTabSessionState();
    refreshResumeSourceLine();
    refreshSetupBanner();
    setStatus(`Using ${file.name} as the resume for this tab only.`, "ok");
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Couldn't read that file.", "err");
  } finally {
    uploadResumeBtn.disabled = false;
  }
});

clearResumeOverrideBtn.addEventListener("click", async () => {
  tabResumeOverride = null;
  tabResumeFileName = "";
  await persistTabSessionState();
  refreshResumeSourceLine();
  refreshSetupBanner();
  setStatus("Switched back to your master resume for this tab.", "ok");
});

// ---------- Status helpers ----------
function setStatus(message, kind) {
  statusLine.textContent = message || "";
  statusLine.classList.remove("err", "ok");
  if (kind) statusLine.classList.add(kind);
}

function setBusy(isBusy, label) {
  analyzeBtn.disabled = isBusy || !apiKey || !hasUsableResume();
  reanalyzeBtn.disabled = isBusy || !lastJobText;
  if (isBusy) setStatus(label || "Working...");
}

// ---------- Content extraction ----------
async function extractJobTextFromActiveTab() {
  // Prefer the tab this panel is actually bound to (each tab has its own panel
  // instance — see background.js) over whatever tab happens to be frontmost,
  // so an analysis kicked off here still targets the right page even if the
  // user has since switched to another tab.
  let tab;
  if (currentTabId != null) {
    tab = await chrome.tabs.get(currentTabId).catch(() => null);
  }
  if (!tab) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  if (!tab || !tab.id) throw new Error("No active tab found.");
  if (!/^https?:\/\//.test(tab.url || "")) {
    throw new Error("Open a job posting in this tab first.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const listener = (message, sender) => {
      if (message?.type === "JOB_MATCH_AI_EXTRACTED_TEXT" && sender.tab?.id === tab.id) {
        settled = true;
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ text: message.text || "", company: message.company || "", url: message.url || tab.url || "" });
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ["content/content.js"] })
      .catch((err) => {
        chrome.runtime.onMessage.removeListener(listener);
        reject(new Error(`Could not read this page: ${err.message}`));
      });

    setTimeout(() => {
      if (!settled) {
        chrome.runtime.onMessage.removeListener(listener);
        reject(new Error("Timed out reading the page content."));
      }
    }, 8000);
  });
}

// ---------- Gemini call ----------
function isRetryableStatus(httpStatus) {
  // 503 = model overloaded (Google-side capacity, not your quota).
  // 429 = this model's quota is exhausted. Both are worth trying a different model for.
  return httpStatus === 503 || httpStatus === 429;
}

async function callGeminiModel(model, systemPrompt, userPrompt, schema) {
  const response = await fetch(`${geminiUrlFor(model)}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json",
        responseSchema: schema
      }
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const err = new Error(data?.error?.message || `Gemini request failed (HTTP ${response.status}).`);
    err.httpStatus = response.status;
    throw err;
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!rawText) {
    const blockReason = data?.promptFeedback?.blockReason;
    throw new Error(blockReason ? `Gemini blocked the request: ${blockReason}` : "Gemini returned an empty response.");
  }

  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error("Gemini returned malformed JSON.");
  }
}

// Shared by Resume Matcher and Interview Prep — both just supply their own
// system prompt/schema and get the same busy-model fallback chain for free.
async function callGeminiWithFallback(systemPrompt, userPrompt, schema, onModelSwitch) {
  let lastErr;
  for (let i = 0; i < GEMINI_MODEL_CHAIN.length; i++) {
    const model = GEMINI_MODEL_CHAIN[i];
    if (i > 0) onModelSwitch?.(model);
    try {
      return await callGeminiModel(model, systemPrompt, userPrompt, schema);
    } catch (err) {
      lastErr = err;
      const isLastModel = i === GEMINI_MODEL_CHAIN.length - 1;
      if (!isRetryableStatus(err.httpStatus) || isLastModel) throw err;
    }
  }
  throw lastErr;
}

async function analyzeWithGemini(jobText, onModelSwitch) {
  const userPrompt = `MASTER RESUME:\n"""\n${effectiveResume()}\n"""\n\nJOB DESCRIPTION:\n"""\n${jobText}\n"""`;
  return callGeminiWithFallback(SYSTEM_PROMPT, userPrompt, RESPONSE_SCHEMA, onModelSwitch);
}

// ---------- Rendering ----------
function clampScore(n) {
  const num = Number(n);
  if (Number.isNaN(num)) return 0;
  // Defensive normalization: despite explicit prompt/schema instructions, the
  // model can still occasionally return a 0-1 probability instead of a 0-100
  // percentage. A non-integer strictly between 0 and 1 is a strong signal of
  // that — a genuine percentage score essentially never lands as e.g. 0.65.
  const normalized = num > 0 && num < 1 ? num * 100 : num;
  return Math.max(0, Math.min(100, normalized));
}

for (const gauge of [atsGauge, chanceGauge]) {
  const length = gauge.arc.getTotalLength();
  gauge.arcLength = length;
  gauge.arc.style.strokeDasharray = String(length);
  gauge.arc.style.strokeDashoffset = String(length);
}

const CELEBRATE_THRESHOLD = 80;
const GLITTER_EMOJI = ["✨", "⭐", "🌟", "💫"];

function renderGaugeInto(gauge, score) {
  const clamped = clampScore(score);
  const offset = gauge.arcLength - (clamped / 100) * gauge.arcLength;
  const angle = -90 + (clamped / 100) * 180;

  requestAnimationFrame(() => {
    gauge.arc.style.strokeDashoffset = String(offset);
    gauge.needle.style.transform = `rotate(${angle}deg)`;
  });

  gauge.value.textContent = `${Math.round(clamped)}%`;
  gauge.value.classList.remove("glow-red", "glow-yellow", "glow-green");

  let colorVar = "var(--red)";
  let glowClass = "glow-red";
  if (clamped > 75) {
    colorVar = "var(--green)";
    glowClass = "glow-green";
  } else if (clamped >= 50) {
    colorVar = "var(--yellow)";
    glowClass = "glow-yellow";
  }
  gauge.arc.style.stroke = colorVar;
  gauge.value.classList.add(glowClass);
  gauge.card.classList.toggle("celebrate", clamped >= CELEBRATE_THRESHOLD);

  return clamped;
}

function spawnGlitterBurst() {
  glitterLayer.innerHTML = "";
  const pieceCount = 36;
  for (let i = 0; i < pieceCount; i++) {
    const span = document.createElement("span");
    span.className = "glitter-piece";
    span.textContent = GLITTER_EMOJI[Math.floor(Math.random() * GLITTER_EMOJI.length)];

    const angle = Math.random() * Math.PI * 2;
    const distance = 70 + Math.random() * 140;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance - 40;

    span.style.setProperty("--gp-dx", `${dx}px`);
    span.style.setProperty("--gp-dy", `${dy}px`);
    span.style.setProperty("--gp-rot", `${Math.random() * 360 - 180}deg`);
    span.style.setProperty("--gp-size", `${10 + Math.random() * 12}px`);
    span.style.setProperty("--gp-delay", `${Math.random() * 0.4}s`);

    glitterLayer.appendChild(span);
  }
  setTimeout(() => {
    glitterLayer.innerHTML = "";
  }, 2200);
}

function renderDashboard(atsScore, chanceScore) {
  const clampedAts = renderGaugeInto(atsGauge, atsScore);
  const clampedChance = renderGaugeInto(chanceGauge, chanceScore);

  const shouldCelebrate = clampedAts >= CELEBRATE_THRESHOLD || clampedChance >= CELEBRATE_THRESHOLD;
  dashboard.classList.toggle("celebrate", shouldCelebrate);
  if (shouldCelebrate) spawnGlitterBurst();
}

function fillList(el, items, emptyText) {
  el.innerHTML = "";
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (values.length === 0) {
    const li = document.createElement("li");
    li.textContent = emptyText || "None noted.";
    el.appendChild(li);
    return;
  }
  for (const item of values) {
    const li = document.createElement("li");
    li.textContent = item;
    el.appendChild(li);
  }
}

function fillPills(el, items, className) {
  el.innerHTML = "";
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (values.length === 0) {
    const span = document.createElement("span");
    span.className = "pill";
    span.textContent = "None";
    el.appendChild(span);
    return;
  }
  for (const item of values) {
    const span = document.createElement("span");
    span.className = `pill ${className}`;
    span.textContent = item;
    el.appendChild(span);
  }
}

function fillTechGapTable(rows) {
  const tbody = document.getElementById("techGapTableBody");
  tbody.innerHTML = "";
  const values = Array.isArray(rows) ? rows : [];
  if (values.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = "No significant technical gaps found.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  for (const row of values) {
    const tr = document.createElement("tr");

    const techTd = document.createElement("td");
    techTd.textContent = row.technology || "—";

    const contextTd = document.createElement("td");
    contextTd.textContent = row.context || "—";

    const sevTd = document.createElement("td");
    const badge = document.createElement("span");
    const severity = (row.severity || "Low").toString();
    badge.className = `severity-badge ${severity.toLowerCase()}`;
    badge.textContent = severity;
    sevTd.appendChild(badge);

    tr.append(techTd, contextTd, sevTd);
    tbody.appendChild(tr);
  }
}

function fillGoodFit(items) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  const first = values.slice(0, 5);
  const rest = values.slice(5);

  fillList(goodFitList, first, "No specific reasons provided.");

  goodFitListMore.innerHTML = "";
  for (const item of rest) {
    const li = document.createElement("li");
    li.textContent = item;
    goodFitListMore.appendChild(li);
  }
  goodFitListMore.setAttribute("start", String(first.length + 1));
  goodFitListMore.classList.add("hidden");

  const hasMore = rest.length > 0;
  goodFitToggle.classList.toggle("hidden", !hasMore);
  goodFitToggle.textContent = `Show ${rest.length} more ▾`;
  goodFitToggle.setAttribute("aria-expanded", "false");
}

goodFitToggle.addEventListener("click", () => {
  const nowHidden = goodFitListMore.classList.toggle("hidden");
  goodFitToggle.textContent = nowHidden ? `Show ${goodFitListMore.children.length} more ▾` : "Show less ▴";
  goodFitToggle.setAttribute("aria-expanded", String(!nowHidden));
});

// Every report section collapses/expands independently via its header —
// delegated so it works uniformly across all of them without per-block wiring.
report.addEventListener("click", (e) => {
  const toggle = e.target.closest(".block-toggle");
  if (!toggle) return;
  const block = toggle.closest(".report-block");
  const collapsed = block.classList.toggle("collapsed");
  toggle.setAttribute("aria-expanded", String(!collapsed));
});

function renderWarnings(warnings) {
  warningsBanner.innerHTML = "";
  const languageBarrier = warnings?.language_barrier || "";
  const visaConcern = warnings?.visa_sponsorship_concern || "";

  if (languageBarrier) {
    const chip = document.createElement("div");
    chip.className = "warning-chip danger";
    chip.innerHTML = '<span class="warning-icon">⛔</span><span></span>';
    chip.lastElementChild.textContent = `Language barrier — ${languageBarrier} Chance set to 0%.`;
    warningsBanner.appendChild(chip);
  }
  if (visaConcern) {
    const chip = document.createElement("div");
    chip.className = "warning-chip caution";
    chip.innerHTML = '<span class="warning-icon">⚠️</span><span></span>';
    chip.lastElementChild.textContent = `Visa/relocation notice — ${visaConcern}`;
    warningsBanner.appendChild(chip);
  }

  warningsBanner.classList.toggle("hidden", !languageBarrier && !visaConcern);
}

function renderReport(result) {
  jobRoleTitle.textContent = result.job_title || "Role title unavailable";
  jobCompanyName.textContent = result.company_name || "Company unavailable";
  jobIdentity.classList.remove("hidden");

  renderWarnings(result.warnings);

  // Deterministic override, not just a prompt instruction: a mandatory
  // language the candidate doesn't speak always zeroes the chance score,
  // regardless of what the model returned.
  const chanceScore = result.warnings?.language_barrier ? 0 : result.chance_of_getting_job;
  renderDashboard(result.ats_score, chanceScore);

  fillPills(document.getElementById("missingSkillsList"), result.missing_skills, "missing");

  fillPills(document.getElementById("addSkillsList"), result.resume_optimization?.add_skills, "add");
  fillPills(document.getElementById("removeSkillsList"), result.resume_optimization?.remove_skills, "remove");

  fillList(document.getElementById("standsOutList"), result.stage_1_attention_test?.stands_out);
  fillList(document.getElementById("forgettableList"), result.stage_1_attention_test?.forgettable);

  fillList(document.getElementById("weakAreasList"), result.stage_2_mindset_breakdown?.weak_areas);
  fillList(document.getElementById("credibilityGapsList"), result.stage_2_mindset_breakdown?.credibility_gaps);

  fillTechGapTable(result.stage_3_tech_gap_table);

  fillGoodFit(result.why_good_fit);

  const prep = result.role_prep || {};
  fillList(document.getElementById("problemSolvedList"), prep.problem_solved, "Not enough information found.");
  fillList(document.getElementById("expectationsList"), prep.expectations, "Not enough information found.");
  fillList(document.getElementById("focusAreasList"), prep.focus_areas, "Not enough information found.");
  fillPills(document.getElementById("interviewKeywordsList"), prep.interview_keywords, "keyword");

  const insights = result.company_insights || {};
  document.getElementById("companyEmployees").textContent = insights.employee_count || "Unknown";
  document.getElementById("companyYears").textContent = insights.years_in_market || "Unknown";
  document.getElementById("companyGlassdoor").textContent = insights.glassdoor_rating || "Unknown";
  fillList(document.getElementById("companyCoreBusinessList"), insights.core_business, "Not enough information found.");
  fillList(document.getElementById("companyInterviewList"), insights.interview_process, "Not enough information found.");
  fillList(document.getElementById("companyEnvironmentList"), insights.work_environment, "Not enough information found.");
  document.getElementById("companyConfidenceNote").textContent =
    insights.confidence_note || "AI-generated estimate — verify current details on Glassdoor/LinkedIn.";

  report.classList.remove("hidden");
  emptyState.classList.add("hidden");
}

// ---------- Actions ----------
async function runAnalysis({ reextract }) {
  if (!apiKey || !hasUsableResume()) {
    setStatus("Add your API key and resume in Settings first.", "err");
    chrome.runtime.openOptionsPage();
    return;
  }

  try {
    const willReextract = reextract || !lastJobText;
    setBusy(true, willReextract ? "Reading the page..." : "Re-analyzing with updated resume...");

    if (willReextract) {
      const extracted = await extractJobTextFromActiveTab();
      lastJobText = extracted.text;
      lastCompanyGuess = extracted.company;
      lastJobUrl = extracted.url;
    }

    if (!lastJobText || lastJobText.length < 50) {
      throw new Error("Couldn't find enough job description text on this page.");
    }

    setStatus(lastCompanyGuess ? `Asking Gemini about ${lastCompanyGuess} for analysis...` : "Asking Gemini for analysis...");
    const result = await analyzeWithGemini(lastJobText, (nextModel) => {
      setStatus(`Busy — switching to ${nextModel} and retrying...`);
    });

    renderReport(result);
    lastResult = result;
    setStatus("Analysis complete.", "ok");
    await persistTabSessionState();
  } catch (err) {
    console.error(err);
    const message = isRetryableStatus(err.httpStatus)
      ? "All models are busy or over quota right now. This is temporary on Google's side — try again in a few minutes."
      : err.message || "Something went wrong.";
    setStatus(message, "err");
  } finally {
    setBusy(false);
    reanalyzeBtn.disabled = !lastJobText;
    refreshSaveSheetsButton();
  }
}

// ---------- Save to Google Sheets ----------
async function saveResultToSheets() {
  if (!sheetsWebhookUrl || !lastResult) return;

  const payload = {
    date: new Date().toISOString().slice(0, 10),
    companyName: lastResult.company_name || "",
    jobTitle: lastResult.job_title || "",
    atsScore: Math.round(clampScore(lastResult.ats_score)),
    interviewChance: Math.round(clampScore(lastResult.chance_of_getting_job)),
    missingSkills: Array.isArray(lastResult.missing_skills) ? lastResult.missing_skills.join(", ") : "",
    jobUrl: lastJobUrl || ""
  };

  saveSheetsBtn.disabled = true;
  saveSheetsBtn.classList.remove("saved");
  saveSheetsBtn.textContent = "Saving...";

  try {
    // Apps Script Web Apps are notoriously CORS-unfriendly for anything but
    // simple requests, and their response often can't be read back from a
    // cross-origin fetch even when the row was appended successfully. Using
    // no-cors + text/plain sidesteps the preflight entirely; we treat a
    // fetch that doesn't throw as "delivered" since we can't inspect the
    // (opaque) response either way.
    await fetch(sheetsWebhookUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    saveSheetsBtn.textContent = "✓ Saved to Google Sheets";
    saveSheetsBtn.classList.add("saved");
    setStatus("Sent to Google Sheets — check your sheet to confirm the row landed.", "ok");
  } catch (err) {
    console.error(err);
    saveSheetsBtn.textContent = "💾 Save to Google Sheets";
    setStatus("Couldn't reach the Sheets webhook — check the URL in Settings.", "err");
  } finally {
    setTimeout(() => {
      saveSheetsBtn.textContent = "💾 Save to Google Sheets";
      refreshSaveSheetsButton();
    }, 2500);
  }
}

// ---------- Interview Prep ----------
function slugify(text, index) {
  const base = (text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return base ? `${base}-${index}` : `area-${index}`;
}

// Gemini's weight_percent values won't always sum to exactly 100 (rounding
// drift) — the donut chart needs an exact 100 to draw closed, gap-free
// segments, so we rescale proportionally rather than trusting raw output.
function normalizeAreas(rawAreas) {
  const mapped = (Array.isArray(rawAreas) ? rawAreas : []).map((a, i) => ({
    id: slugify(a.title, i),
    title: a.title || `Area ${i + 1}`,
    predictedRound: a.predicted_round || "",
    weightPercent: Math.max(0, Number(a.weight_percent) || 0),
    masterChecked: false,
    questionsFetched: false,
    questions: []
  }));

  const sum = mapped.reduce((s, a) => s + a.weightPercent, 0);
  if (sum > 0 && mapped.length > 0) {
    let running = 0;
    mapped.forEach((a, i) => {
      if (i === mapped.length - 1) {
        a.weightPercent = 100 - running;
      } else {
        a.weightPercent = Math.round((a.weightPercent / sum) * 100);
        running += a.weightPercent;
      }
    });
  }
  return mapped;
}

function prepStorageKey(url) {
  return PREP_STATE_KEY_PREFIX + url;
}

async function loadPrepStateForUrl(url) {
  if (!url) return null;
  const key = prepStorageKey(url);
  const stored = await chrome.storage.local.get(key);
  return stored[key] || null;
}

async function savePrepState() {
  if (!prepJobUrl) return;
  await chrome.storage.local.set({
    [prepStorageKey(prepJobUrl)]: { areas: prepAreas, savedAt: Date.now() }
  });
}

function setPrepStatus(message, kind) {
  prepStatusLine.textContent = message || "";
  prepStatusLine.classList.remove("err", "ok");
  if (kind) prepStatusLine.classList.add(kind);
}

function setPrepBusy(isBusy, label) {
  generatePrepBtn.disabled = isBusy || !apiKey;
  regeneratePrepBtn.disabled = isBusy || !apiKey;
  if (isBusy) setPrepStatus(label || "Working...");
}

function computePrepProgress() {
  if (prepAreas.length === 0) return 0;
  let total = 0;
  for (const area of prepAreas) {
    let ratio;
    if (area.masterChecked) {
      ratio = 1;
    } else if (area.questionsFetched && area.questions.length > 0) {
      ratio = area.questions.filter((q) => q.checked).length / area.questions.length;
    } else {
      ratio = 0;
    }
    total += (area.weightPercent / 100) * ratio;
  }
  return Math.round(Math.max(0, Math.min(100, total * 100)));
}

function renderPrepProgress() {
  const pct = computePrepProgress();
  prepProgressFill.style.width = `${pct}%`;
  prepProgressValue.textContent = `${pct}%`;
}

function renderPrepDonut(areas) {
  const svgNs = "http://www.w3.org/2000/svg";
  prepDonutSvg.innerHTML = "";
  const cx = 60;
  const cy = 60;
  const r = 45;
  const strokeWidth = 16;
  const circumference = 2 * Math.PI * r;

  const bg = document.createElementNS(svgNs, "circle");
  bg.setAttribute("cx", cx);
  bg.setAttribute("cy", cy);
  bg.setAttribute("r", r);
  bg.setAttribute("fill", "none");
  bg.setAttribute("stroke", "#262a45");
  bg.setAttribute("stroke-width", strokeWidth);
  prepDonutSvg.appendChild(bg);

  let cumulative = 0;
  areas.forEach((area, i) => {
    const dash = (area.weightPercent / 100) * circumference;
    const circle = document.createElementNS(svgNs, "circle");
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", cy);
    circle.setAttribute("r", r);
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", PREP_AREA_COLORS[i % PREP_AREA_COLORS.length]);
    circle.setAttribute("stroke-width", strokeWidth);
    circle.setAttribute("stroke-dasharray", `${dash} ${circumference - dash}`);
    circle.setAttribute("stroke-dashoffset", String(-cumulative));
    circle.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
    circle.classList.add("prep-donut-segment");
    prepDonutSvg.appendChild(circle);
    cumulative += dash;
  });
}

function renderPrepDonutLegend(areas) {
  prepDonutLegend.innerHTML = "";
  areas.forEach((area, i) => {
    const row = document.createElement("div");
    row.className = "prep-legend-row";
    const swatch = document.createElement("span");
    swatch.className = "prep-legend-swatch";
    swatch.style.background = PREP_AREA_COLORS[i % PREP_AREA_COLORS.length];
    const label = document.createElement("span");
    label.textContent = `${area.title} — ${area.weightPercent}%`;
    row.append(swatch, label);
    prepDonutLegend.appendChild(row);
  });
}

function renderQuestionsList(area, listEl, masterCheckboxEl) {
  listEl.innerHTML = "";
  area.questions.forEach((q) => {
    const li = document.createElement("li");
    li.className = "prep-question-row" + (q.checked ? " checked" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = q.checked;

    const span = document.createElement("span");
    span.textContent = q.text;

    li.append(checkbox, span);
    listEl.appendChild(li);

    checkbox.addEventListener("change", () => {
      toggleQuestion(area, q, checkbox.checked, li, masterCheckboxEl);
    });
    li.addEventListener("click", (e) => {
      if (e.target === checkbox) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change"));
    });
  });
}

function toggleQuestion(area, question, checked, liEl, masterCheckboxEl) {
  question.checked = checked;
  liEl.classList.toggle("checked", checked);
  area.masterChecked = area.questions.length > 0 && area.questions.every((q) => q.checked);
  if (masterCheckboxEl) masterCheckboxEl.checked = area.masterChecked;
  renderPrepProgress();
  savePrepState();
}

function toggleAreaMaster(area, checked, questionsListEl) {
  area.masterChecked = checked;
  area.questions.forEach((q) => {
    q.checked = checked;
  });
  questionsListEl.querySelectorAll(".prep-question-row").forEach((row) => {
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = checked;
    row.classList.toggle("checked", checked);
  });
  renderPrepProgress();
  savePrepState();
}

async function fetchAreaQuestions(area, els) {
  const { fetchBtn, statusEl, questionsListEl, masterCheckbox } = els;
  if (!apiKey) {
    setPrepStatus("Add your Gemini API key in Settings first.", "err");
    chrome.runtime.openOptionsPage();
    return;
  }
  if (!lastJobText) {
    statusEl.textContent = "Job description unavailable — regenerate interview prep first.";
    statusEl.classList.add("err");
    return;
  }

  fetchBtn.disabled = true;
  statusEl.classList.remove("err");
  statusEl.textContent = "Fetching questions...";

  try {
    const userPrompt = `JOB DESCRIPTION:\n"""\n${lastJobText}\n"""\n\nINTERVIEW AREA: ${area.title} (${area.predictedRound})`;
    const result = await callGeminiWithFallback(
      PREP_QUESTIONS_SYSTEM_PROMPT,
      userPrompt,
      PREP_QUESTIONS_SCHEMA,
      (model) => {
        statusEl.textContent = `Busy — switching to ${model} and retrying...`;
      }
    );

    const questions = Array.isArray(result.questions) ? result.questions.filter(Boolean) : [];
    area.questions = questions.map((text, i) => ({ id: `${area.id}-q${i}`, text, checked: area.masterChecked }));
    area.questionsFetched = true;

    renderQuestionsList(area, questionsListEl, masterCheckbox);
    fetchBtn.textContent = "🔄 Refetch Questions";
    statusEl.textContent = "";
    renderPrepProgress();
    await savePrepState();
  } catch (err) {
    console.error(err);
    statusEl.textContent = err.message || "Couldn't fetch questions.";
    statusEl.classList.add("err");
  } finally {
    fetchBtn.disabled = false;
  }
}

function buildAreaCard(area, index) {
  const colorClass = PREP_AREA_CLASS[index % PREP_AREA_CLASS.length];

  const card = document.createElement("div");
  card.className = `prep-area-card ${colorClass}`;

  const header = document.createElement("div");
  header.className = "prep-area-header";

  const label = document.createElement("label");
  label.className = "prep-checkbox-label";

  const masterCheckbox = document.createElement("input");
  masterCheckbox.type = "checkbox";
  masterCheckbox.checked = area.masterChecked;

  const titleGroup = document.createElement("span");
  titleGroup.className = "prep-area-title-group";
  const titleEl = document.createElement("span");
  titleEl.className = "prep-area-title";
  titleEl.textContent = area.title;
  const roundEl = document.createElement("span");
  roundEl.className = "prep-area-round";
  roundEl.textContent = area.predictedRound;
  titleGroup.append(titleEl, roundEl);

  label.append(masterCheckbox, titleGroup);

  const weightBadge = document.createElement("span");
  weightBadge.className = "prep-area-weight";
  weightBadge.textContent = `${area.weightPercent}%`;

  const chevronBtn = document.createElement("button");
  chevronBtn.type = "button";
  chevronBtn.className = "prep-area-chevron";
  chevronBtn.textContent = "▾";
  chevronBtn.setAttribute("aria-expanded", "true");

  header.append(label, weightBadge, chevronBtn);

  const body = document.createElement("div");
  body.className = "prep-area-body";

  const fetchBtn = document.createElement("button");
  fetchBtn.type = "button";
  fetchBtn.className = "secondary-btn small";
  fetchBtn.textContent = area.questionsFetched ? "🔄 Refetch Questions" : "Fetch Deep-Dive Questions";

  const statusEl = document.createElement("div");
  statusEl.className = "prep-questions-status";

  const questionsListEl = document.createElement("ul");
  questionsListEl.className = "prep-questions-list";

  body.append(fetchBtn, statusEl, questionsListEl);
  card.append(header, body);

  chevronBtn.addEventListener("click", () => {
    const collapsed = card.classList.toggle("collapsed");
    chevronBtn.setAttribute("aria-expanded", String(!collapsed));
  });

  masterCheckbox.addEventListener("change", () => {
    toggleAreaMaster(area, masterCheckbox.checked, questionsListEl);
  });

  fetchBtn.addEventListener("click", () => {
    fetchAreaQuestions(area, { fetchBtn, statusEl, questionsListEl, masterCheckbox });
  });

  if (area.questionsFetched) {
    renderQuestionsList(area, questionsListEl, masterCheckbox);
  }

  return card;
}

function renderPrepAreas() {
  prepAreasList.innerHTML = "";
  prepAreas.forEach((area, i) => {
    prepAreasList.appendChild(buildAreaCard(area, i));
  });

  const hasAreas = prepAreas.length > 0;
  renderPrepDonut(prepAreas);
  renderPrepDonutLegend(prepAreas);
  renderPrepProgress();
  prepDashboard.classList.toggle("hidden", !hasAreas);
  prepEmptyState.classList.toggle("hidden", hasAreas);
  generatePrepBtn.classList.toggle("hidden", hasAreas);
  regeneratePrepBtn.classList.toggle("hidden", !hasAreas);
}

async function runGeneratePrep({ forceRegenerate } = {}) {
  if (!apiKey) {
    setPrepStatus("Add your Gemini API key in Settings first.", "err");
    chrome.runtime.openOptionsPage();
    return;
  }

  try {
    setPrepBusy(true, lastJobText ? "Predicting interview focus areas..." : "Reading the page...");

    if (!lastJobText) {
      const extracted = await extractJobTextFromActiveTab();
      lastJobText = extracted.text;
      lastJobUrl = extracted.url;
      lastCompanyGuess = extracted.company;
    }
    if (!lastJobText || lastJobText.length < 50) {
      throw new Error("Couldn't find enough job description text on this page.");
    }

    if (!forceRegenerate) {
      const existing = await loadPrepStateForUrl(lastJobUrl);
      if (existing?.areas?.length) {
        prepJobUrl = lastJobUrl;
        prepAreas = existing.areas;
        renderPrepAreas();
        setPrepStatus("Restored your saved interview prep for this job.", "ok");
        return;
      }
    }

    setPrepStatus("Predicting interview focus areas...");
    const userPrompt = `JOB DESCRIPTION:\n"""\n${lastJobText}\n"""`;
    const result = await callGeminiWithFallback(
      PREP_OVERVIEW_SYSTEM_PROMPT,
      userPrompt,
      PREP_OVERVIEW_SCHEMA,
      (model) => setPrepStatus(`Busy — switching to ${model} and retrying...`)
    );

    prepJobUrl = lastJobUrl;
    prepAreas = normalizeAreas(result.areas);
    renderPrepAreas();
    await savePrepState();
    setPrepStatus("Interview prep generated.", "ok");
  } catch (err) {
    console.error(err);
    const message = isRetryableStatus(err.httpStatus)
      ? "All models are busy or over quota right now. This is temporary on Google's side — try again in a few minutes."
      : err.message || "Something went wrong.";
    setPrepStatus(message, "err");
  } finally {
    setPrepBusy(false);
  }
}

// Auto-restore any saved interview prep for the current tab's URL on load,
// so switching to this tab shows prior progress without re-generating.
async function restorePrepStateForCurrentTab() {
  if (currentTabId == null) return;
  const tab = await chrome.tabs.get(currentTabId).catch(() => null);
  const url = tab?.url || "";
  if (!url) return;

  const existing = await loadPrepStateForUrl(url);
  if (existing?.areas?.length) {
    prepJobUrl = url;
    prepAreas = existing.areas;
    renderPrepAreas();
  }
}

generatePrepBtn.addEventListener("click", () => runGeneratePrep());
regeneratePrepBtn.addEventListener("click", () => runGeneratePrep({ forceRegenerate: true }));

analyzeBtn.addEventListener("click", () => runAnalysis({ reextract: true }));
reanalyzeBtn.addEventListener("click", () => runAnalysis({ reextract: false }));
saveSheetsBtn.addEventListener("click", saveResultToSheets);

init();
