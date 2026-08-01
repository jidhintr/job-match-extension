import { state } from "../state/store.js";
import { callGeminiWithFallback, isRetryableError, formatModelRetryMessage } from "../services/geminiClient.js";
import { buildEditablePrompt, condenseText, TEXT_LIMITS } from "../services/promptHelpers.js";
import { fmtMoney } from "../ui/format.js";
import { checkSalaryBtn, salaryResult, salaryResultBody } from "../ui/dom.js";
import { effectiveResume, setApplyStatus, refreshApplyButtons } from "./bootstrap.js";

// Seeds the Salary box in Settings > Custom AI Instructions the first time it's opened. Anything
// the user types there fully replaces this body (SALARY_FIXED_SUFFIX always stays appended and
// isn't editable, so the response still matches SALARY_SCHEMA).
export const DEFAULT_SALARY_PROMPT = `You are a compensation analyst with broad knowledge of global tech salary benchmarks, cost of living, taxation, and market standards.

Given a JOB DESCRIPTION (which states or implies a location) and role/company context — plus optional live web search snippets if provided — estimate a realistic salary for this specific role at this specific company/location, informed by market standards, typical tax burden, and inflation for that location.

Rules:
- Identify the job's location (city/country) from the posting; if unclear, assume Poland.
- local_currency is that location's actual currency (e.g. "PLN" for Poland, "USD" for the US, etc).
- Give monthly and annual GROSS figures in local currency, in PLN, and in EUR. If local currency is already PLN or EUR, set that duplicate currency's four number fields to 0 and explain why in basis_note — never show identical numbers twice under different labels.
- benefits: 4-8 realistic, specific benefits typical for this role/company/location (health, equity, remote policy, learning budget, etc) — no vague filler.
- negotiation_tips: 3-5 concrete negotiation angles specific to this role and situation (leverage points, what to ask for beyond base pay).
- basis_note: 1-2 sentences on what this estimate is grounded in — it's an informed estimate, not a live quote.`;

const SALARY_FIXED_SUFFIX = "Respond with ONLY a valid JSON object matching the schema.";

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

const SALARY_MAX_OUTPUT_TOKENS = 1500;
const SALARY_WEB_CONTEXT_LIMIT = 1500;

async function checkSalary() {
  if (!state.matcher.lastResult || !state.matcher.lastJobText) return;
  checkSalaryBtn.disabled = true;
  setApplyStatus("Estimating salary...");
  salaryResult.classList.add("hidden");
  try {
    let webContext = "";
    if (state.settings.tavilyKey) {
      try {
        const { scanTavily } = await import(chrome.runtime.getURL("sidepanel/services/aiProviders.js"));
        const snippets = await scanTavily({
          apiKey: state.settings.tavilyKey,
          company: state.matcher.lastResult.company_name,
          jobTitle: state.matcher.lastResult.job_title,
          areaTitle: "salary compensation range benefits"
        });
        if (snippets.length) {
          const trimmed = condenseText(snippets.slice(0, 8).join("\n"), SALARY_WEB_CONTEXT_LIMIT);
          webContext = `\n\nLIVE WEB SEARCH SNIPPETS (salary/benefits related):\n"""\n${trimmed}\n"""`;
        }
      } catch {

      }
    }

    // Pay depends on location, seniority and stack — not on the full posting, so the brief cap is enough.
    const job = condenseText(state.matcher.lastJobText, TEXT_LIMITS.jobBrief);
    const userPrompt = `COMPANY: ${state.matcher.lastResult.company_name || "Unknown"}\nROLE: ${state.matcher.lastResult.job_title || "Unknown"}\n\nJOB DESCRIPTION:\n"""\n${job}\n"""${webContext}`;
    const data = await callGeminiWithFallback(state.settings.apiKey, buildEditablePrompt(state.settings.customInstructions.salary, DEFAULT_SALARY_PROMPT, SALARY_FIXED_SUFFIX), userPrompt, SALARY_SCHEMA, (m) => {
      setApplyStatus(`Busy — switching to ${m}...`);
    }, SALARY_MAX_OUTPUT_TOKENS);
    renderSalaryResult(data);
    setApplyStatus("Salary estimate ready.", "ok");
  } catch (err) {
    console.error(err);
    setApplyStatus(isRetryableError(err) ? formatModelRetryMessage(err, "Gemini") : (err.message || "Couldn't estimate salary."), "err");
  } finally {
    refreshApplyButtons();
  }
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

checkSalaryBtn.addEventListener("click", checkSalary);
