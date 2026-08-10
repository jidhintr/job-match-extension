const GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash"
];

const GEMINI_CALL_TIMEOUT_MS = 10000;

function geminiUrlFor(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_CALL_TIMEOUT_MS);

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
      const timeoutErr = new Error(`Gemini ${model} timed out after ${GEMINI_CALL_TIMEOUT_MS / 1000}s.`);
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
  let lastErr;
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const model = GEMINI_MODELS[i];
    if (i > 0) onModelSwitch?.(model);

    let err;
    try {
      return await callGeminiModel(apiKey, model, systemPrompt, userPrompt, schema, maxOutputTokens);
    } catch (firstErr) {
      err = firstErr;
    }

    if (err.isOutputCap && maxOutputTokens) {
      console.warn(`Gemini ${model} hit the ${maxOutputTokens}-token output cap — retrying uncapped.`);
      try {
        return await callGeminiModel(apiKey, model, systemPrompt, userPrompt, schema);
      } catch (retryErr) {
        err = retryErr;
      }
    }

    lastErr = err;
    lastErr.model = model;
    const isLastModel = i === GEMINI_MODELS.length - 1;
    if (isRetryableError(err) && !isLastModel) {
      console.warn(`Gemini ${model} failed (${err.message}) — falling back to ${GEMINI_MODELS[i + 1]}.`);
      continue;
    }
    throw err;
  }
  throw lastErr;
}
