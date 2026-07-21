/**
 * Paste this into Extensions → Apps Script on the Google Sheet you want to log to,
 * replacing the default Code.gs contents. Then Deploy → Manage deployments → edit
 * (pencil) → New version → Deploy. Copy the /exec URL into the extension's Settings
 * page as the Google Sheets Webhook URL.
 *
 * The extension can't read the response back (see sidepanel.js for why), so this
 * only needs to succeed server-side — but it still returns JSON for manual testing.
 *
 * Two independent payload shapes land here, distinguished by `type`:
 *   - "job_match"      — Resume Matcher's condensed per-job row (Date/Company/Title/
 *                         ATS/Chance/MissingSkills/URL) → appended to one shared log tab.
 *   - "interview_prep"  — Interview Prep's per-question progress → written to a tab
 *                         named after the company, fully rewritten (not appended) each
 *                         save so re-syncing never creates duplicate rows.
 */

const MASTER_LOG_SHEET_NAME = "Job Match Log";
const MASTER_LOG_HEADERS = ["Date", "Company Name", "Job Title", "ATS Score (%)", "Interview Chance (%)", "Missing Skills", "Job URL"];

const COMPANY_SHEET_HEADERS = [
  "Job Title",
  "Job URL",
  "Overall Progress (%)",
  "Recruiter Insights",
  "Area",
  "Predicted Round",
  "Area Weight (%)",
  "Area Completed",
  "Question",
  "Category",
  "Difficulty",
  "Frequency",
  "Question Completed",
  "Last Synced"
];

function sanitizeSheetName(name) {
  // Google Sheets tab names can't contain : \ / ? * [ ] and must be <= 100 chars.
  const cleaned = String(name || "Unknown Company").replace(/[:\\\/\?\*\[\]]/g, " ").trim();
  return cleaned.slice(0, 100) || "Unknown Company";
}

function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
}

function handleJobMatchLog(data) {
  const sheet = getOrCreateSheet(MASTER_LOG_SHEET_NAME);
  ensureHeaders(sheet, MASTER_LOG_HEADERS);
  sheet.appendRow([
    data.date || "",
    data.companyName || "",
    data.jobTitle || "",
    data.atsScore ?? "",
    data.interviewChance ?? "",
    data.missingSkills || "",
    data.jobUrl || ""
  ]);
  return { status: "ok", sheet: sheet.getName() };
}

function handleInterviewPrepSync(data) {
  const sheetName = sanitizeSheetName(data.companyName);
  const sheet = getOrCreateSheet(sheetName);
  ensureHeaders(sheet, COMPANY_SHEET_HEADERS);

  const jobTitle = data.jobTitle || "";
  const jobUrl = data.jobUrl || "";
  const progress = data.progressPercent ?? "";
  const notes = data.recruiterInsights || "";
  const now = data.date || new Date().toISOString();
  const areas = Array.isArray(data.areas) ? data.areas : [];

  const rows = [];
  areas.forEach((area) => {
    const base = [jobTitle, jobUrl, progress, notes, area.title || "", area.predictedRound || "", area.weightPercent ?? "", area.completed ? "Yes" : "No"];
    const questions = Array.isArray(area.questions) ? area.questions : [];
    if (questions.length === 0) {
      rows.push([...base, "", "", "", "", "", now]);
    } else {
      questions.forEach((q) => {
        rows.push([...base, q.text || "", q.category || "", q.difficulty || "", q.frequency || "", q.checked ? "Yes" : "No", now]);
      });
    }
  });

  // Full-snapshot sync, not append: each save represents the complete current
  // state, so we clear existing data rows first — otherwise every checkbox
  // toggle would pile up a new set of duplicate rows instead of updating in place.
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, COMPANY_SHEET_HEADERS.length).setValues(rows);
  }

  return { status: "ok", sheet: sheet.getName(), rows: rows.length };
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const result = data.type === "interview_prep" ? handleInterviewPrepSync(data) : handleJobMatchLog(data);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Visiting the deployed /exec URL in a browser hits this — useful to confirm
// the deployment is live and pointed at the right sheet before wiring it up.
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", sheet: MASTER_LOG_SHEET_NAME }))
    .setMimeType(ContentService.MimeType.JSON);
}
