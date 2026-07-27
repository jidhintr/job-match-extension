import { state } from "../state/store.js";
import { callGeminiWithFallback, isRetryableError, formatModelRetryMessage } from "../services/geminiClient.js";
import { postToSheets } from "../services/sheetsSync.js";
import { extractJobTextFromActiveTab } from "../services/tabMessaging.js";
import { fillList, fillPills, fillTechGapTable } from "../ui/renderHelpers.js";
import { clampScore } from "../ui/format.js";
import {
  analyzeBtn,
  reanalyzeBtn,
  saveSheetsBtn,
  dashboard,
  glitterLayer,
  atsGauge,
  chanceGauge,
  jobIdentity,
  jobRoleTitle,
  jobCompanyName,
  goodFitList,
  goodFitListMore,
  goodFitToggle,
  report,
  emptyState,
  warningsBanner
} from "../ui/dom.js";
import {
  effectiveResume,
  hasUsableResume,
  setStatus,
  refreshSaveSheetsButton,
  refreshApplyButtons,
  persistTabSessionState
} from "./bootstrap.js";

export const RESUME_SECTIONS = [
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

export const DEFAULT_SECTION_ORDER = RESUME_SECTIONS.map((s) => ({ id: s.id, enabled: true }));

function buildAnalysisPromptAndSchema(sectionOrder) {
  const enabledIds = (sectionOrder || DEFAULT_SECTION_ORDER).filter((s) => s.enabled).map((s) => s.id);
  const enabledSections = RESUME_SECTIONS.filter((s) => enabledIds.includes(s.id));

  let step = 4;
  const stepLines = enabledSections.map((s) => `${step++}. ${s.promptStep}`).join("\n");

  const candidateContext = (state.settings.customInstructions.matcher || "").trim() || "(none provided)";
  const systemPrompt = `You are an expert technical recruiter, ATS (Applicant Tracking System) simulator, and career coach with 15+ years of experience hiring for technology roles.

You will be given a candidate's MASTER RESUME and a JOB DESCRIPTION. Analyze the resume strictly against the job description and produce a brutally honest, actionable evaluation.

CANDIDATE CONTEXT (apply to every analysis, regardless of what's in the resume text):
"""
${candidateContext}
"""
If the context above describes a hard disqualifying blocker (e.g. a required language the candidate doesn't speak, or a work-authorization restriction that applies to this specific job), set chance_of_getting_job to 0, set warnings.language_barrier or warnings.visa_sponsorship_concern to a short sentence naming the issue, and keep every other section brief/minimal rather than a full deep analysis. If no such condition applies, set warnings.language_barrier and warnings.visa_sponsorship_concern to empty strings. Still fill ats_score honestly based on skills/keyword match alone regardless.

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

export function sanitizeSectionOrder(saved) {
  if (!Array.isArray(saved) || saved.length === 0) return DEFAULT_SECTION_ORDER.map((s) => ({ ...s }));
  const validIds = new Set(RESUME_SECTIONS.map((s) => s.id));
  const cleaned = saved.filter((s) => s && validIds.has(s.id)).map((s) => ({ id: s.id, enabled: s.enabled !== false }));
  const present = new Set(cleaned.map((s) => s.id));
  RESUME_SECTIONS.forEach((s) => {
    if (!present.has(s.id)) cleaned.push({ id: s.id, enabled: true });
  });
  return cleaned;
}

export function applySectionVisibilityAndOrder() {
  state.settings.resumeSectionOrder.forEach(({ id, enabled }) => {
    const section = RESUME_SECTIONS.find((s) => s.id === id);
    const block = section && document.getElementById(section.blockId);
    if (!block) return;
    block.classList.toggle("hidden", !enabled);
    report.appendChild(block);
  });
}

function setBusy(isBusy, label) {
  analyzeBtn.disabled = isBusy || !state.settings.apiKey || !hasUsableResume();
  reanalyzeBtn.disabled = isBusy || !state.matcher.lastJobText;
  if (isBusy) setStatus(label || "Working...");
}

async function analyzeWithGemini(jobText, onModelSwitch) {
  const userPrompt = `MASTER RESUME:\n"""\n${effectiveResume()}\n"""\n\nJOB DESCRIPTION:\n"""\n${jobText}\n"""`;
  const { systemPrompt, schema } = buildAnalysisPromptAndSchema(state.settings.resumeSectionOrder);
  return callGeminiWithFallback(state.settings.apiKey, systemPrompt, userPrompt, schema, onModelSwitch);
}

for (const gauge of [atsGauge, chanceGauge]) {
  gauge.arcLength = gauge.arc.getTotalLength();
}

const CELEBRATE_THRESHOLD = 80;
const GLITTER_EMOJI = ["✨", "⭐", "🌟", "💫"];

function renderGaugeInto(gauge, score) {
  const clamped = clampScore(score);
  const offset = gauge.arcLength - (clamped / 100) * gauge.arcLength;
  const angle = -90 + (clamped / 100) * 180;

  gauge.arc.style.strokeDashoffset = String(offset);
  gauge.needle.style.transform = `rotate(${angle}deg)`;

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

export function renderReport(result) {
  jobRoleTitle.textContent = result.job_title || "Role title unavailable";
  jobCompanyName.textContent = result.company_name || "Company unavailable";
  jobIdentity.classList.remove("hidden");

  renderWarnings(result.warnings);

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

async function runAnalysis({ reextract }) {
  if (!state.settings.apiKey || !hasUsableResume()) {
    setStatus("Add your API key and resume in Settings first.", "err");
    chrome.runtime.openOptionsPage();
    return;
  }

  try {
    const willReextract = reextract || !state.matcher.lastJobText;
    setBusy(true, willReextract ? "Reading the page..." : "Re-analyzing with updated resume...");

    if (willReextract) {
      const extracted = await extractJobTextFromActiveTab(state.tab.currentTabId);
      state.matcher.lastJobText = extracted.text;
      state.matcher.lastCompanyGuess = extracted.company;
      state.matcher.lastJobUrl = extracted.url;
    }

    if (!state.matcher.lastJobText || state.matcher.lastJobText.length < 50) {
      throw new Error("Couldn't find enough job description text on this page.");
    }

    setStatus(state.matcher.lastCompanyGuess ? `Asking Gemini about ${state.matcher.lastCompanyGuess} for analysis...` : "Asking Gemini for analysis...");
    const result = await analyzeWithGemini(state.matcher.lastJobText, (nextModel) => {
      setStatus(`Busy — switching to ${nextModel} and retrying...`);
    });

    renderReport(result);
    state.matcher.lastResult = result;
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
    reanalyzeBtn.disabled = !state.matcher.lastJobText;
    refreshSaveSheetsButton();
    refreshApplyButtons();
  }
}

async function saveResultToSheets() {
  if (!state.settings.sheetsWebhookUrl || !state.matcher.lastResult) return;

  const addSkills = state.matcher.lastResult.resume_optimization?.add_skills;
  const removeSkills = state.matcher.lastResult.resume_optimization?.remove_skills;

  const payload = {
    type: "job_match",
    date: new Date().toISOString().slice(0, 10),
    companyName: state.matcher.lastResult.company_name || "",
    jobTitle: state.matcher.lastResult.job_title || "",
    atsScore: Math.round(clampScore(state.matcher.lastResult.ats_score)),
    interviewChance: Math.round(clampScore(state.matcher.lastResult.chance_of_getting_job)),
    missingSkills: Array.isArray(state.matcher.lastResult.missing_skills) ? state.matcher.lastResult.missing_skills.join(", ") : "",
    addSkills: Array.isArray(addSkills) ? addSkills.join(", ") : "",
    removeSkills: Array.isArray(removeSkills) ? removeSkills.join(", ") : "",
    jobUrl: state.matcher.lastJobUrl || ""
  };

  saveSheetsBtn.disabled = true;
  saveSheetsBtn.classList.remove("saved");
  saveSheetsBtn.textContent = "Saving...";

  try {
    await postToSheets(state.settings.sheetsWebhookUrl, payload);
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

analyzeBtn.addEventListener("click", () => runAnalysis({ reextract: true }));
reanalyzeBtn.addEventListener("click", () => runAnalysis({ reextract: false }));
saveSheetsBtn.addEventListener("click", saveResultToSheets);

// Triggered by the "analyze-resume" keyboard shortcut (background.js) once the side panel is open.
// Every tab's panel instance receives this message, so only act if it's tagged for THIS tab —
// otherwise triggering the shortcut in one tab would also kick off analysis in every other tab's
// panel that happens to be open.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "JOB_MATCH_SHORTCUT_ANALYZE" && message.tabId === state.tab.currentTabId) {
    runAnalysis({ reextract: true });
  }
});
