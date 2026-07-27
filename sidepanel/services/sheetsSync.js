export async function postToSheets(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "omit",
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets POST failed with HTTP ${res.status}: ${text || res.statusText}`);
  }
}

// Plain GET against the Apps Script /exec endpoint — no AI involved, just reads the sheet.
export async function fetchFromSheets(webhookUrl) {
  const res = await fetch(webhookUrl, {
    method: "GET",
    mode: "cors",
    headers: { Accept: "application/json" },
    credentials: "omit",
    cache: "no-store"
  });
  const text = await res.text();
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("Sheets webhook returned an empty response. Verify the Apps Script web app is deployed and the webhook URL points to the deployed /exec endpoint.");
  }

  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    // Apps Script can return an HTML page (login prompt, stack trace, or deployment splash page)
    // instead of JSON when the deployment permissions or URL are wrong.
    console.error("Sheets GET returned non-JSON.", { requestedUrl: webhookUrl, finalUrl: res.url, redirected: res.redirected, httpStatus: res.status, bodySnippet: trimmed.slice(0, 300) });
    const redirectedToLogin = (res.redirected && res.url.includes("accounts.google.com")) || trimmed.includes("accounts.google.com") || trimmed.includes("Sign in") || trimmed.includes("<html");
    const detail = redirectedToLogin
      ? `the web app redirected to a Google sign-in page or returned HTML instead of JSON. Re-deploy the Apps Script web app with "Who has access: Anyone" and use the deployed /exec URL in Settings.`
      : `HTTP ${res.status} at ${res.url}. Response started with: ${JSON.stringify(trimmed.slice(0, 140))}`;
    throw new Error(`Sheets webhook didn't return JSON — ${detail}`);
  }

  if (data.status === "error") throw new Error(data.message || "Sheets returned an error.");
  return Array.isArray(data.items) ? data.items : [];
}
