
const MASTER_LOG_SHEET_NAME = "Job Match Log";
const MASTER_LOG_HEADERS = ["Date", "Company Name", "Job Title", "ATS Score (%)", "Interview Chance (%)", "Missing Skills", "Job URL", "Status"];

const GAPS_SHEET_NAME = "Resume Gaps";
const GAPS_SHEET_HEADERS = ["Job URL", "Date", "Company Name", "Job Title", "Missing Skills", "Skills to Add", "Skills to Remove"];

const SCAN_JOBS_SHEET_NAME = "MatcherJobs";
const SCAN_JOBS_HEADERS = ["Date", "Title", "Company", "URL", "Match %", "Status"];

function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return;
  }
  const existingCount = sheet.getLastColumn();
  if (existingCount < headers.length) {
    const missing = headers.slice(existingCount);
    sheet.getRange(1, existingCount + 1, 1, missing.length).setValues([missing]);
    sheet.getRange(1, existingCount + 1, 1, missing.length).setFontWeight("bold");
  }
}

function upsertGapRow(data) {
  const sheet = getOrCreateSheet(GAPS_SHEET_NAME);
  ensureHeaders(sheet, GAPS_SHEET_HEADERS);

  const jobUrl = data.jobUrl || "";
  const row = [
    jobUrl,
    data.date || "",
    data.companyName || "",
    data.jobTitle || "",
    data.missingSkills || "",
    data.addSkills || "",
    data.removeSkills || ""
  ];

  const lastRow = sheet.getLastRow();
  if (jobUrl && lastRow > 1) {
    const urls = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < urls.length; i++) {
      if (urls[i][0] === jobUrl) {
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sheet.appendRow(row);
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
    data.jobUrl || "",
    data.status || "Applied"
  ]);
  upsertGapRow(data);
  return { status: "ok", sheet: sheet.getName() };
}

function handleJobScanAppend(data) {
  const sheet = getOrCreateSheet(SCAN_JOBS_SHEET_NAME);
  ensureHeaders(sheet, SCAN_JOBS_HEADERS);

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const rows = jobs.map((j) => [
    data.date || "",
    j.title || "",
    j.company || "",
    j.url || "",
    j.matchPercent ?? "",
    j.status || ""
  ]);
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SCAN_JOBS_HEADERS.length).setValues(rows);
  }

  return { status: "ok", sheet: sheet.getName(), rows: rows.length };
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    let result;
    if (data.type === "job_scan") result = handleJobScanAppend(data);
    else result = handleJobMatchLog(data);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", sheet: MASTER_LOG_SHEET_NAME }))
    .setMimeType(ContentService.MimeType.JSON);
}
