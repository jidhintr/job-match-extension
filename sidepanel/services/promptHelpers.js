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

const NOISE_SECTION_HEADING =
  /^(about(\s+(us|the company|our company))?|who we are|our\s+(story|values|mission|culture|team|people|benefits)|why\s+(join|work)(\s+(us|with us|here|for us|at .+))?|what we offer|benefits(\s+(and|&)\s+perks)?|perks(\s+(and|&)\s+benefits)?|compensation\s+(and|&)\s+benefits|salary\s+(and|&)\s+benefits|life at .+|working at .+|diversity.*|inclusion.*|equal\s+(employment\s+)?opportunit(y|ies).*|eeo.*|how to apply|application\s+process|(our\s+)?(hiring|interview|recruitment)\s+process|next steps|what happens next|legal.*|privacy.*|accessibility.*|disclaimer.*)\s*:?$/i;

const CONTENT_SECTION_HEADING =
  /^((key\s+|your\s+|main\s+)?responsibilities|what\s+you.{0,3}ll\s+(do|be doing)|the role|role\s+(overview|description|summary)|about the\s+(role|job|position)|(job|position)\s+(description|summary|overview)|duties|(key\s+|core\s+)?requirements?|(minimum|preferred|basic|desired)\s+qualifications?|qualifications?|what\s+we.{0,3}re\s+looking\s+for|what\s+you.{0,3}ll\s+need|what\s+you\s+bring|who\s+you\s+are|your\s+profile|must[-\s]have.*|nice[-\s]to[-\s]have.*|(technical\s+|core\s+)?skills?(\s+(and|&)\s+experience)?|tech(nology)?\s+stack|experience|your\s+background|we\s+are\s+looking\s+for)\s*:?$/i;

const SECTION_HEADING_MAX_LEN = 60;
const MIN_TRIMMED_CHARS = 200;

function stripNoiseSections(lines) {
  const kept = [];
  let dropping = false;
  let sawContentHeading = false;

  for (const line of lines) {
    if (line.length <= SECTION_HEADING_MAX_LEN) {
      if (NOISE_SECTION_HEADING.test(line)) {
        dropping = true;
        continue;
      }
      if (CONTENT_SECTION_HEADING.test(line)) {
        dropping = false;
        sawContentHeading = true;
      }
    }
    if (!dropping) kept.push(line);
  }

  return sawContentHeading ? kept : lines;
}

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

  const full = lines.join("\n");
  const trimmed = stripNoiseSections(lines).join("\n");
  const condensed = trimmed.length >= MIN_TRIMMED_CHARS ? trimmed : full;

  if (!maxChars || condensed.length <= maxChars) return condensed;
  return `${condensed.slice(0, maxChars).trimEnd()}\n[truncated]`;
}
