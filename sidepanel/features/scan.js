import { state } from "../state/store.js";
import { callGeminiWithFallback } from "../services/geminiClient.js";
import { postToSheets } from "../services/sheetsSync.js";
import { scanJobListOnActiveTab } from "../services/tabMessaging.js";
import { buildEditablePrompt } from "../services/promptHelpers.js";
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

const BULK_MATCH_FIXED_SUFFIX = "Respond with ONLY a valid JSON object matching the schema.";

const BULK_MATCH_SCHEMA = {
  type: "OBJECT",
  properties: {
    match_percent: { type: "NUMBER" },
    tech_stack: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["match_percent", "tech_stack"]
};

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

    const resume = effectiveResume();
    const matched = [];
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      setScanStatus(`Scoring ${i + 1}/${jobs.length}: ${job.title}...`);
      try {
        const userPrompt = `RESUME:\n"""\n${resume}\n"""\n\nJOB TITLE: ${job.title}\nCOMPANY: ${job.company}\nJOB TEXT:\n"""\n${job.description || "(no description available)"}\n"""`;
        const data = await callGeminiWithFallback(state.settings.apiKey, buildEditablePrompt(state.settings.customInstructions.scan, DEFAULT_BULK_MATCH_PROMPT, BULK_MATCH_FIXED_SUFFIX), userPrompt, BULK_MATCH_SCHEMA);
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

    state.scan.results = matched;
    renderScanResults();
    setScanStatus(matched.length
      ? `${matched.length} of ${jobs.length} scanned jobs matched above 50%.`
      : `Scanned ${jobs.length} jobs — none matched above 50%.`, "ok");
    saveScanBtn.disabled = matched.length === 0 || !state.settings.sheetsWebhookUrl;
  } catch (err) {
    console.error(err);
    setScanStatus(err.message || "Couldn't scan this page.", "err");
  } finally {
    scanAndFilterBtn.disabled = !(state.settings.apiKey && effectiveResume());
  }
}

function renderScanResults() {
  scanResultsList.innerHTML = "";
  state.scan.results.forEach((job, i) => {
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
    scanResultsList.appendChild(card);
  });
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
