// Multi-source scanners for Interview Prep's "Fetch Deep-Dive Questions" step.
//
// Architecture (see sidepanel.js fetchAreaQuestions for the orchestration):
//   1. SCAN — every configured source below is queried IN PARALLEL via
//      Promise.allSettled. Each returns raw questions/snippets; a missing key
//      or a failing provider just yields nothing rather than sinking the batch.
//   2. CONSOLIDATE — the combined raw pile is handed to Gemini alone (in
//      sidepanel.js, via callGeminiWithFallback) to dedupe, group, and rank.
//
// This module only does step 1 for the NON-Gemini sources (Tavily live web,
// DeepSeek, OpenAI). Gemini both participates in the scan and does the sole
// consolidation, but those calls live in sidepanel.js because they need its
// cascade + api key. Loaded via dynamic import() only when a scan runs.

const QUESTION_SYSTEM_PROMPT = `You are an expert technical interview coach with deep knowledge of real candidate-reported interview questions from Glassdoor, Reddit, LeetCode, and TeamBlind.

Given a company, job title, and one specific interview focus area, produce 6 to 10 realistic interview questions actually asked for that area at that company — grounded in real reported patterns, not generic textbook questions.

Respond with ONLY a valid JSON object of this exact shape and nothing else:
{ "questions": ["<one concise interview question>", "..."] }`;

function buildQuestionUserPrompt({ company, jobTitle, areaTitle, areaRound, jobDescription, recruiterNotes }) {
  let prompt = `Company: ${company || "Unknown"}\nJob Title: ${jobTitle || "Unknown"}\nInterview Area: ${areaTitle} (${areaRound || "unspecified round"})`;
  if (jobDescription) prompt += `\n\nJOB DESCRIPTION:\n"""\n${jobDescription}\n"""`;
  if (recruiterNotes) prompt += `\n\nRECRUITER INSIGHTS:\n"""\n${recruiterNotes}\n"""`;
  return prompt;
}

function extractJsonBlock(rawText) {
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    // Providers without enforced JSON mode (Perplexity/Tavily answers, some
    // completions) may wrap JSON in prose or citations — grab the first {...}.
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v : v?.question || v?.text || ""))
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------- OpenAI-compatible chat providers (DeepSeek, OpenAI) ----------
async function scanOpenAICompatible({ endpoint, apiKey, model, promptCtx, supportsJsonMode }) {
  const body = {
    model,
    messages: [
      { role: "system", content: QUESTION_SYSTEM_PROMPT },
      { role: "user", content: buildQuestionUserPrompt(promptCtx) }
    ]
  };
  if (supportsJsonMode) body.response_format = { type: "json_object" };

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || `Request failed (HTTP ${response.status}).`);
  }
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = extractJsonBlock(content);
  return toStringArray(parsed?.questions);
}

export function scanDeepSeek({ apiKey, model, ...promptCtx }) {
  return scanOpenAICompatible({
    endpoint: "https://api.deepseek.com/chat/completions",
    apiKey,
    model: model || "deepseek-v4-flash",
    promptCtx,
    supportsJsonMode: true
  });
}

export function scanOpenAI({ apiKey, model, ...promptCtx }) {
  return scanOpenAICompatible({
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey,
    model: model || "gpt-5-mini",
    promptCtx,
    supportsJsonMode: true
  });
}

// ---------- Tavily (live web search) ----------
// Returns raw snippets/answer text rather than clean questions — the Gemini
// consolidation pass extracts the actual questions from these web excerpts.
export async function scanTavily({ apiKey, company, jobTitle, areaTitle }) {
  const query = `${company || ""} ${jobTitle || ""} interview questions ${areaTitle || ""} candidate reported`.trim();

  const response = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      max_results: 8,
      include_answer: "advanced",
      include_domains: ["glassdoor.com", "leetcode.com", "reddit.com", "teamblind.com"]
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || data?.detail || `Tavily search failed (HTTP ${response.status}).`);
  }

  const snippets = [];
  if (data?.answer) snippets.push(data.answer);
  for (const result of Array.isArray(data?.results) ? data.results : []) {
    const piece = [result.title, result.content].filter(Boolean).join(" — ");
    if (piece) snippets.push(piece);
  }
  return snippets;
}

// ---------- Parallel orchestrator for the non-Gemini sources ----------
// Returns { items: string[], sourcesUsed: string[], errors: [{source,message}] }.
// Never throws — a failed/unconfigured source is captured, not propagated,
// so one bad key can't sink the whole scan.
export async function scanNonGeminiSources(ctx) {
  const { keys, models } = ctx;
  const tasks = [];

  if (keys.tavily) {
    tasks.push({
      source: "Tavily (web)",
      run: () => scanTavily({ apiKey: keys.tavily, company: ctx.company, jobTitle: ctx.jobTitle, areaTitle: ctx.areaTitle })
    });
  }
  if (keys.deepseek) {
    tasks.push({
      source: "DeepSeek",
      run: () => scanDeepSeek({ apiKey: keys.deepseek, model: models.deepseek, ...ctx })
    });
  }
  if (keys.openai) {
    tasks.push({
      source: "OpenAI",
      run: () => scanOpenAI({ apiKey: keys.openai, model: models.openai, ...ctx })
    });
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));

  const items = [];
  const sourcesUsed = [];
  const errors = [];
  settled.forEach((res, i) => {
    const source = tasks[i].source;
    if (res.status === "fulfilled" && res.value.length) {
      items.push(...res.value);
      sourcesUsed.push(source);
    } else if (res.status === "rejected") {
      errors.push({ source, message: res.reason?.message || String(res.reason) });
    }
  });

  return { items, sourcesUsed, errors };
}
