// Builds a system prompt whose entire descriptive body is user-editable (falling back to
// defaultText when the user hasn't customized it yet), with a fixed suffix always appended
// afterward. The suffix is never shown/editable in Settings — it's the instruction that keeps
// the model's output aligned with the schema passed separately as generationConfig.responseSchema,
// so it can't be accidentally edited away.
export function buildEditablePrompt(userText, defaultText, fixedSuffix) {
  const body = (userText || "").trim() || defaultText;
  return fixedSuffix ? `${body}\n\n${fixedSuffix}` : body;
}
