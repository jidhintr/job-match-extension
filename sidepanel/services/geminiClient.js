const GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash"
];

const MIN_CALL_TIMEOUT_MS = 15000;
const MAX_CALL_TIMEOUT_MS = 60000;
const MS_PER_OUTPUT_TOKEN = 10;

const MAX_PROMPT_SENDS = GEMINI_MODELS.length;

const MODEL_MISSING_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MODEL_QUOTA_COOLDOWN_MS = 5 * 60 * 1000;
const MODEL_SLOW_COOLDOWN_MS = 60 * 1000;

const modelCooldowns = new Map();

function geminiUrlFor(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function callTimeoutFor(maxOutputTokens) {
  if (!maxOutputTokens) return MAX_CALL_TIMEOUT_MS;
  return Math.min(MAX_CALL_TIMEOUT_MS, Math.max(MIN_CALL_TIMEOUT_MS, maxOutputTokens * MS_PER_OUTPUT_TOKEN));
}

function cooldownForError(err) {
  const message = String(err?.message || "");
  if (err?.httpStatus === 404 || /not found|no longer available/i.test(message)) return MODEL_MISSING_COOLDOWN_MS;
  if (err?.httpStatus === 429 || /quota|rate limit|too many requests/i.test(message)) return MODEL_QUOTA_COOLDOWN_MS;
  if (err?.isTimeout) return MODEL_SLOW_COOLDOWN_MS;
  return 0;
}

function noteModelFailure(model, err) {
  const cooldown = cooldownForError(err);
  if (cooldown) modelCooldowns.set(model, Date.now() + cooldown);
}

function isCoolingDown(model) {
  const until = modelCooldowns.get(model);
  if (!until) return false;
  if (Date.now() < until) return true;
  modelCooldowns.delete(model);
  return false;
}

function modelsToTry() {
  const ready = GEMINI_MODELS.filter((m) => !isCoolingDown(m));
  return ready.length > 0 ? ready : GEMINI_MODELS;
}

export function isRetryableError(err) {
  if (!err) return false;
  if (err.isTimeout || err.isInvalidResponse) return true;
  if ([429, 503, 404, 400].includes(err.httpStatus)) return true;

  const message = String(err.message || "").toLowerCase();
  return /(429|503|404|400|rate limit|over quota|timed out|busy|no longer available|not found|unavailable|quota|too many requests|empty response|malformed json|model .* not available|model .* is no longer available)/i.test(message);
}

export function formatModelRetryMessage(err, contextLabel = "Gemini") {
  const attemptedModel = err?.model || "an unknown model";
  const lastFailure = err?.message || "request failed";
  return `All ${contextLabel} models are busy, timed out, or over quota right now. The last attempted ${contextLabel} model was ${attemptedModel}. ${lastFailure}`;
}

async function callGeminiModel(apiKey, model, systemPrompt, userPrompt, schema, maxOutputTokens) {
  const timeoutMs = callTimeoutFor(maxOutputTokens);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${geminiUrlFor(model)}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: schema,
          ...(maxOutputTokens ? { maxOutputTokens } : {})
        }
      })
    });
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`Gemini ${model} timed out after ${Math.round(timeoutMs / 1000)}s.`);
      timeoutErr.isTimeout = true;
      timeoutErr.model = model;
      throw timeoutErr;
    }

    const netErr = new Error(err.message || "Network error calling Gemini.");
    netErr.isInvalidResponse = true;
    netErr.model = model;
    throw netErr;
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errMessage = data?.error?.message || `Gemini request failed (HTTP ${response.status}).`;
    const err = new Error(errMessage);
    err.httpStatus = response.status;
    err.model = model;
    throw err;
  }

  const candidate = data?.candidates?.[0];

  if (candidate?.finishReason === "MAX_TOKENS") {
    const capErr = new Error("Gemini hit the output token cap.");
    capErr.isOutputCap = true;
    capErr.model = model;
    throw capErr;
  }

  const rawText = candidate?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!rawText) {
    const blockReason = data?.promptFeedback?.blockReason;
    if (blockReason) {
      const blockErr = new Error(`Gemini blocked the request: ${blockReason}`);
      blockErr.model = model;
      throw blockErr;
    }
    const emptyErr = new Error("Gemini returned an empty response.");
    emptyErr.isInvalidResponse = true;
    emptyErr.model = model;
    throw emptyErr;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    const parseErr = new Error("Gemini returned malformed JSON.");
    parseErr.isInvalidResponse = true;
    parseErr.model = model;
    throw parseErr;
  }
}

export async function callGeminiWithFallback(apiKey, systemPrompt, userPrompt, schema, onModelSwitch, maxOutputTokens) {
  const models = modelsToTry();
  let sends = 0;
  let lastErr;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    if (i > 0) onModelSwitch?.(model);

    let err;
    try {
      sends++;
      return await callGeminiModel(apiKey, model, systemPrompt, userPrompt, schema, maxOutputTokens);
    } catch (firstErr) {
      err = firstErr;
    }

    if (err.isOutputCap && maxOutputTokens && sends < MAX_PROMPT_SENDS) {
      console.warn(`Gemini ${model} hit the ${maxOutputTokens}-token output cap — retrying uncapped.`);
      try {
        sends++;
        return await callGeminiModel(apiKey, model, systemPrompt, userPrompt, schema);
      } catch (retryErr) {
        err = retryErr;
      }
    }

    noteModelFailure(model, err);
    lastErr = err;
    lastErr.model = model;

    const hasBudget = sends < MAX_PROMPT_SENDS;
    const isLastModel = i === models.length - 1;
    if (isRetryableError(err) && !isLastModel && hasBudget) {
      console.warn(`Gemini ${model} failed (${err.message}) — falling back to ${models[i + 1]}.`);
      continue;
    }
    throw err;
  }

  throw lastErr;
}
