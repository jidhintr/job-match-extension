// Ordered cascade, top-tier first. Every Gemini operation (resume matching,
// question generation, master consolidation) walks this list and drops to the
// next model on any transient failure. Google churns model availability often,
// so we keep the list intentionally current and retryable: any 404/400/429/503,
// timeout, or text such as "model is no longer available" simply skips to the
// next tier instead of dead-ending the whole call.
const GEMINI_MODELS = [
  "gemini-3.1-flash-lite", // Most daily headroom on the free tier — try first
  "gemini-2.5-flash",      // Balanced workhorse, some headroom
  "gemini-2.5-flash-lite", // Lightweight fallback, some headroom
  "gemini-3.5-flash"       // Highest quality but tightest daily cap — last resort
];

const GEMINI_CALL_TIMEOUT_MS = 10000;

function geminiUrlFor(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

// Each optional Resume Matcher report section: its prompt step (renumbered
// dynamically after the 3 always-on core steps) and its schema slice. Only
// sections the user has enabled in Settings get included in the prompt AND
// the response schema — a disabled section costs zero output tokens since
// Gemini is never asked for it at all, not just hidden client-side.
const RESUME_SECTIONS = [
  {
    id: "missing_skills",
    label: "Missing Skills",
    blockId: "missingSkillsBlock",
    promptStep: "Identify skills/keywords present in the job description but missing or weak in the resume (missing_skills).",
    schema: { missing_skills: { type: "ARRAY", items: { type: "STRING" } } }
  },
  {
    id: "resume_optimization",
    label: "Resume Optimization",
    blockId: "resumeOptimizationBlock",
    promptStep: "Resume Optimization: concrete skills/keywords to add, and outdated/irrelevant skills to consider removing.",
    schema: {
      resume_optimization: {
        type: "OBJECT",
        properties: {
          add_skills: { type: "ARRAY", items: { type: "STRING" } },
          remove_skills: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["add_skills", "remove_skills"]
      }
    }
  },
  {
    id: "stage_1_attention_test",
    label: "Stage 1 — Attention Test",
    blockId: "stage1Block",
    promptStep: "Stage 1 — Attention Test: imagine a recruiter scanning the resume for 6 seconds. What immediately stands out as impressive/relevant, and what is forgettable/generic?",
    schema: {
      stage_1_attention_test: {
        type: "OBJECT",
        properties: {
          stands_out: { type: "ARRAY", items: { type: "STRING" } },
          forgettable: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["stands_out", "forgettable"]
      }
    }
  },
  {
    id: "stage_2_mindset_breakdown",
    label: "Stage 2 — Mindset Breakdown",
    blockId: "stage2Block",
    promptStep: "Stage 2 — Mindset Breakdown: identify weak areas in how the resume is framed for this role, and any credibility gaps (unverifiable or vague claims).",
    schema: {
      stage_2_mindset_breakdown: {
        type: "OBJECT",
        properties: {
          weak_areas: { type: "ARRAY", items: { type: "STRING" } },
          credibility_gaps: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["weak_areas", "credibility_gaps"]
      }
    }
  },
  {
    id: "stage_3_tech_gap_table",
    label: "Stage 3 — Tech Gap Table",
    blockId: "stage3Block",
    promptStep: "Stage 3 — Technical Gap Table: list specific technologies/requirements from the job description, the context in which they're required, and how severe the gap is in the resume (High, Med, or Low).",
    schema: {
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
      }
    }
  },
  {
    id: "why_good_fit",
    label: "Why You're a Good Fit",
    blockId: "goodFitBlock",
    promptStep: "List exactly 10 concise, specific bullet points explaining why this candidate IS a good fit for the role (why_good_fit), ordered strongest-first since only the top 5 are shown by default. Always return exactly 10 items, even if you must include reasonably inferred strengths.",
    schema: { why_good_fit: { type: "ARRAY", items: { type: "STRING" } } }
  },
  {
    id: "role_prep",
    label: "Interview & Role Prep",
    blockId: "rolePrepBlock",
    promptStep: 'Role Prep: problem_solved (short bullets on the underlying business problem this role exists to solve), expectations (short bullets on what success in the first 3-6 months looks like / what the hiring manager expects), focus_areas (short bullets on what the candidate should personally brush up on before interviewing, based on their specific resume gaps against this posting), interview_keywords (5-12 specific technical/domain terms and phrases from the job description the candidate should naturally work into interview answers).',
    schema: {
      role_prep: {
        type: "OBJECT",
        properties: {
          problem_solved: { type: "ARRAY", items: { type: "STRING" } },
          expectations: { type: "ARRAY", items: { type: "STRING" } },
          focus_areas: { type: "ARRAY", items: { type: "STRING" } },
          interview_keywords: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["problem_solved", "expectations", "focus_areas", "interview_keywords"]
      }
    }
  },
  {
    id: "company_insights",
    label: "Company Insights",
    blockId: "companyInsightsBlock",
    promptStep: 'Company Insights: using your general knowledge of the company named in or inferable from the job description, summarize: core_business (what the company actually does, as short bullet points), employee_count (a rough headcount range, or "Not publicly known" if you cannot recall one), years_in_market (founding year and approximate age, or "Not publicly known"), interview_process (typical interview stages reported by candidates, e.g. on Glassdoor, as short bullet points, or a single item stating this isn\'t reliably known), work_environment (short bullet points on culture/pace/remote policy if known), glassdoor_rating (an approximate rating out of 5 if you recall one, or "Not publicly known"), and confidence_note (one honest sentence stating whether this is well-known public information, a rough estimate, or largely unknown — and recommending the candidate verify current figures directly on Glassdoor/LinkedIn before relying on them). Never invent precise statistics you are not reasonably confident about — prefer honest ranges or "Not publicly known" over fabricated precision.',
    schema: {
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
    }
  }
];

const DEFAULT_SECTION_ORDER = RESUME_SECTIONS.map((s) => ({ id: s.id, enabled: true }));

function buildAnalysisPromptAndSchema(sectionOrder) {
  const enabledIds = (sectionOrder || DEFAULT_SECTION_ORDER).filter((s) => s.enabled).map((s) => s.id);
  const enabledSections = RESUME_SECTIONS.filter((s) => enabledIds.includes(s.id));

  let step = 4;
  const stepLines = enabledSections.map((s) => `${step++}. ${s.promptStep}`).join("\n");

  const systemPrompt = `You are an expert technical recruiter, ATS (Applicant Tracking System) simulator, and career coach with 15+ years of experience hiring for technology roles.

You will be given a candidate's MASTER RESUME and a JOB DESCRIPTION. Analyze the resume strictly against the job description and produce a brutally honest, actionable evaluation.

CANDIDATE CONTEXT (apply to every analysis, regardless of what's in the resume text):
- The candidate speaks only English. If the job posting states fluency in another language (German, Dutch, French, Polish, etc.) as a MANDATORY/REQUIRED qualification — not merely a "nice to have" or an incidental mention like "collaborates with our Berlin office" — this is a hard disqualifying blocker. In that case: set chance_of_getting_job to 0, set warnings.language_barrier to a short sentence naming the required language, and keep every other section brief/minimal (e.g. a single short note instead of a full breakdown) rather than producing a full deep analysis — there is no point coaching for a role the candidate cannot legally/practically perform. Still fill ats_score honestly based on skills/keyword match alone (it remains informational). Every other schema field must still be present and valid, just terse.
- The candidate holds an EU Blue Card and is legally authorized to work in Poland without any visa or employer sponsorship, and is open to the general labor market (not tied to a single employer). For roles based outside Poland, the candidate can generally transfer their Blue Card to another EU country with minimal paperwork under EU intra-mobility rules. Do NOT treat "role is outside Poland" as a negative factor by itself, and do NOT lower chance_of_getting_job for it. ONLY if the job posting explicitly states something like "no visa sponsorship," "must already be authorized to work locally," or "no relocation support" for a role outside Poland, set warnings.visa_sponsorship_concern to a short sentence describing exactly what the posting said — this is a heads-up for the candidate to judge, not an automatic score penalty.
- If neither condition applies, set warnings.language_barrier and warnings.visa_sponsorship_concern to empty strings.

Follow this evaluation process:
1. Identify company_name (the hiring company's name exactly as it appears in the posting) and job_title (the role title exactly as posted).
2. Simulate how an ATS would parse and score the resume against the job description's keywords, required skills, and qualifications. ats_score MUST be a whole number from 0 to 100 (a percentage) — never a 0–1 fraction like 0.65.
3. Estimate the realistic chance a qualified human recruiter would move this candidate forward, considering ATS score, experience relevance, and seniority match. chance_of_getting_job MUST also be a whole number from 0 to 100 (a percentage), subject to the language-barrier override above.
${stepLines}

Be specific and reference actual terms from the job description and resume wherever possible. Avoid generic filler advice. Do not be falsely encouraging — if the match is weak, say so clearly in the scores and gaps.

Be economical with output tokens: keep every bullet point under ~14 words, keep every prose/string field (confidence_note, table "context" cells, etc.) to at most one short sentence, and never repeat the same point across two fields.

Respond with ONLY a single valid JSON object matching the required response schema. Do not include markdown formatting, code fences, or any text outside the JSON object.`;

  const properties = {
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
    }
  };
  const required = ["company_name", "job_title", "ats_score", "chance_of_getting_job", "warnings"];

  enabledSections.forEach((s) => {
    Object.assign(properties, s.schema);
    required.push(...Object.keys(s.schema));
  });

  return { systemPrompt, schema: { type: "OBJECT", properties, required } };
}

// Guards against stale/malformed storage (unknown ids from an older version,
// a partial list missing a section entirely) by reconciling against the
// current RESUME_SECTIONS registry — any section missing from saved data is
// appended as enabled so newly-added sections aren't silently lost/hidden.
function sanitizeSectionOrder(saved) {
  if (!Array.isArray(saved) || saved.length === 0) return DEFAULT_SECTION_ORDER.map((s) => ({ ...s }));
  const validIds = new Set(RESUME_SECTIONS.map((s) => s.id));
  const cleaned = saved.filter((s) => s && validIds.has(s.id)).map((s) => ({ id: s.id, enabled: s.enabled !== false }));
  const present = new Set(cleaned.map((s) => s.id));
  RESUME_SECTIONS.forEach((s) => {
    if (!present.has(s.id)) cleaned.push({ id: s.id, enabled: true });
  });
  return cleaned;
}

// Hides disabled section blocks and re-orders the visible ones in the report
// container to match Settings — reordering just re-appends existing DOM
// nodes (appendChild moves rather than clones), no re-render of their data.
function applySectionVisibilityAndOrder() {
  resumeSectionOrder.forEach(({ id, enabled }) => {
    const section = RESUME_SECTIONS.find((s) => s.id === id);
    const block = section && document.getElementById(section.blockId);
    if (!block) return;
    block.classList.toggle("hidden", !enabled);
    report.appendChild(block);
  });
}

// ---------- Interview Prep prompts/schemas ----------
// Independent from the resume matcher above: JD-only, no resume involved.
const PREP_OVERVIEW_SYSTEM_PROMPT = `You are an expert technical interview coach who has studied thousands of real candidate-reported interview experiences from Glassdoor, TeamBlind, and Prepfully.

Given a JOB DESCRIPTION, identify the company_name and job_title exactly as posted, then predict the realistic focus areas of this role's interview process and how much each is typically weighted.

Rules:
- Return 3 to 6 areas tailored to this specific role — do not force a fixed generic list. A backend role might get "Coding & Data Structures", "System Design", "Databases"; a frontend role might get "JavaScript Deep-Dive", "UI/Performance", "System Design (Frontend)"; adjust freely to what this posting actually describes.
- Each area needs: title (short, 2-5 words), predicted_round (a short realistic label like "Round 1 — Online Assessment", "Round 3 — Onsite", "Final Round"), and weight_percent (a whole number).
- weight_percent values across ALL areas MUST sum to exactly 100.
- Order areas the way they'd realistically occur in an interview loop, earliest first.
- If RECRUITER INSIGHTS are provided below the job description, treat them as ground truth that overrides your own guesses — adjust area titles, rounds, and weights to match what the recruiter actually said.

Respond with ONLY a single valid JSON object matching the schema. No markdown, no commentary.`;

const PREP_OVERVIEW_SCHEMA = {
  type: "OBJECT",
  properties: {
    company_name: { type: "STRING", description: "The hiring company's name exactly as it appears in the posting." },
    job_title: { type: "STRING", description: "The role title exactly as posted." },
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
  required: ["company_name", "job_title", "areas"]
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

// Master consolidation engine — Gemini is the ONLY model that touches the
// combined raw pile from the parallel scan. It dedupes near-identical wordings,
// drops anything off-topic for the area, and enriches each survivor.
const PREP_CONSOLIDATION_SYSTEM_PROMPT = `You are the master consolidation engine for an interview-prep tool.

You will receive a COMPANY, JOB TITLE, INTERVIEW AREA, and a raw combined pile of candidate-reported interview questions and web snippets gathered in parallel from several sources (live web search of Glassdoor/Reddit/LeetCode/Blind, plus other AI models). The pile is noisy: duplicates, near-duplicate rewordings, off-topic entries, and prose snippets that merely mention or paraphrase a question.

Your job:
1. Extract the actual interview questions relevant to this specific INTERVIEW AREA. Pull real questions out of prose snippets where present.
2. Deduplicate aggressively — collapse near-identical questions into one clean canonical wording.
3. Drop anything off-topic for the area, generic filler, or too vague to practice.
4. For each surviving question assign: category (one of exactly "Behavioral", "System Design", "Coding", or "Domain"), difficulty (one of exactly "Easy", "Medium", or "Hard"), and frequency (one of exactly "High", "Medium", or "Low" — how commonly this type of question appears to be reported for this area/company).
5. Return 6 to 12 of the strongest, most likely questions, ordered highest-frequency first.

Respond with ONLY a single valid JSON object matching the schema. No markdown, no commentary.`;

const PREP_CONSOLIDATION_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          question: { type: "STRING" },
          category: { type: "STRING", enum: ["Behavioral", "System Design", "Coding", "Domain"] },
          difficulty: { type: "STRING", enum: ["Easy", "Medium", "Hard"] },
          frequency: { type: "STRING", enum: ["High", "Medium", "Low"] }
        },
        required: ["question", "category", "difficulty", "frequency"]
      }
    }
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
const applyView = document.getElementById("applyView");
const scanView = document.getElementById("scanView");
const tabViewsByName = { matcher: matcherView, prep: prepView, apply: applyView, scan: scanView };
const tabButtonsByName = {};
tabButtons.forEach((btn) => { tabButtonsByName[btn.dataset.tab] = btn; });
const coverLetterBtn = document.getElementById("coverLetterBtn");
const checkSalaryBtn = document.getElementById("checkSalaryBtn");
const applyStatusLine = document.getElementById("applyStatusLine");
const salaryResult = document.getElementById("salaryResult");
const salaryResultBody = document.getElementById("salaryResultBody");
const scanAndFilterBtn = document.getElementById("scanAndFilterBtn");
const saveScanBtn = document.getElementById("saveScanBtn");
const scanStatusLine = document.getElementById("scanStatusLine");
const scanResultsList = document.getElementById("scanResultsList");

// ---------- Interview Prep DOM refs ----------
const generatePrepBtn = document.getElementById("generatePrepBtn");
const prepStatusLine = document.getElementById("prepStatusLine");
const prepDashboard = document.getElementById("prepDashboard");
const prepProgressValue = document.getElementById("prepProgressValue");
const prepProgressFill = document.getElementById("prepProgressFill");
const prepDonutSvg = document.getElementById("prepDonutSvg");
const prepDonutLegend = document.getElementById("prepDonutLegend");
const prepAreasList = document.getElementById("prepAreasList");
const prepRecruiterInsights = document.getElementById("prepRecruiterInsights");
const updateFocusBtn = document.getElementById("updateFocusBtn");
const savePrepSheetsBtn = document.getElementById("savePrepSheetsBtn");
const prepJobIdentity = document.getElementById("prepJobIdentity");
const prepJobTitleEl = document.getElementById("prepJobTitleValue");
const prepCompanyNameEl = document.getElementById("prepCompanyNameValue");
const prepSourcePickerSummary = document.getElementById("prepSourcePickerSummary");
const sourceCheckboxes = {
  gemini: document.getElementById("srcGemini"),
  tavily: document.getElementById("srcTavily"),
  deepseek: document.getElementById("srcDeepseek"),
  openai: document.getElementById("srcOpenai"),
  perplexity: document.getElementById("srcPerplexity")
};

// ---------- State ----------
let apiKey = "";
let masterResume = "";
let sheetsWebhookUrl = "";

// Interview Prep "Fetch Deep-Dive Questions" scans every source with a key set,
// in parallel, then Gemini consolidates (see fetchAreaQuestions). Gemini itself
// is always used (consolidation), so its key alone is enough; the others are
// optional extra sources. Tavily is the live-web-search source.
let tavilyKey = "";
let deepseekKey = "";
let deepseekModel = "";
let openaiKey = "";
let openaiModel = "";
let perplexityKey = "";
let perplexityModel = "";
// User-chosen subset of scan sources for Interview Prep question fetching —
// independent of which keys happen to be configured. Persisted across
// sessions since it's a standing preference, not per-job state.
let prepSourceSelection = { gemini: true, tavily: true, deepseek: true, openai: true, perplexity: true };
// Ordered list of { id, enabled } for the optional Resume Matcher report
// sections — configured in Settings. Order determines both display order and
// prompt step numbering; disabled sections are omitted from the Gemini call
// entirely (see buildAnalysisPromptAndSchema), not just hidden after the fact.
let resumeSectionOrder = DEFAULT_SECTION_ORDER.map((s) => ({ ...s }));
let lastJobText = "";
let lastJobUrl = "";
let lastCompanyGuess = "";
let lastResult = null;
let currentTabId = null;
let prepRecruiterNotes = "";
let prepAutoSaveTimer = null;

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
// Interview Prep determines its own company/title via Gemini rather than
// depending on Resume Matcher having run first — it's meant to work standalone
// (per the "fully independent" requirement), and this is what names the
// company-specific Google Sheet tab, so it needs to be reliable on its own.
let prepCompanyName = "";
let prepJobTitle = "";

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
  refreshApplyButtons();
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
  const stored = await chrome.storage.local.get([
    "geminiApiKey",
    "masterResume",
    "sheetsWebhookUrl",
    "tavilyKey",
    "deepseekKey",
    "deepseekModel",
    "openaiKey",
    "openaiModel",
    "perplexityKey",
    "perplexityModel",
    "prepSourceSelection",
    "visibleTabs",
    "resumeSectionOrder"
  ]);
  apiKey = stored.geminiApiKey || "";
  masterResume = stored.masterResume || "";
  sheetsWebhookUrl = stored.sheetsWebhookUrl || "";
  tavilyKey = stored.tavilyKey || "";
  deepseekKey = stored.deepseekKey || "";
  deepseekModel = stored.deepseekModel || "deepseek-v4-flash";
  openaiKey = stored.openaiKey || "";
  openaiModel = stored.openaiModel || "gpt-5-mini";
  perplexityKey = stored.perplexityKey || "";
  perplexityModel = stored.perplexityModel || "sonar";
  prepSourceSelection = { ...prepSourceSelection, ...(stored.prepSourceSelection || {}) };
  applyTabVisibility(stored.visibleTabs);
  resumeSectionOrder = sanitizeSectionOrder(stored.resumeSectionOrder);
  applySectionVisibilityAndOrder();
  resumeQuickEdit.value = masterResume;
  // Restore per-tab state (including any uploaded-resume override) before
  // computing button states, so a tab with an override but no saved master
  // resume doesn't start with Analyze incorrectly disabled.
  await restoreTabState();
  refreshSetupBanner();
  refreshSaveSheetsButton();
  refreshSourcePicker();
}

// ---------- Interview Prep: scan source picker ----------
function refreshSourcePicker() {
  const keyBySource = {
    gemini: apiKey,
    tavily: tavilyKey,
    deepseek: deepseekKey,
    openai: openaiKey,
    perplexity: perplexityKey
  };
  let activeCount = 0;
  for (const [source, checkbox] of Object.entries(sourceCheckboxes)) {
    if (!checkbox) continue;
    const hasKey = !!keyBySource[source];
    checkbox.checked = !!prepSourceSelection[source];
    checkbox.disabled = !hasKey;
    checkbox.title = hasKey ? "" : "Add this provider's API key in Settings to enable it.";
    if (hasKey && checkbox.checked) activeCount++;
  }
  if (prepSourcePickerSummary) {
    prepSourcePickerSummary.textContent = `Scan Sources (${activeCount} selected)`;
  }
}

Object.entries(sourceCheckboxes).forEach(([source, checkbox]) => {
  checkbox?.addEventListener("change", () => {
    prepSourceSelection = { ...prepSourceSelection, [source]: checkbox.checked };
    chrome.storage.local.set({ prepSourceSelection });
    refreshSourcePicker();
  });
});

// Returns the set of sources that are both user-selected and actually
// configured with a key — the effective set to use for a scan.
function effectivePrepSources() {
  return {
    gemini: prepSourceSelection.gemini && !!apiKey,
    tavily: prepSourceSelection.tavily && !!tavilyKey,
    deepseek: prepSourceSelection.deepseek && !!deepseekKey,
    openai: prepSourceSelection.openai && !!openaiKey,
    perplexity: prepSourceSelection.perplexity && !!perplexityKey
  };
}

function refreshSetupBanner() {
  const missing = !apiKey || !hasUsableResume();
  setupBanner.classList.toggle("hidden", !missing);
  analyzeBtn.disabled = missing;
  refreshScanButton();
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
function activateTab(target) {
  tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === target));
  Object.entries(tabViewsByName).forEach(([name, view]) => view.classList.toggle("hidden", name !== target));
  if (target === "apply") refreshApplyButtons();
  if (target === "scan") refreshScanButton();
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

// Settings lets the user hide tabs they don't use — hide their buttons here,
// and if the currently active tab just got hidden, jump to the first tab
// that's still visible so the panel never ends up showing nothing.
function applyTabVisibility(visibleTabs) {
  const visible = { scan: true, matcher: true, prep: true, apply: true, ...(visibleTabs || {}) };
  const anyVisible = Object.values(visible).some(Boolean);

  Object.entries(tabButtonsByName).forEach(([name, btn]) => {
    btn.classList.toggle("hidden", !anyVisible ? false : !visible[name]);
  });

  const activeBtn = Array.from(tabButtons).find((b) => b.classList.contains("active"));
  if (!activeBtn || activeBtn.classList.contains("hidden")) {
    const firstVisible = Array.from(tabButtons).find((b) => !b.classList.contains("hidden"));
    if (firstVisible) activateTab(firstVisible.dataset.tab);
  }
}

function refreshScanButton() {
  scanAndFilterBtn.disabled = !(apiKey && effectiveResume());
  scanAndFilterBtn.title = scanAndFilterBtn.disabled ? "Add your Gemini API key and resume in Settings first." : "";
}

function refreshApplyButtons() {
  const ready = !!(apiKey && lastResult && lastJobText && effectiveResume());
  coverLetterBtn.disabled = !ready;
  checkSalaryBtn.disabled = !ready;
  const title = ready ? "" : "Run Resume Matcher analysis on this job first.";
  coverLetterBtn.title = title;
  checkSalaryBtn.title = title;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.geminiApiKey) apiKey = changes.geminiApiKey.newValue || "";
  if (changes.sheetsWebhookUrl) sheetsWebhookUrl = changes.sheetsWebhookUrl.newValue || "";
  if (changes.masterResume) {
    masterResume = changes.masterResume.newValue || "";
    if (document.activeElement !== resumeQuickEdit) resumeQuickEdit.value = masterResume;
  }
  if (changes.tavilyKey) tavilyKey = changes.tavilyKey.newValue || "";
  if (changes.deepseekKey) deepseekKey = changes.deepseekKey.newValue || "";
  if (changes.deepseekModel) deepseekModel = changes.deepseekModel.newValue || "deepseek-v4-flash";
  if (changes.openaiKey) openaiKey = changes.openaiKey.newValue || "";
  if (changes.openaiModel) openaiModel = changes.openaiModel.newValue || "gpt-5-mini";
  if (changes.perplexityKey) perplexityKey = changes.perplexityKey.newValue || "";
  if (changes.perplexityModel) perplexityModel = changes.perplexityModel.newValue || "sonar";
  if (changes.visibleTabs) applyTabVisibility(changes.visibleTabs.newValue);
  if (changes.resumeSectionOrder) {
    resumeSectionOrder = sanitizeSectionOrder(changes.resumeSectionOrder.newValue);
    applySectionVisibilityAndOrder();
  }
  refreshSetupBanner();
  refreshSaveSheetsButton();
  refreshSourcePicker();
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
// A failure is worth dropping to the next model tier for if it's transient or
// model-specific: rate limit (429), server busy (503), model unavailable for
// this key/region (404/400), the 10s timeout firing, or a response we couldn't
// use (empty / malformed JSON). A genuine auth error (401/403) is NOT retryable
// — the next model would fail identically — so it surfaces immediately.
function isRetryableError(err) {
  if (!err) return false;
  if (err.isTimeout || err.isInvalidResponse) return true;
  if ([429, 503, 404, 400].includes(err.httpStatus)) return true;

  const message = String(err.message || "").toLowerCase();
  return /(429|503|404|400|rate limit|over quota|timed out|busy|no longer available|not found|unavailable|quota|too many requests|empty response|malformed json|model .* not available|model .* is no longer available)/i.test(message);
}

function formatModelRetryMessage(err, contextLabel = "Gemini") {
  const attemptedModel = err?.model || "an unknown model";
  const lastFailure = err?.message || "request failed";
  return `All ${contextLabel} models are busy, timed out, or over quota right now. The last attempted ${contextLabel} model was ${attemptedModel}. ${lastFailure}`;
}

async function callGeminiModel(model, systemPrompt, userPrompt, schema) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_CALL_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${geminiUrlFor(model)}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
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
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`Gemini ${model} timed out after ${GEMINI_CALL_TIMEOUT_MS / 1000}s.`);
      timeoutErr.isTimeout = true;
      timeoutErr.model = model;
      throw timeoutErr;
    }
    // Network-level failure (DNS, offline, CORS) — treat as retryable so the
    // cascade can try the next tier rather than dead-ending.
    const netErr = new Error(err.message || "Network error calling Gemini.");
    netErr.isInvalidResponse = true;
    netErr.model = model;
    throw netErr;
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errMessage = data?.error?.message || `Gemini request failed (HTTP ${response.status}).`;
    const err = new Error(errMessage);
    err.httpStatus = response.status;
    err.model = model;
    throw err;
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!rawText) {
    const blockReason = data?.promptFeedback?.blockReason;
    // A safety block is a real refusal, not a transient hiccup — don't burn the
    // whole cascade retrying it; surface it. An otherwise-empty response is
    // treated as invalid and retried on the next tier.
    if (blockReason) {
      const blockErr = new Error(`Gemini blocked the request: ${blockReason}`);
      blockErr.model = model;
      throw blockErr;
    }
    const emptyErr = new Error("Gemini returned an empty response.");
    emptyErr.isInvalidResponse = true;
    emptyErr.model = model;
    throw emptyErr;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    const parseErr = new Error("Gemini returned malformed JSON.");
    parseErr.isInvalidResponse = true;
    parseErr.model = model;
    throw parseErr;
  }
}

