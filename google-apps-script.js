
const MASTER_LOG_SHEET_NAME = "Job Match Log";
const MASTER_LOG_HEADERS = ["Date", "Company Name", "Job Title", "ATS Score (%)", "Interview Chance (%)", "Missing Skills", "Job URL"];

const COMPANY_SHEET_HEADERS = ["Question"];

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

  const areas = Array.isArray(data.areas) ? data.areas : [];
  const questionTexts = [];
  areas.forEach((area) => {
    const questions = Array.isArray(area.questions) ? area.questions : [];
    questions.forEach((q) => {
      if (q.text) questionTexts.push([q.text]);
    });
  });

  // Full-snapshot sync: each save replaces the tab's question list with the
  // current full set, so re-syncing never creates duplicate rows.
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
  if (questionTexts.length > 0) {
    sheet.getRange(2, 1, questionTexts.length, 1).setValues(questionTexts);
  }

  return { status: "ok", sheet: sheet.getName(), rows: questionTexts.length };
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
