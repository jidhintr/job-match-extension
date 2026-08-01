// Builds a system prompt whose entire descriptive body is user-editable (falling back to
// defaultText when the user hasn't customized it yet), with a fixed suffix always appended
// afterward. The suffix is never shown/editable in Settings — it's the instruction that keeps
// the model's output aligned with the schema passed separately as generationConfig.responseSchema,
// so it can't be accidentally edited away.
export function buildEditablePrompt(userText, defaultText, fixedSuffix) {
  const body = (userText || "").trim() || defaultText;
  return fixedSuffix ? `${body}\n\n${fixedSuffix}` : body;
}

// Character budgets for text pasted into prompts. These are guards against junk-heavy pages, not
// quality targets: content.js already caps extraction at 15000 chars, and condenseText() usually
// brings a real posting far below these numbers on its own, so truncation should be rare.
// "brief" variants are for high-frequency calls (bulk scan runs one request per job, so every
// extra character is multiplied by the job count).
export const TEXT_LIMITS = {
  resume: 12000,
  resumeBrief: 5000,
  job: 12000,
  jobBrief: 5000,
  notes: 2000
};

const BOILERPLATE_LINE =
  /^(cookies?|cookie (notice|settings|policy)|privacy (policy|notice)|terms (of use|and conditions)|equal opportunity employer.*|accessibility statement|all rights reserved.*|apply( now)?|easy apply|quick apply|share (this )?job|save (this )?job|report (this )?job|sign in|log ?in|sign up|create an account|job alerts?|talent (network|community)|follow us.*|back to (search|results|jobs)|similar jobs|view all jobs|©.*)$/i;

// Nav links, buttons and footer lines are short. Anything longer is prose that may legitimately
// mention these words ("users sign in via SSO", "privacy policy tooling experience"), so length is
// the guard that keeps real requirement lines from being stripped.
const BOILERPLATE_MAX_LEN = 60;

// Strips page chrome, collapses whitespace, drops repeated lines, then caps the length. Extracted
// page text is mostly navigation, legal footers and duplicated markup, so this removes a large
// share of the tokens without touching anything the model needs.
export function condenseText(text, maxChars) {
  const seen = new Set();
  const lines = [];

  for (const raw of String(text || "").split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (line.length <= BOILERPLATE_MAX_LEN && BOILERPLATE_LINE.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }

  const condensed = lines.join("\n");
  if (!maxChars || condensed.length <= maxChars) return condensed;
  return `${condensed.slice(0, maxChars).trimEnd()}\n[truncated]`;
}
