export function buildEditablePrompt(userText, defaultText, fixedSuffix) {
  const body = (userText || "").trim() || defaultText;
  return fixedSuffix ? `${body}\n\n${fixedSuffix}` : body;
}

export const TEXT_LIMITS = {
  resume: 12000,
  resumeBrief: 5000,
  job: 12000,
  jobBrief: 5000,
  notes: 2000
};

const BOILERPLATE_LINE =
  /^(cookies?|cookie (notice|settings|policy)|privacy (policy|notice)|terms (of use|and conditions)|equal opportunity employer.*|accessibility statement|all rights reserved.*|apply( now)?|easy apply|quick apply|share (this )?job|save (this )?job|report (this )?job|sign in|log ?in|sign up|create an account|job alerts?|talent (network|community)|follow us.*|back to (search|results|jobs)|similar jobs|view all jobs|©.*)$/i;

const BOILERPLATE_MAX_LEN = 60;

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
