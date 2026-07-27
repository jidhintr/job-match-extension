export async function postToSheets(webhookUrl, payload) {
  await fetch(webhookUrl, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
}

// Plain GET against the Apps Script /exec endpoint — no AI involved, just reads the sheet.
export async function fetchFromSheets(webhookUrl) {
  const res = await fetch(webhookUrl, { method: "GET" });
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Apps Script serves an HTML page (login/authorization prompt or a stack trace) instead of
    // JSON when the deployment's "Who has access" isn't set to Anyone, or doGet() itself errored.
    // res.url after redirects + a body snippet pinpoints which case this actually is.
    console.error("Sheets GET returned non-JSON.", { requestedUrl: webhookUrl, finalUrl: res.url, redirected: res.redirected, httpStatus: res.status, bodySnippet: text.slice(0, 300) });
    const redirectedToLogin = res.url.includes("accounts.google.com");
    const detail = redirectedToLogin
      ? `redirected to a Google sign-in page (${res.url}) — deployment access isn't actually "Anyone" yet, or you edited a different deployment than the one this URL points to.`
      : `HTTP ${res.status} at ${res.url}. Response started with: ${JSON.stringify(text.slice(0, 120))}`;
    throw new Error(`Sheets webhook didn't return JSON — ${detail}`);
  }

  if (data.status === "error") throw new Error(data.message || "Sheets returned an error.");
  return Array.isArray(data.items) ? data.items : [];
}