// Shared by Resume Matcher, Interview Prep question generation, and master
// consolidation — each supplies its own system prompt/schema and gets the full
// six-tier model cascade with per-attempt timeout for free.
async function callGeminiWithFallback(systemPrompt, userPrompt, schema, onModelSwitch) {
  let lastErr;
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const model = GEMINI_MODELS[i];
    if (i > 0) onModelSwitch?.(model);
    try {
      return await callGeminiModel(model, systemPrompt, userPrompt, schema);
    } catch (err) {
      lastErr = err;
      lastErr.model = model;
      const isLastModel = i === GEMINI_MODELS.length - 1;
      if (isRetryableError(err) && !isLastModel) {
        console.warn(`Gemini ${model} failed (${err.message}) — falling back to ${GEMINI_MODELS[i + 1]}.`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function analyzeWithGemini(jobText, onModelSwitch) {
  const userPrompt = `MASTER RESUME:\n"""\n${effectiveResume()}\n"""\n\nJOB DESCRIPTION:\n"""\n${jobText}\n"""`;
  const { systemPrompt, schema } = buildAnalysisPromptAndSchema(resumeSectionOrder);
  return callGeminiWithFallback(systemPrompt, userPrompt, schema, onModelSwitch);
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
    const message = isRetryableError(err)
      ? formatModelRetryMessage(err, "Gemini")
      : err.message || "Something went wrong.";
    setStatus(message, "err");
  } finally {
    setBusy(false);
    reanalyzeBtn.disabled = !lastJobText;
    refreshSaveSheetsButton();
    refreshApplyButtons();
  }
}

// ---------- Save to Google Sheets ----------
async function saveResultToSheets() {
  if (!sheetsWebhookUrl || !lastResult) return;

  const payload = {
    type: "job_match",
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

async function savePrepState() {
  if (!prepJobUrl || !currentTabId) return;
  await chrome.storage.session.set({
    [prepJobUrl]: {
      areas: prepAreas,
      recruiterNotes: prepRecruiterNotes,
      companyName: prepCompanyName,
      jobTitle: prepJobTitle,
      savedAt: Date.now()
    }
  });
}

function refreshPrepSheetsButton() {
  if (!savePrepSheetsBtn) return;
  const enabled = !!sheetsWebhookUrl && prepAreas.length > 0 && !!prepJobUrl;
  savePrepSheetsBtn.disabled = !enabled;
  savePrepSheetsBtn.title = enabled ? "" : "Add a Google Sheets Webhook URL and generate prep to save progress.";
}

function schedulePrepSheetSave() {
  if (!sheetsWebhookUrl || !prepJobUrl || prepAreas.length === 0) return;
  if (prepAutoSaveTimer) clearTimeout(prepAutoSaveTimer);
  prepAutoSaveTimer = setTimeout(() => {
    savePrepProgressToSheets({ silent: true });
    prepAutoSaveTimer = null;
  }, 600);
}

async function savePrepProgressToSheets({ silent } = {}) {
  if (!sheetsWebhookUrl || !prepAreas.length || !prepJobUrl) return;

  const payload = {
    type: "interview_prep",
    date: new Date().toISOString().slice(0, 10),
    companyName: prepCompanyName || lastResult?.company_name || lastCompanyGuess || "Unknown Company",
    jobTitle: prepJobTitle || lastResult?.job_title || "Unknown Role",
    jobUrl: lastJobUrl || prepJobUrl || "",
    progressPercent: computePrepProgress(),
    recruiterInsights: prepRecruiterNotes || "",
    areas: prepAreas.map((area) => ({
      title: area.title,
      predictedRound: area.predictedRound,
      weightPercent: area.weightPercent,
      completed: area.masterChecked || false,
      questions: area.questions.map((q) => ({
        text: q.text,
        checked: q.checked,
        category: q.category || "",
        difficulty: q.difficulty || "",
        frequency: q.frequency || ""
      }))
    }))
  };

  try {
    await fetch(sheetsWebhookUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    if (!silent) {
      savePrepSheetsBtn.textContent = "✓ Saved to Sheet";
      savePrepSheetsBtn.classList.add("saved");
      setPrepStatus("Prep progress sent to Google Sheets.", "ok");
      setTimeout(() => {
        savePrepSheetsBtn.textContent = "💾 Save Progress to Sheet";
        refreshPrepSheetsButton();
      }, 2200);
    }
  } catch (err) {
    console.error(err);
    if (!silent) {
      setPrepStatus("Could not save prep progress to Sheets. Check the webhook URL.", "err");
    }
  }
}

function setPrepStatus(message, kind) {
  prepStatusLine.textContent = message || "";
  prepStatusLine.classList.remove("err", "ok");
  if (kind) prepStatusLine.classList.add(kind);
}

// Which sources a scan will actually query, based on configured keys. Gemini is
// always in (consolidation engine); the rest join only if their key is set.
function prepScanSourcesLabel() {
  const active = effectivePrepSources();
  const sources = [];
  if (active.gemini) sources.push("Gemini");
  if (active.tavily) sources.push("Tavily 🌐");
  if (active.deepseek) sources.push("DeepSeek");
  if (active.openai) sources.push("OpenAI");
  if (active.perplexity) sources.push("Perplexity");
  if (sources.length === 0) return "no sources selected";
  return sources.length === 1 ? `${sources[0]} only` : sources.join(" + ");
}

function setPrepBusy(isBusy, label) {
  generatePrepBtn.disabled = isBusy || !apiKey;
  if (updateFocusBtn) updateFocusBtn.disabled = isBusy || !apiKey;
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

    const textWrap = document.createElement("div");
    textWrap.className = "prep-question-text";

    const span = document.createElement("span");
    span.textContent = q.text;
    textWrap.appendChild(span);

    // Enrichment badges from the consolidation pass (absent on older saved data),
    // plus an "Answer" action alongside them that opens Gemini with the question.
    const badges = document.createElement("div");
    badges.className = "prep-question-badges";
    if (q.category) badges.appendChild(makeQBadge(q.category, "cat"));
    if (q.difficulty) badges.appendChild(makeQBadge(q.difficulty, `diff-${q.difficulty.toLowerCase()}`));
    if (q.frequency) badges.appendChild(makeQBadge(`${q.frequency} freq`, `freq-${q.frequency.toLowerCase()}`));
    badges.appendChild(makeAnswerButton(q.text));
    textWrap.appendChild(badges);

    li.append(checkbox, textWrap);
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

function makeQBadge(text, variant) {
  const badge = document.createElement("span");
  badge.className = `prep-q-badge ${variant}`;
  badge.textContent = text;
  return badge;
}

function buildAnswerPrompt(questionText) {
  return `Answer this interview question exactly like a lead engineer would in a real interview — cover every edge case and possibility, don't leave anything out, and explain your reasoning clearly the way you'd walk an interviewer through it out loud:\n\n"${questionText}"`;
}

// Base chat URLs for each provider. Perplexity's ?q= reliably prefills+runs on
// its own; the rest get their prompt typed in and submitted via an injected
// content script once the tab finishes loading (see fillAndSubmitPrompt).
const ANSWER_PROVIDER_URLS = {
  gemini: "https://gemini.google.com/app",
  deepseek: "https://chat.deepseek.com/",
  openai: "https://chatgpt.com/",
  perplexity: "https://www.perplexity.ai/search"
};

// Runs inside the opened chat tab. Must be fully self-contained (no closures
// over outer scope) since chrome.scripting serializes only the function body.
// Best-effort: each site's input DOM can change at any time and break this;
// it retries briefly, and the prompt is also on the clipboard as a fallback.
function fillAndSubmitPrompt(promptText) {
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function findFirst(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function pressEnter(el) {
    ["keydown", "keypress", "keyup"].forEach((type) => {
      el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    });
  }

  function tryFill(attempt) {
    const host = location.hostname;
    let input = null;
    let contentEditable = false;

    if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
      input = findFirst(["#prompt-textarea", "textarea[data-id]", "textarea"]);
    } else if (host.includes("gemini.google.com")) {
      input = findFirst(['div.ql-editor[contenteditable="true"]', 'rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"]']);
      contentEditable = true;
    } else if (host.includes("chat.deepseek.com") || host.includes("perplexity.ai")) {
      input = findFirst(["textarea", 'div[contenteditable="true"]']);
      contentEditable = !!input && input.tagName !== "TEXTAREA";
    }

    if (!input) {
      if (attempt < 25) setTimeout(() => tryFill(attempt + 1), 400);
      return;
    }

    input.focus();
    if (contentEditable) {
      input.textContent = promptText;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: promptText, inputType: "insertText" }));
    } else {
      setNativeValue(input, promptText);
    }

    setTimeout(() => {
      const sendBtn = findFirst([
        'button[data-testid="send-button"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button[aria-label="Submit"]',
        'button[type="submit"]'
      ]);
      if (sendBtn && !sendBtn.disabled) sendBtn.click();
      else pressEnter(input);
    }, 400);
  }

  tryFill(0);
}

function askInTab(url, promptText) {
  chrome.tabs.create({ url, active: true }, (tab) => {
    if (!tab?.id) return;
    const tabId = tab.id;
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(listener);
      // Give the page's JS a moment to hydrate its input box after "complete".
      setTimeout(() => {
        chrome.scripting.executeScript({
          target: { tabId },
          func: fillAndSubmitPrompt,
          args: [promptText]
        }).catch(() => {});
      }, 900);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function makeAnswerButton(questionText) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "prep-q-badge prep-answer-btn";
  btn.textContent = "Answer";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const prompt = buildAnswerPrompt(questionText);

    const active = effectivePrepSources();
    const targets = Object.keys(ANSWER_PROVIDER_URLS).filter((source) => active[source]);
    if (targets.length === 0) {
      setPrepStatus("No AI source selected in Scan Sources — check at least one to use Answer.", "err");
      return;
    }

    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Best-effort — auto-fill below doesn't depend on the clipboard.
    }

    targets.forEach((source) => {
      const base = ANSWER_PROVIDER_URLS[source];
      const url = source === "perplexity" ? `${base}?q=${encodeURIComponent(prompt)}` : base;
      askInTab(url, prompt);
    });

    setPrepStatus("Opening and asking on: " + targets.join(", ") + ". (Also copied to clipboard as backup.)", "ok");
  });
  return btn;
}

function toggleQuestion(area, question, checked, liEl, masterCheckboxEl) {
  question.checked = checked;
  liEl.classList.toggle("checked", checked);
  area.masterChecked = area.questions.length > 0 && area.questions.every((q) => q.checked);
  if (masterCheckboxEl) masterCheckboxEl.checked = area.masterChecked;
  renderPrepProgress();
  savePrepState();
  schedulePrepSheetSave();
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
  schedulePrepSheetSave();
}

// Gemini participates in the parallel scan too (one of the sources), separate
// from its role as the sole consolidator afterward. Kept as its own function so
// it can be dropped into Promise.allSettled alongside the non-Gemini sources.
async function geminiScanQuestions(area) {
  const userPrompt = `JOB DESCRIPTION:\n"""\n${lastJobText}\n"""\n\nINTERVIEW AREA: ${area.title} (${area.predictedRound})`;
  const result = await callGeminiWithFallback(PREP_QUESTIONS_SYSTEM_PROMPT, userPrompt, PREP_QUESTIONS_SCHEMA);
  return Array.isArray(result.questions) ? result.questions.filter(Boolean) : [];
}

async function fetchAreaQuestions(area, els) {
  const { fetchBtn, statusEl, questionsListEl, masterCheckbox } = els;

  if (!apiKey) {
    // Gemini is mandatory — it's the consolidation engine, so nothing works
    // without it even if other source keys are present.
    setPrepStatus("Add your Gemini API key in Settings first — it powers question consolidation.", "err");
    chrome.runtime.openOptionsPage();
    return;
  }
  if (!lastJobText) {
    statusEl.textContent = "Job description unavailable — regenerate interview prep first.";
    statusEl.classList.add("err");
    return;
  }

  const active = effectivePrepSources();
  if (!active.gemini && !active.tavily && !active.deepseek && !active.openai && !active.perplexity) {
    statusEl.textContent = "No scan sources selected — check at least one in Scan Sources.";
    statusEl.classList.add("err");
    return;
  }

  fetchBtn.disabled = true;
  statusEl.classList.remove("err");

  const company = prepCompanyName || lastResult?.company_name || "";
  const jobTitle = prepJobTitle || lastResult?.job_title || "";

  try {
    // ---- STEP 1: parallel scan across every user-selected, configured source ----
    statusEl.textContent = `Scanning ${prepScanSourcesLabel()}...`;

    const { scanNonGeminiSources } = await import(chrome.runtime.getURL("sidepanel/aiProviders.js"));

    const scanCtx = {
      company,
      jobTitle,
      areaTitle: area.title,
      areaRound: area.predictedRound,
      jobDescription: lastJobText,
      recruiterNotes: prepRecruiterNotes,
      keys: {
        tavily: active.tavily ? tavilyKey : "",
        deepseek: active.deepseek ? deepseekKey : "",
        openai: active.openai ? openaiKey : "",
        perplexity: active.perplexity ? perplexityKey : ""
      },
      models: { deepseek: deepseekModel, openai: openaiModel, perplexity: perplexityModel }
    };

    // Gemini scan + all non-Gemini sources fire together via allSettled — one
    // failing source (bad key, timeout) can't sink the batch.
    const [geminiSettled, nonGemini] = await Promise.all([
      Promise.allSettled([active.gemini ? geminiScanQuestions(area) : Promise.resolve([])]),
      scanNonGeminiSources(scanCtx)
    ]);

    const rawItems = [...nonGemini.items];
    const sourcesUsed = [...nonGemini.sourcesUsed];
    if (geminiSettled[0].status === "fulfilled" && geminiSettled[0].value.length) {
      rawItems.push(...geminiSettled[0].value);
      sourcesUsed.push("Gemini");
    }

    if (rawItems.length === 0) {
      throw new Error("No sources returned any questions. Check your API keys in Settings, or try again.");
    }

    // ---- STEP 2: Gemini master consolidation (dedupe, group, rank) ----
    statusEl.textContent = `Consolidating ${rawItems.length} results from ${sourcesUsed.length} source(s)...`;

    const consolidationPrompt = `COMPANY: ${company || "Unknown"}\nJOB TITLE: ${jobTitle || "Unknown"}\nINTERVIEW AREA: ${area.title} (${area.predictedRound})\n\nRAW COMBINED QUESTIONS/SNIPPETS (from ${sourcesUsed.join(", ")}):\n"""\n${rawItems.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n"""`;

    const consolidated = await callGeminiWithFallback(
      PREP_CONSOLIDATION_SYSTEM_PROMPT,
      consolidationPrompt,
      PREP_CONSOLIDATION_SCHEMA,
      (model) => {
        statusEl.textContent = `Consolidating — switching to ${model}...`;
      }
    );

    const finalQuestions = Array.isArray(consolidated.questions) ? consolidated.questions : [];
    area.questions = finalQuestions
      .filter((q) => q && q.question)
      .map((q, i) => ({
        id: `${area.id}-q${i}`,
        text: q.question,
        category: q.category || "",
        difficulty: q.difficulty || "",
        frequency: q.frequency || "",
        checked: area.masterChecked
      }));
    area.questionsFetched = true;
    area.scanSources = sourcesUsed;

    renderQuestionsList(area, questionsListEl, masterCheckbox);
    fetchBtn.textContent = "🔄 Rescan Questions";
    statusEl.textContent = `✓ ${area.questions.length} consolidated from: ${sourcesUsed.join(", ")}`;
    if (nonGemini.errors.length) {
      console.warn("Some scan sources failed:", nonGemini.errors);
    }
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

  const fetchRow = document.createElement("div");
  fetchRow.className = "prep-fetch-row";

  const fetchBtn = document.createElement("button");
  fetchBtn.type = "button";
  fetchBtn.className = "secondary-btn small";
  fetchBtn.textContent = area.questionsFetched ? "🔄 Rescan Questions" : "Fetch Deep-Dive Questions";

  const providerHint = document.createElement("span");
  providerHint.className = "prep-provider-hint";
  providerHint.textContent = prepScanSourcesLabel();

  fetchRow.append(fetchBtn, providerHint);

  const statusEl = document.createElement("div");
  statusEl.className = "prep-questions-status";

  const questionsListEl = document.createElement("ul");
  questionsListEl.className = "prep-questions-list";

  body.append(fetchRow, statusEl, questionsListEl);
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
  if (prepJobIdentity) {
    prepJobIdentity.classList.toggle("hidden", !hasAreas);
    if (prepJobTitleEl) prepJobTitleEl.textContent = prepJobTitle || "Role title unavailable";
    if (prepCompanyNameEl) prepCompanyNameEl.textContent = prepCompanyName || "Company unavailable";
  }
  renderPrepDonut(prepAreas);
  renderPrepDonutLegend(prepAreas);
  renderPrepProgress();
  refreshPrepSheetsButton();
  prepDashboard.classList.toggle("hidden", !hasAreas);
  generatePrepBtn.classList.remove("hidden");
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

    const recruiterNotes = prepRecruiterInsights?.value.trim() || "";
    prepRecruiterNotes = recruiterNotes;

    setPrepStatus("Predicting interview focus areas...");
    const notesSection = recruiterNotes
      ? `RECRUITER INSIGHTS:\n"""\n${recruiterNotes}\n"""\n\n`
      : "";
    const userPrompt = `JOB DESCRIPTION:\n"""\n${lastJobText}\n"""\n\n${notesSection}`;
    const result = await callGeminiWithFallback(
      PREP_OVERVIEW_SYSTEM_PROMPT,
      userPrompt,
      PREP_OVERVIEW_SCHEMA,
      (model) => setPrepStatus(`Busy — switching to ${model} and retrying...`)
    );

    prepJobUrl = lastJobUrl;
    prepCompanyName = result.company_name || lastCompanyGuess || "";
    prepJobTitle = result.job_title || "";
    // The wildcard area is appended deterministically rather than asked for
    // in the prompt above it — its own Fetch Deep-Dive Questions call still
    // produces genuinely company/stack-tailored questions (it's given the
    // real job description), so nothing is lost by not relying on the model
    // to remember to include it, and it can't end up duplicated either.
    prepAreas = normalizeAreas([
      ...(result.areas || []),
      { title: "🔮 AI Company & Stack Predictions", predicted_round: "Any Round — Wildcard", weight_percent: 15 }
    ]);
    renderPrepAreas();
    await savePrepState();
    if (sheetsWebhookUrl) {
      await savePrepProgressToSheets({ silent: true });
    }
    setPrepStatus("Interview prep generated.", "ok");
  } catch (err) {
    console.error(err);
    const message = isRetryableError(err)
      ? formatModelRetryMessage(err, "Gemini")
      : err.message || "Something went wrong.";
    setPrepStatus(message, "err");
  } finally {
    setPrepBusy(false);
  }
}



generatePrepBtn.addEventListener("click", () => runGeneratePrep());
updateFocusBtn?.addEventListener("click", () => runGeneratePrep({ forceRegenerate: true }));
savePrepSheetsBtn?.addEventListener("click", () => savePrepProgressToSheets({ silent: false }));

analyzeBtn.addEventListener("click", () => runAnalysis({ reextract: true }));
reanalyzeBtn.addEventListener("click", () => runAnalysis({ reextract: false }));
saveSheetsBtn.addEventListener("click", saveResultToSheets);

// ---------- Cover Letter & Salary ----------
const COVER_LETTER_SYSTEM_PROMPT = `You are an expert career coach writing a concise, professional cover letter for a specific job application.

You will be given a candidate's MASTER RESUME and a JOB DESCRIPTION. Write a genuine, tailored one-page cover letter — never use placeholder text like "[Your Name]" or "[Company Name]"; extract the candidate's actual name from the resume and the company/role from the job description, and use them directly. If the candidate's name truly cannot be found in the resume, omit it (return an empty string) rather than inventing or placeholding it.

Structure:
- opening_paragraph: hook the reader, state the role and genuine interest, 2-3 sentences.
- key_points: exactly 3 to 5 short, punchy bullet points, each a specific, concrete selling point connecting the candidate's real resume experience to this job's actual requirements (use real numbers/technologies/outcomes from the resume, not generic claims).
- closing_paragraph: confident close with a call to action, 2-3 sentences.
- candidate_name: the candidate's full name as found in the resume, or empty string if genuinely absent.

Keep the whole letter fitting on one page (roughly 250-350 words total). Be specific, not generic. No markdown, no placeholders.

Respond with ONLY a valid JSON object matching the schema.`;

const COVER_LETTER_SCHEMA = {
  type: "OBJECT",
  properties: {
    candidate_name: { type: "STRING" },
    opening_paragraph: { type: "STRING" },
    key_points: { type: "ARRAY", items: { type: "STRING" } },
    closing_paragraph: { type: "STRING" }
  },
  required: ["candidate_name", "opening_paragraph", "key_points", "closing_paragraph"]
};

async function generateCoverLetter() {
  if (!lastResult || !lastJobText) return;
  coverLetterBtn.disabled = true;
  applyStatusLine.classList.remove("err");
  applyStatusLine.textContent = "Writing your cover letter...";
  try {
    const userPrompt = `MASTER RESUME:\n"""\n${effectiveResume()}\n"""\n\nJOB DESCRIPTION:\n"""\n${lastJobText}\n"""\n\nCOMPANY: ${lastResult.company_name || ""}\nROLE: ${lastResult.job_title || ""}`;
    const data = await callGeminiWithFallback(COVER_LETTER_SYSTEM_PROMPT, userPrompt, COVER_LETTER_SCHEMA, (m) => {
      applyStatusLine.textContent = `Busy — switching to ${m}...`;
    });
    buildCoverLetterPdf(data);
    applyStatusLine.textContent = "Cover letter downloaded.";
    applyStatusLine.classList.add("ok");
  } catch (err) {
    console.error(err);
    applyStatusLine.textContent = isRetryableError(err) ? formatModelRetryMessage(err, "Gemini") : (err.message || "Couldn't generate cover letter.");
    applyStatusLine.classList.add("err");
  } finally {
    refreshApplyButtons();
  }
}

function buildCoverLetterPdf(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 56;
  const maxWidth = 612 - marginX * 2;
  const lineGap = 16;
  let y = 72;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(new Date().toLocaleDateString(), marginX, y);
  y += lineGap * 2;

  doc.text(`Re: Application for ${lastResult.job_title || "the role"} at ${lastResult.company_name || "your company"}`, marginX, y);
  y += lineGap * 2;

  doc.text("Dear Hiring Manager,", marginX, y);
  y += lineGap * 1.5;

  const writeParagraph = (text) => {
    const lines = doc.splitTextToSize(text, maxWidth);
    doc.text(lines, marginX, y);
    y += lines.length * lineGap + lineGap * 0.5;
  };

  writeParagraph(data.opening_paragraph || "");

  (data.key_points || []).forEach((point) => {
    const lines = doc.splitTextToSize(`•  ${point}`, maxWidth - 14);
    doc.text(lines, marginX + 14, y);
    y += lines.length * lineGap;
  });
  y += lineGap * 0.5;

  writeParagraph(data.closing_paragraph || "");

  y += lineGap * 0.5;
  doc.text("Sincerely,", marginX, y);
  y += lineGap * 1.5;
  if (data.candidate_name) doc.text(data.candidate_name, marginX, y);

  const safe = (s) => (s || "").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "Unknown";
  doc.save(`Cover_Letter_${safe(lastResult.company_name)}_${safe(lastResult.job_title)}.pdf`);
}

const SALARY_SYSTEM_PROMPT = `You are a compensation analyst with broad knowledge of global tech salary benchmarks, cost of living, taxation, and market standards.

Given a JOB DESCRIPTION (which states or implies a location) and role/company context — plus optional live web search snippets if provided — estimate a realistic salary for this specific role at this specific company/location, informed by market standards, typical tax burden, and inflation for that location.

Rules:
- Identify the job's location (city/country) from the posting; if unclear, assume Poland.
- local_currency is that location's actual currency (e.g. "PLN" for Poland, "USD" for the US, etc).
- Give monthly and annual GROSS figures in local currency, in PLN, and in EUR. If local currency is already PLN or EUR, set that duplicate currency's four number fields to 0 and explain why in basis_note — never show identical numbers twice under different labels.
- benefits: 4-8 realistic, specific benefits typical for this role/company/location (health, equity, remote policy, learning budget, etc) — no vague filler.
- negotiation_tips: 3-5 concrete negotiation angles specific to this role and situation (leverage points, what to ask for beyond base pay).
- basis_note: 1-2 sentences on what this estimate is grounded in — it's an informed estimate, not a live quote.

Respond with ONLY a valid JSON object matching the schema.`;

const SALARY_SCHEMA = {
  type: "OBJECT",
  properties: {
    location: { type: "STRING" },
    local_currency: { type: "STRING" },
    monthly_local: { type: "NUMBER" },
    annual_local: { type: "NUMBER" },
    monthly_pln: { type: "NUMBER" },
    annual_pln: { type: "NUMBER" },
    monthly_eur: { type: "NUMBER" },
    annual_eur: { type: "NUMBER" },
    benefits: { type: "ARRAY", items: { type: "STRING" } },
    negotiation_tips: { type: "ARRAY", items: { type: "STRING" } },
    basis_note: { type: "STRING" }
  },
  required: ["location", "local_currency", "monthly_local", "annual_local", "monthly_pln", "annual_pln", "monthly_eur", "annual_eur", "benefits", "negotiation_tips", "basis_note"]
};

async function checkSalary() {
  if (!lastResult || !lastJobText) return;
  checkSalaryBtn.disabled = true;
  applyStatusLine.classList.remove("err");
  applyStatusLine.textContent = "Estimating salary...";
  salaryResult.classList.add("hidden");
  try {
    let webContext = "";
    if (tavilyKey) {
      try {
        const { scanTavily } = await import(chrome.runtime.getURL("sidepanel/aiProviders.js"));
        const snippets = await scanTavily({
          apiKey: tavilyKey,
          company: lastResult.company_name,
          jobTitle: lastResult.job_title,
          areaTitle: "salary compensation range benefits"
        });
        if (snippets.length) webContext = `\n\nLIVE WEB SEARCH SNIPPETS (salary/benefits related):\n"""\n${snippets.slice(0, 8).join("\n")}\n"""`;
      } catch {
        // Best-effort — Gemini still answers from its own knowledge if this fails.
      }
    }

    const userPrompt = `COMPANY: ${lastResult.company_name || "Unknown"}\nROLE: ${lastResult.job_title || "Unknown"}\n\nJOB DESCRIPTION:\n"""\n${lastJobText}\n"""${webContext}`;
    const data = await callGeminiWithFallback(SALARY_SYSTEM_PROMPT, userPrompt, SALARY_SCHEMA, (m) => {
      applyStatusLine.textContent = `Busy — switching to ${m}...`;
    });
    renderSalaryResult(data);
    applyStatusLine.textContent = "Salary estimate ready.";
    applyStatusLine.classList.add("ok");
  } catch (err) {
    console.error(err);
    applyStatusLine.textContent = isRetryableError(err) ? formatModelRetryMessage(err, "Gemini") : (err.message || "Couldn't estimate salary.");
    applyStatusLine.classList.add("err");
  } finally {
    refreshApplyButtons();
  }
}

function fmtMoney(amount, currency) {
  if (!amount) return null;
  return `${Math.round(amount).toLocaleString()} ${currency}`;
}

function renderSalaryResult(data) {
  salaryResultBody.innerHTML = "";
  const rows = [
    [data.local_currency || "Local", data.local_currency, data.monthly_local, data.annual_local],
    ["PLN", "PLN", data.monthly_pln, data.annual_pln],
    ["EUR", "EUR", data.monthly_eur, data.annual_eur]
  ];

  rows.forEach(([label, currency, monthly, annual]) => {
    const m = fmtMoney(monthly, currency);
    const a = fmtMoney(annual, currency);
    if (!m && !a) return;
    const row = document.createElement("div");
    row.className = "prep-checkbox-label";
    row.style.justifyContent = "space-between";
    row.innerHTML = `<strong>${label}</strong><span>${m || "—"} / mo &nbsp;·&nbsp; ${a || "—"} / yr</span>`;
    salaryResultBody.appendChild(row);
  });

  const addList = (title, items) => {
    if (!items?.length) return;
    const h = document.createElement("div");
    h.style.fontWeight = "700";
    h.style.marginTop = "8px";
    h.textContent = title;
    salaryResultBody.appendChild(h);
    const ul = document.createElement("ul");
    ul.style.margin = "4px 0 0 16px";
    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      ul.appendChild(li);
    });
    salaryResultBody.appendChild(ul);
  };

  addList("Benefits", data.benefits);
  addList("Negotiation Tips", data.negotiation_tips);

  if (data.basis_note) {
    const note = document.createElement("div");
    note.style.marginTop = "8px";
    note.style.fontSize = "11px";
    note.style.color = "var(--muted)";
    note.textContent = data.basis_note;
    salaryResultBody.appendChild(note);
  }

  salaryResult.classList.remove("hidden");
  salaryResult.open = true;
}

coverLetterBtn.addEventListener("click", generateCoverLetter);
checkSalaryBtn.addEventListener("click", checkSalary);

// ---------- Scan Jobs ----------
let scanResults = [];

const BULK_MATCH_SYSTEM_PROMPT = `You are a fast ATS matching engine. Given a candidate's resume and one job posting (title/company/description, which may be brief), return a realistic match percentage and exactly 7 key technical skills/technologies this posting asks for.

Rules:
- match_percent: whole number 0-100 reflecting realistic fit between resume and posting.
- tech_stack: exactly 7 short tags (e.g. "React", "AWS", "Kubernetes") — the most specific, concrete technologies/skills named in the posting. If the posting text is too short to find 7 distinct technical items, fill remaining slots with the closest relevant domain/soft skills implied by the title — never leave fewer than 7.

Respond with ONLY a valid JSON object matching the schema.`;

const BULK_MATCH_SCHEMA = {
  type: "OBJECT",
  properties: {
    match_percent: { type: "NUMBER" },
    tech_stack: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["match_percent", "tech_stack"]
};

function scanJobListOnActiveTab() {
  return new Promise((resolve, reject) => {
    let tab;
    let settled = false;

    const run = async () => {
      if (currentTabId != null) tab = await chrome.tabs.get(currentTabId).catch(() => null);
      // The bound tab might exist but no longer be the job listings page (or
      // any http(s) page at all) — fall back to whatever tab is actually
      // active in this window rather than failing on a stale binding.
      if (!tab || !/^https?:\/\//.test(tab.url || "")) {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      }
      if (!tab?.id || !/^https?:\/\//.test(tab.url || "")) {
        reject(new Error("Open a job listings page in this tab first."));
        return;
      }

      const listener = (message, sender) => {
        if (message?.type === "JOB_MATCH_LIST_SCAN_RESULT" && sender.tab?.id === tab.id) {
          settled = true;
          chrome.runtime.onMessage.removeListener(listener);
          resolve(Array.isArray(message.jobs) ? message.jobs : []);
        }
      };
      chrome.runtime.onMessage.addListener(listener);

      chrome.scripting
        .executeScript({ target: { tabId: tab.id }, files: ["content/jobListScan.js"] })
        .catch((err) => {
          chrome.runtime.onMessage.removeListener(listener);
          reject(new Error(`Could not read this page: ${err.message}`));
        });

      setTimeout(() => {
        if (!settled) {
          chrome.runtime.onMessage.removeListener(listener);
          reject(new Error("Timed out scanning the page — the list may not have loaded, or this site isn't supported yet."));
        }
      }, 20000);
    };

    run();
  });
}

async function runScanAndFilter() {
  if (!apiKey || !effectiveResume()) return;
  scanAndFilterBtn.disabled = true;
  saveScanBtn.disabled = true;
  scanStatusLine.classList.remove("err");
  scanStatusLine.textContent = "Reading job list from this page...";
  scanResultsList.innerHTML = "";
  scanResults = [];

  try {
    const jobs = await scanJobListOnActiveTab();
    if (jobs.length === 0) {
      scanStatusLine.textContent = "No jobs found on this page — is it a job listings page?";
      scanStatusLine.classList.add("err");
      return;
    }

    const resume = effectiveResume();
    const matched = [];
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      scanStatusLine.textContent = `Scoring ${i + 1}/${jobs.length}: ${job.title}...`;
      try {
        const userPrompt = `RESUME:\n"""\n${resume}\n"""\n\nJOB TITLE: ${job.title}\nCOMPANY: ${job.company}\nJOB TEXT:\n"""\n${job.description || "(no description available)"}\n"""`;
        const data = await callGeminiWithFallback(BULK_MATCH_SYSTEM_PROMPT, userPrompt, BULK_MATCH_SCHEMA);
        const matchPercent = Math.round(Number(data.match_percent) || 0);
        if (matchPercent > 50) {
          matched.push({
            title: job.title,
            company: job.company,
            url: job.url,
            applyUrl: job.applyUrl || job.url,
            matchPercent,
            techStack: (data.tech_stack || []).slice(0, 7),
            checked: false
          });
        }
      } catch (err) {
        console.warn(`Scan: skipping "${job.title}" — ${err.message}`);
      }
    }

    scanResults = matched;
    renderScanResults();
    scanStatusLine.textContent = matched.length
      ? `${matched.length} of ${jobs.length} scanned jobs matched above 50%.`
      : `Scanned ${jobs.length} jobs — none matched above 50%.`;
    scanStatusLine.classList.add("ok");
    saveScanBtn.disabled = matched.length === 0 || !sheetsWebhookUrl;
  } catch (err) {
    console.error(err);
    scanStatusLine.textContent = err.message || "Couldn't scan this page.";
    scanStatusLine.classList.add("err");
  } finally {
    scanAndFilterBtn.disabled = !(apiKey && effectiveResume());
  }
}

function renderScanResults() {
  scanResultsList.innerHTML = "";
  scanResults.forEach((job, i) => {
    const card = document.createElement("div");
    card.className = "prep-area-card scan-job-card";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = job.checked;
    checkbox.addEventListener("change", () => {
      scanResults[i].checked = checkbox.checked;
    });

    const body = document.createElement("div");
    body.style.flex = "1";
    body.style.minWidth = "0";

    const titleRow = document.createElement("div");
    titleRow.style.display = "flex";
    titleRow.style.justifyContent = "space-between";
    titleRow.style.gap = "8px";

    const titleLink = document.createElement("a");
    titleLink.className = "scan-job-title";
    titleLink.textContent = job.title;
    titleLink.addEventListener("click", () => window.open(job.applyUrl, "_blank"));

    const matchBadge = document.createElement("span");
    matchBadge.className = "scan-job-match";
    matchBadge.textContent = `${job.matchPercent}%`;

    titleRow.append(titleLink, matchBadge);

    const companyLine = document.createElement("div");
    companyLine.className = "scan-job-company";
    companyLine.textContent = job.company;

    const tagsRow = document.createElement("div");
    tagsRow.className = "prep-question-badges";
    tagsRow.style.marginTop = "6px";
    job.techStack.forEach((tech) => tagsRow.appendChild(makeQBadge(tech, "cat")));

    body.append(titleRow, companyLine, tagsRow);
    card.append(checkbox, body);
    scanResultsList.appendChild(card);
  });
}

async function saveScanResultsToSheet() {
  if (!sheetsWebhookUrl || scanResults.length === 0) return;
  saveScanBtn.disabled = true;
  saveScanBtn.textContent = "Saving...";

  const payload = {
    type: "job_scan",
    date: new Date().toISOString().slice(0, 10),
    jobs: scanResults.map((job) => ({
      title: job.title,
      company: job.company,
      url: job.url,
      matchPercent: job.matchPercent,
      status: job.checked ? "Applied" : "Pending"
    }))
  };

  try {
    await fetch(sheetsWebhookUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    saveScanBtn.textContent = "✓ Saved";
    scanStatusLine.textContent = "Saved to MatcherJobs sheet.";
    scanStatusLine.classList.remove("err");
    scanStatusLine.classList.add("ok");
  } catch (err) {
    console.error(err);
    scanStatusLine.textContent = "Could not save to Sheets. Check the webhook URL.";
    scanStatusLine.classList.add("err");
  } finally {
    setTimeout(() => {
      saveScanBtn.textContent = "💾 Save";
      saveScanBtn.disabled = scanResults.length === 0 || !sheetsWebhookUrl;
    }, 2200);
  }
}

scanAndFilterBtn.addEventListener("click", runScanAndFilter);
saveScanBtn.addEventListener("click", saveScanResultsToSheet);

init();
