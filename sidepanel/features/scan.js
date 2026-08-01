import { state } from "../state/store.js";
import { callGeminiWithFallback } from "../services/geminiClient.js";
import { postToSheets } from "../services/sheetsSync.js";
import { scanJobListOnActiveTab, extractJobTextFromUrl } from "../services/tabMessaging.js";
import { buildEditablePrompt, condenseText, TEXT_LIMITS } from "../services/promptHelpers.js";
import { makeQBadge } from "../ui/renderHelpers.js";
import { createStatusLine } from "../ui/statusLine.js";
import { scanAndFilterBtn, saveScanBtn, scanStatusLine, scanResultsList } from "../ui/dom.js";
import { effectiveResume } from "./bootstrap.js";

const setScanStatus = createStatusLine(scanStatusLine);

// Seeds the Scan Jobs box in Settings > Custom AI Instructions the first time it's opened.
// Anything the user types there fully replaces this body (BULK_MATCH_FIXED_SUFFIX always stays
// appended and isn't editable, so the response still matches BULK_MATCH_SCHEMA).
export const DEFAULT_BULK_MATCH_PROMPT = `You are a fast ATS matching engine. Given a candidate's resume and one job posting (title/company/description, which may be brief), return a realistic match percentage and exactly 7 key technical skills/technologies this posting asks for.

Rules:
- match_percent: whole number 0-100 reflecting realistic fit between resume and posting.
- tech_stack: exactly 7 short tags (e.g. "React", "AWS", "Kubernetes") — the most specific, concrete technologies/skills named in the posting. If the posting text is too short to find 7 distinct technical items, fill remaining slots with the closest relevant domain/soft skills implied by the title — never leave fewer than 7.`;

const BULK_MATCH_FIXED_SUFFIX = `First decide is_job_posting: true only if JOB TEXT actually describes one specific open role with real responsibilities/requirements/qualifications. Set it false for anything that isn't a genuine job description — cookie/privacy notices, login/signup/account pages, talent-network or job-alert signup, generic careers/company homepage, contact pages, search/filter pages, or an apply page with no role details. If is_job_posting is false, set match_percent to 0 and tech_stack to an empty array. Respond with ONLY a valid JSON object matching the schema.`;

const BULK_MATCH_SCHEMA = {
  type: "OBJECT",
  properties: {
    is_job_posting: { type: "BOOLEAN" },
    match_percent: { type: "NUMBER" },
    tech_stack: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["is_job_posting", "match_percent", "tech_stack"]
};

// The response itself is tiny (a flag, a number, 7 tags) but thinking tokens count against this cap
// on the flash models, so it stays well above the visible output size.
const BULK_MATCH_MAX_OUTPUT_TOKENS = 600;

async function runScanAndFilter() {
  if (!state.settings.apiKey || !effectiveResume()) return;
  scanAndFilterBtn.disabled = true;
  saveScanBtn.disabled = true;
  setScanStatus("Reading job list from this page...");
  scanResultsList.innerHTML = "";
  state.scan.results = [];

  try {
    const jobs = await scanJobListOnActiveTab(state.tab.currentTabId);
    if (jobs.length === 0) {
      setScanStatus("No jobs found on this page — is it a job listings page?", "err");
      return;
    }

    // Condensed once, reused for every job — this text is re-sent on each request in the loop.
    const resume = condenseText(effectiveResume(), TEXT_LIMITS.resumeBrief);
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      setScanStatus(`Opening ${i + 1}/${jobs.length}: ${job.title}...`);
      let jobText = job.description || "";
      let company = job.company || "";
      try {
        const page = await extractJobTextFromUrl(job.url);
        if (page.text && page.text.length > jobText.length) jobText = page.text;
        if (page.company && !company) company = page.company;
      } catch (err) {
        console.warn(`Scan: couldn't open "${job.title}" — ${err.message}`);
      }
      if (!company) company = job.companyFallback || "";
      job.company = company;

      setScanStatus(`Scoring ${i + 1}/${jobs.length}: ${job.title}...`);
      try {
        const jobBrief = condenseText(jobText, TEXT_LIMITS.jobBrief) || "(no description available)";
        const userPrompt = `RESUME:\n"""\n${resume}\n"""\n\nJOB TITLE: ${job.title}\nCOMPANY: ${company}\nJOB TEXT:\n"""\n${jobBrief}\n"""`;
        const data = await callGeminiWithFallback(state.settings.apiKey, buildEditablePrompt(state.settings.customInstructions.scan, DEFAULT_BULK_MATCH_PROMPT, BULK_MATCH_FIXED_SUFFIX), userPrompt, BULK_MATCH_SCHEMA, undefined, BULK_MATCH_MAX_OUTPUT_TOKENS);
        const matchPercent = Math.round(Number(data.match_percent) || 0);
        if (data.is_job_posting && matchPercent > 50) {
          const result = {
            title: job.title,
            company: job.company,
            url: job.url,
            applyUrl: job.applyUrl || job.url,
            matchPercent,
            techStack: (data.tech_stack || []).slice(0, 7),
            checked: false
          };
          state.scan.results.push(result);
          appendScanResultCard(result, state.scan.results.length - 1);
          saveScanBtn.disabled = !state.settings.sheetsWebhookUrl;
        }
      } catch (err) {
        console.warn(`Scan: skipping "${job.title}" — ${err.message}`);
      }
    }

    const matchedCount = state.scan.results.length;
    setScanStatus(matchedCount
      ? `${matchedCount} of ${jobs.length} scanned jobs matched above 50%.`
      : `Scanned ${jobs.length} jobs — none matched above 50%.`, "ok");
    saveScanBtn.disabled = matchedCount === 0 || !state.settings.sheetsWebhookUrl;
  } catch (err) {
    console.error(err);
    setScanStatus(err.message || "Couldn't scan this page.", "err");
  } finally {
    scanAndFilterBtn.disabled = !(state.settings.apiKey && effectiveResume());
  }
}

function buildScanCard(job, i) {
  const card = document.createElement("div");
  card.className = "prep-area-card scan-job-card";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = job.checked;
  checkbox.addEventListener("change", () => {
    state.scan.results[i].checked = checkbox.checked;
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
  return card;
}

function appendScanResultCard(job, i) {
  scanResultsList.appendChild(buildScanCard(job, i));
}

async function saveScanResultsToSheet() {
  if (!state.settings.sheetsWebhookUrl || state.scan.results.length === 0) return;
  saveScanBtn.disabled = true;
  saveScanBtn.textContent = "Saving...";

  const dateTime = new Date().toISOString().replace("T", " ").substring(0, 19);

  try {
    for (const job of state.scan.results) {
      const payload = {
        jobUrl: job.url,
        dateTime,
        companyName: job.company,
        jobTitle: job.title,
        atsScore: job.matchPercent,
        status: job.checked ? "Applied" : "Pending"
      };
      await postToSheets(state.settings.sheetsWebhookUrl, payload);
    }
    window.dispatchEvent(new CustomEvent("tracker:refresh"));
    saveScanBtn.textContent = "✓ Saved";
    setScanStatus("Saved to Job Tracker 26 sheet.", "ok");
  } catch (err) {
    console.error(err);
    setScanStatus("Could not save to Sheets. Check the webhook URL.", "err");
  } finally {
    setTimeout(() => {
      saveScanBtn.textContent = "💾 Save";
      saveScanBtn.disabled = state.scan.results.length === 0 || !state.settings.sheetsWebhookUrl;
    }, 2200);
  }
}

scanAndFilterBtn.addEventListener("click", runScanAndFilter);
saveScanBtn.addEventListener("click", saveScanResultsToSheet);
