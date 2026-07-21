/**
 * Paste this into Extensions → Apps Script on the Google Sheet you want to log to,
 * replacing the default Code.gs contents. Then Deploy → New deployment → Web app,
 * with "Execute as: Me" and "Who has access: Anyone". Copy the resulting /exec URL
 * into the extension's Settings page as the Google Sheets Webhook URL.
 *
 * The extension can't read the response back (see sidepanel.js for why), so this
 * only needs to succeed server-side — but it still returns JSON for manual testing.
 */

const SHEET_NAME = "Job Match Log";
const HEADERS = ["Date", "Company Name", "Job Title", "ATS Score (%)", "Interview Chance (%)", "Missing Skills", "Job URL"];

function getLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getLogSheet();

    sheet.appendRow([
      data.date || "",
      data.companyName || "",
      data.jobTitle || "",
      data.atsScore ?? "",
      data.interviewChance ?? "",
      data.missingSkills || "",
      data.jobUrl || ""
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok" }))
      .setMimeType(ContentService.MimeType.JSON);
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
    .createTextOutput(JSON.stringify({ status: "ok", sheet: SHEET_NAME }))
    .setMimeType(ContentService.MimeType.JSON);
}
