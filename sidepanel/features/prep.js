import { state } from "../state/store.js";
import { callGeminiWithFallback, isRetryableError, formatModelRetryMessage } from "../services/geminiClient.js";
import { postToSheets } from "../services/sheetsSync.js";
import { setPrepJobState } from "../services/storage.js";
import { extractJobTextFromActiveTab, askInTab, ANSWER_PROVIDER_URLS } from "../services/tabMessaging.js";
import { buildEditablePrompt } from "../services/promptHelpers.js";
import { slugify } from "../ui/format.js";
import { makeQBadge } from "../ui/renderHelpers.js";
import { createStatusLine } from "../ui/statusLine.js";
import {
  prepStatusLine,
  generatePrepBtn,
  updateFocusBtn,
  savePrepSheetsBtn,
  prepDashboard,
  prepProgressValue,
  prepProgressFill,
  prepDonutSvg,
  prepDonutLegend,
  prepAreasList,
  prepRecruiterInsights,
  prepJobIdentity,
  prepJobTitleEl,
  prepCompanyNameEl
} from "../ui/dom.js";

// Seeds the Interview Prep box in Settings > Custom AI Instructions the first time it's opened.
// Anything the user types there fully replaces this body (PREP_OVERVIEW_FIXED_SUFFIX always stays
// appended and isn't editable, so the response still matches PREP_OVERVIEW_SCHEMA).
export const DEFAULT_PREP_OVERVIEW_PROMPT = `You are an expert technical interview coach who has studied thousands of real candidate-reported interview experiences from Glassdoor, TeamBlind, and Prepfully.

Given a JOB DESCRIPTION, identify the company_name and job_title exactly as posted, then predict the realistic focus areas of this role's interview process and how much each is typically weighted.

Rules:
- Return 3 to 6 areas tailored to this specific role — do not force a fixed generic list. A backend role might get "Coding & Data Structures", "System Design", "Databases"; a frontend role might get "JavaScript Deep-Dive", "UI/Performance", "System Design (Frontend)"; adjust freely to what this posting actually describes.
- Each area needs: title (short, 2-5 words), predicted_round (a short realistic label like "Round 1 — Online Assessment", "Round 3 — Onsite", "Final Round"), and weight_percent (a whole number).
- weight_percent values across ALL areas MUST sum to exactly 100.
- Order areas the way they'd realistically occur in an interview loop, earliest first.
- If RECRUITER INSIGHTS are provided below the job description, treat them as ground truth that overrides your own guesses — adjust area titles, rounds, and weights to match what the recruiter actually said.`;

const PREP_OVERVIEW_FIXED_SUFFIX = "Respond with ONLY a single valid JSON object matching the schema. No markdown, no commentary.";

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

function effectivePrepSources() {
  return {
    gemini: state.settings.prepSourceSelection.gemini && !!state.settings.apiKey,
    tavily: state.settings.prepSourceSelection.tavily && !!state.settings.tavilyKey,
    deepseek: state.settings.prepSourceSelection.deepseek && !!state.settings.deepseekKey,
    openai: state.settings.prepSourceSelection.openai && !!state.settings.openaiKey,
    perplexity: state.settings.prepSourceSelection.perplexity && !!state.settings.perplexityKey
  };
}

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
  if (!state.prep.jobUrl || !state.tab.currentTabId) return;
  await setPrepJobState(state.prep.jobUrl, {
    areas: state.prep.areas,
    recruiterNotes: state.prep.recruiterNotes,
    companyName: state.prep.companyName,
    jobTitle: state.prep.jobTitle,
    savedAt: Date.now()
  });
}

function refreshPrepSheetsButton() {
  if (!savePrepSheetsBtn) return;
  const enabled = !!state.settings.sheetsWebhookUrl && state.prep.areas.length > 0 && !!state.prep.jobUrl;
  savePrepSheetsBtn.disabled = !enabled;
  savePrepSheetsBtn.title = enabled ? "" : "Add a Google Sheets Webhook URL and generate prep to save progress.";
}

