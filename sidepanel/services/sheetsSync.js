function normalizeWebhookUrl(webhookUrl) {
  if (!webhookUrl) return webhookUrl;

  let normalized = String(webhookUrl).trim();
  if (!normalized) return normalized;

  normalized = normalized.replace(/\s+/g, "");

  if (/^https?:\/\/script\.googleusercontent\.com/.test(normalized)) {
    return normalized;
  }

  normalized = normalized.replace(/^(https:\/\/script\.google\.com\/macros)\/u\/\d+\//i, "$1/");

  normalized = normalized.replace(/\/dev(?:\/)?$/i, "/exec");
  normalized = normalized.replace(/\/edit(?:\/)?$/i, "/exec");
  if (!/\/exec(?:\/)?$/i.test(normalized)) {
    normalized = normalized.replace(/\/?$/, "");
    normalized = normalized.endsWith("/exec") ? normalized : `${normalized}/exec`;
  }

  return normalized;
}

function validateWebhookUrl(webhookUrl) {
  const url = normalizeWebhookUrl(webhookUrl);
  if (!url) {
    throw new Error("No Google Sheets webhook URL is configured. Add the deployed Apps Script /exec URL in Settings.");
  }

  const hasExec = /\/exec(?:\/)?$/i.test(url);
  if (!hasExec) {
    throw new Error(`The configured webhook URL must end in /exec. Got: ${url}`);
  }

  return url;
}

export async function postToSheets(webhookUrl, payload) {
  const url = validateWebhookUrl(webhookUrl);
  const res = await fetch(url, {
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

export async function fetchFromSheets(webhookUrl) {
  const url = validateWebhookUrl(webhookUrl);
  const res = await fetch(url, {
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
    console.error("Sheets GET returned non-JSON.", { requestedUrl: webhookUrl, normalizedUrl: validateWebhookUrl(webhookUrl), finalUrl: res.url, redirected: res.redirected, httpStatus: res.status, bodySnippet: trimmed.slice(0, 300) });
    const redirectedToLogin = (res.redirected && res.url.includes("accounts.google.com")) || trimmed.includes("accounts.google.com") || trimmed.includes("Sign in") || trimmed.includes("<html");
    const detail = redirectedToLogin
      ? `the web app redirected to a Google sign-in page or returned HTML instead of JSON. Update Settings to the deployed Apps Script /exec URL (not the editor URL, and not /dev), then re-deploy the web app with "Who has access: Anyone".`
      : `HTTP ${res.status} at ${res.url}. Response started with: ${JSON.stringify(trimmed.slice(0, 140))}`;
    throw new Error(`Sheets webhook didn't return JSON — ${detail}`);
  }

  if (data.status === "error") throw new Error(data.message || "Sheets returned an error.");
  return Array.isArray(data.items) ? data.items : [];
}
