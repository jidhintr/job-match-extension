/**
 * JOB TRACKER 26 - UNIFIED APPS SCRIPT BACKEND
 * Handles persistence, sync, and updates across devices into a single sheet.
 */

const SHEET_NAME = "Job Tracker 26";
const SHEET_HEADERS = [
  "Job URL",              // Col A - Primary Key
  "DateTime",             // Col B
  "Company Name",         // Col C
  "Job Title",            // Col D
  "ATS Score (%)",        // Col E
  "Interview Chance (%)", // Col F
  "Missing Skills",       // Col G
  "Skills to Add",        // Col H
  "Skills to Remove",     // Col I
  "Status"                // Col J - free text; the extension's Settings controls which labels are offered
];

const STATUS_DEFAULT = "Pending";

function createJsonResponse(payload) {
  const output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);
  output.setHeader("Content-Type", "application/json");
  output.setHeader("Access-Control-Allow-Origin", "*");
  output.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  output.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return output;
}

/**
 * Gets or creates the single target sheet with frozen headers.
 */
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // Set headers if blank
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SHEET_HEADERS);
    sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else {
    // Ensure existing sheet matches header count if modified
    const existingCount = sheet.getLastColumn();
    if (existingCount < SHEET_HEADERS.length) {
      const missing = SHEET_HEADERS.slice(existingCount);
      sheet.getRange(1, existingCount + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
    }
  }

  return sheet;
}

/**
 * Formats standard JavaScript dates to ISO string format.
 */
function formatDateCell(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  }
  return value || new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Finds row index by Job URL (Column A).
 * Returns -1 if not found.
 */
function findRowByJobUrl(sheet, jobUrl) {
  const lastRow = sheet.getLastRow();
  if (!jobUrl || lastRow < 2) return -1;

  const urls = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < urls.length; i++) {
    if (String(urls[i][0]).trim() === String(jobUrl).trim()) {
      return i + 2; // Offset for 1-based index and header row
    }
  }
  return -1;
}

/**
 * Upsert job analysis payload into 'Job Tracker 26'.
 * Direct code execution (0 AI tokens spent).
 */
function handleJobUpsert(data) {
  const sheet = getOrCreateSheet();
  const jobUrl = String(data.jobUrl || "").trim();

  if (!jobUrl) {
    return { status: "error", message: "Job URL is required." };
  }

  // status forces a value on both append and update. defaultStatus only applies when appending a
  // brand new row, so the matcher's auto-save can stamp "Analysed" on first sight of a job without
  // ever resetting a row the user has since moved to Applied/Rejected.
  const appendStatus = data.status || data.defaultStatus || STATUS_DEFAULT;

  const rowValues = [
    jobUrl,                                                 // Col A: Job URL
    formatDateCell(data.dateTime || data.date),            // Col B: DateTime
    data.companyName || "",                                // Col C: Company
    data.jobTitle || "",                                   // Col D: Job Title
    data.atsScore ?? "",                                   // Col E: ATS Score
    data.interviewChance ?? "",                            // Col F: Interview Chance
    data.missingSkills || "",                              // Col G: Missing Skills
    data.addSkills || data.skillsToAdd || "",              // Col H: Skills to Add
    data.removeSkills || data.skillsToRemove || "",        // Col I: Skills to Remove
    String(appendStatus).trim()                            // Col J: Status — any label the extension's Settings defines
  ];

  const rowIndex = findRowByJobUrl(sheet, jobUrl);

  if (rowIndex !== -1) {
    // Preserve existing status if status was not explicitly passed
    if (!data.status) {
      const existingStatus = sheet.getRange(rowIndex, 10).getValue();
      if (existingStatus) rowValues[9] = existingStatus;
    }
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
    return { status: "ok", action: "updated", row: rowIndex };
  } else {
    sheet.appendRow(rowValues);
    return { status: "ok", action: "appended", row: sheet.getLastRow() };
  }
}

/**
 * Fast status updates from UI Card controls.
 */
function updateJobStatus(data) {
  const status = String(data.status || "").trim();
  if (!status) {
    return { status: "error", message: "Status is required." };
  }

  const sheet = getOrCreateSheet();
  const rowIndex = findRowByJobUrl(sheet, data.jobUrl);

  if (rowIndex === -1) {
    return { status: "error", message: "Job URL not found in sheet." };
  }

  sheet.getRange(rowIndex, 10).setValue(status); // Col J = Status
  return { status: "ok", action: "status_updated", row: rowIndex, newStatus: status };
}

/**
 * Fetches all jobs to populate UI Cards on the 'Tracker' tab.
 */
function handleJobMatchList() {
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return { status: "ok", items: [] };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, SHEET_HEADERS.length).getValues();

  const items = rows
    .filter((row) => row[0]) // Ensure Job URL exists
    .map((row) => ({
      jobUrl: row[0],
      dateTime: formatDateCell(row[1]),
      companyName: row[2],
      jobTitle: row[3],
      atsScore: row[4],
      interviewChance: row[5],
      missingSkills: row[6],
      addSkills: row[7],
      removeSkills: row[8],
      status: row[9] || STATUS_DEFAULT
    }));

  return { status: "ok", items };
}

/**
 * POST Webhook entry point
 */
function doPost(e) {
  if (e && e.parameter && e.parameter.method === "OPTIONS") {
    return createJsonResponse({ status: "ok" });
  }

  try {
    const data = JSON.parse(e.postData.contents);
    let result;

    if (data.type === "update_status" || data.type === "update_gap_status") {
      result = updateJobStatus(data);
    } else {
      // Default action: save/update full job entry
      result = handleJobUpsert(data);
    }

    return createJsonResponse(result);
  } catch (err) {
    return createJsonResponse({ status: "error", message: String(err) });
  }
}

/**
 * GET Webhook entry point
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.method === "OPTIONS") {
    return createJsonResponse({ status: "ok" });
  }

  try {
    return createJsonResponse(handleJobMatchList());
  } catch (err) {
    return createJsonResponse({ status: "error", message: String(err) });
  }
}