function schedulePrepSheetSave() {
  if (!state.settings.sheetsWebhookUrl || !state.prep.jobUrl || state.prep.areas.length === 0) return;
  if (state.prep.autoSaveTimer) clearTimeout(state.prep.autoSaveTimer);
  state.prep.autoSaveTimer = setTimeout(() => {
    savePrepProgressToSheets({ silent: true });
    state.prep.autoSaveTimer = null;
  }, 600);
}

async function savePrepProgressToSheets({ silent } = {}) {
  if (!state.settings.sheetsWebhookUrl || !state.prep.areas.length || !state.prep.jobUrl) return;

  const payload = {
    type: "interview_prep",
    date: new Date().toISOString().slice(0, 10),
    companyName: state.prep.companyName || state.matcher.lastResult?.company_name || state.matcher.lastCompanyGuess || "Unknown Company",
    jobTitle: state.prep.jobTitle || state.matcher.lastResult?.job_title || "Unknown Role",
    jobUrl: state.matcher.lastJobUrl || state.prep.jobUrl || "",
    progressPercent: computePrepProgress(),
    recruiterInsights: state.prep.recruiterNotes || "",
    areas: state.prep.areas.map((area) => ({
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
    await postToSheets(state.settings.sheetsWebhookUrl, payload);
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

const setPrepStatus = createStatusLine(prepStatusLine);

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
  generatePrepBtn.disabled = isBusy || !state.settings.apiKey;
  if (updateFocusBtn) updateFocusBtn.disabled = isBusy || !state.settings.apiKey;
  if (isBusy) setPrepStatus(label || "Working...");
}

function computePrepProgress() {
  if (state.prep.areas.length === 0) return 0;
  let total = 0;
  for (const area of state.prep.areas) {
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

function buildAnswerPrompt(questionText) {
  return `Answer this interview question exactly like a lead engineer would in a real interview — cover every edge case and possibility, don't leave anything out, and explain your reasoning clearly the way you'd walk an interviewer through it out loud:\n\n"${questionText}"`;
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

async function geminiScanQuestions(area) {
  const userPrompt = `JOB DESCRIPTION:\n"""\n${state.matcher.lastJobText}\n"""\n\nINTERVIEW AREA: ${area.title} (${area.predictedRound})`;
  const result = await callGeminiWithFallback(state.settings.apiKey, PREP_QUESTIONS_SYSTEM_PROMPT, userPrompt, PREP_QUESTIONS_SCHEMA);
  return Array.isArray(result.questions) ? result.questions.filter(Boolean) : [];
}

async function fetchAreaQuestions(area, els) {
  const { fetchBtn, statusEl, questionsListEl, masterCheckbox } = els;

  if (!state.settings.apiKey) {
    setPrepStatus("Add your Gemini API key in Settings first — it powers question consolidation.", "err");
    chrome.runtime.openOptionsPage();
    return;
  }
  if (!state.matcher.lastJobText) {
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

  const company = state.prep.companyName || state.matcher.lastResult?.company_name || "";
  const jobTitle = state.prep.jobTitle || state.matcher.lastResult?.job_title || "";

  try {
    statusEl.textContent = `Scanning ${prepScanSourcesLabel()}...`;

    const { scanNonGeminiSources } = await import(chrome.runtime.getURL("sidepanel/services/aiProviders.js"));

    const scanCtx = {
      company,
      jobTitle,
      areaTitle: area.title,
      areaRound: area.predictedRound,
      jobDescription: state.matcher.lastJobText,
      recruiterNotes: state.prep.recruiterNotes,
      keys: {
        tavily: active.tavily ? state.settings.tavilyKey : "",
        deepseek: active.deepseek ? state.settings.deepseekKey : "",
        openai: active.openai ? state.settings.openaiKey : "",
        perplexity: active.perplexity ? state.settings.perplexityKey : ""
      },
      models: { deepseek: state.settings.deepseekModel, openai: state.settings.openaiModel, perplexity: state.settings.perplexityModel }
    };

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

    statusEl.textContent = `Consolidating ${rawItems.length} results from ${sourcesUsed.length} source(s)...`;

    const consolidationPrompt = `COMPANY: ${company || "Unknown"}\nJOB TITLE: ${jobTitle || "Unknown"}\nINTERVIEW AREA: ${area.title} (${area.predictedRound})\n\nRAW COMBINED QUESTIONS/SNIPPETS (from ${sourcesUsed.join(", ")}):\n"""\n${rawItems.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n"""`;

    const consolidated = await callGeminiWithFallback(
      state.settings.apiKey,
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
  state.prep.areas.forEach((area, i) => {
    prepAreasList.appendChild(buildAreaCard(area, i));
  });

  const hasAreas = state.prep.areas.length > 0;
  if (prepJobIdentity) {
    prepJobIdentity.classList.toggle("hidden", !hasAreas);
    if (prepJobTitleEl) prepJobTitleEl.textContent = state.prep.jobTitle || "Role title unavailable";
    if (prepCompanyNameEl) prepCompanyNameEl.textContent = state.prep.companyName || "Company unavailable";
  }
  renderPrepDonut(state.prep.areas);
  renderPrepDonutLegend(state.prep.areas);
  renderPrepProgress();
  refreshPrepSheetsButton();
  prepDashboard.classList.toggle("hidden", !hasAreas);
  generatePrepBtn.classList.remove("hidden");
}

async function runGeneratePrep({ forceRegenerate } = {}) {
  if (!state.settings.apiKey) {
    setPrepStatus("Add your Gemini API key in Settings first.", "err");
    chrome.runtime.openOptionsPage();
    return;
  }

  try {
    setPrepBusy(true, state.matcher.lastJobText ? "Predicting interview focus areas..." : "Reading the page...");

    if (!state.matcher.lastJobText) {
      const extracted = await extractJobTextFromActiveTab(state.tab.currentTabId);
      state.matcher.lastJobText = extracted.text;
      state.matcher.lastJobUrl = extracted.url;
      state.matcher.lastCompanyGuess = extracted.company;
    }
    if (!state.matcher.lastJobText || state.matcher.lastJobText.length < 50) {
      throw new Error("Couldn't find enough job description text on this page.");
    }

    const recruiterNotes = prepRecruiterInsights?.value.trim() || "";
    state.prep.recruiterNotes = recruiterNotes;

    setPrepStatus("Predicting interview focus areas...");
    const notesSection = recruiterNotes
      ? `RECRUITER INSIGHTS:\n"""\n${recruiterNotes}\n"""\n\n`
      : "";
    const userPrompt = `JOB DESCRIPTION:\n"""\n${state.matcher.lastJobText}\n"""\n\n${notesSection}`;
    const result = await callGeminiWithFallback(
      state.settings.apiKey,
      buildEditablePrompt(state.settings.customInstructions.prep, DEFAULT_PREP_OVERVIEW_PROMPT, PREP_OVERVIEW_FIXED_SUFFIX),
      userPrompt,
      PREP_OVERVIEW_SCHEMA,
      (model) => setPrepStatus(`Busy — switching to ${model} and retrying...`)
    );

    state.prep.jobUrl = state.matcher.lastJobUrl;
    state.prep.companyName = result.company_name || state.matcher.lastCompanyGuess || "";
    state.prep.jobTitle = result.job_title || "";
    state.prep.areas = normalizeAreas([
      ...(result.areas || []),
      { title: "🔮 AI Company & Stack Predictions", predicted_round: "Any Round — Wildcard", weight_percent: 15 }
    ]);
    renderPrepAreas();
    await savePrepState();
    if (state.settings.sheetsWebhookUrl) {
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
