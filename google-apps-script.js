const SHEET_NAME = "Job Tracker 26";
const SHEET_HEADERS = [
  "Job URL",
  "DateTime",
  "Company Name",
  "Job Title",
  "ATS Score (%)",
  "Interview Chance (%)",
  "Missing Skills",
  "Skills to Add",
  "Skills to Remove",
  "Status"
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

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SHEET_HEADERS);
    sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else {
    const existingCount = sheet.getLastColumn();
    if (existingCount < SHEET_HEADERS.length) {
      const missing = SHEET_HEADERS.slice(existingCount);
      sheet.getRange(1, existingCount + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
    }
  }

  return sheet;
}

function formatDateCell(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  }
  return value || new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function findRowByJobUrl(sheet, jobUrl) {
  const lastRow = sheet.getLastRow();
  if (!jobUrl || lastRow < 2) return -1;

  const urls = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < urls.length; i++) {
    if (String(urls[i][0]).trim() === String(jobUrl).trim()) {
      return i + 2;
    }
  }
  return -1;
}

function handleJobUpsert(data) {
  const sheet = getOrCreateSheet();
  const jobUrl = String(data.jobUrl || "").trim();

  if (!jobUrl) {
    return { status: "error", message: "Job URL is required." };
  }

  const appendStatus = data.status || data.defaultStatus || STATUS_DEFAULT;

  const rowValues = [
    jobUrl,
    formatDateCell(data.dateTime || data.date),
    data.companyName || "",
    data.jobTitle || "",
    data.atsScore ?? "",
    data.interviewChance ?? "",
    data.missingSkills || "",
    data.addSkills || data.skillsToAdd || "",
    data.removeSkills || data.skillsToRemove || "",
    String(appendStatus).trim()
  ];

  const rowIndex = findRowByJobUrl(sheet, jobUrl);

  if (rowIndex !== -1) {
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

  sheet.getRange(rowIndex, 10).setValue(status);
  return { status: "ok", action: "status_updated", row: rowIndex, newStatus: status };
}

function handleJobMatchList() {
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return { status: "ok", items: [] };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, SHEET_HEADERS.length).getValues();

  const items = rows
    .filter((row) => row[0])
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
      result = handleJobUpsert(data);
    }

    return createJsonResponse(result);
  } catch (err) {
    return createJsonResponse({ status: "error", message: String(err) });
  }
}

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
