import { callGeminiWithFallback } from "./geminiClient.js";
import { condenseText, TEXT_LIMITS } from "./promptHelpers.js";

const CACHE_KEY = "candidateProfileCache";
const PROFILE_VERSION = "2";
const PROFILE_MAX_OUTPUT_TOKENS = 1200;

const PROFILE_SYSTEM_PROMPT = `You are a resume indexer. Extract the candidate's matchable facts from the resume. Do not summarise, shorten, rank or judge, and never invent anything that is not in the text.

Rules:
- technologies: every technology, framework, library, database, cloud service, platform, tool and programming language named anywhere in the resume, copied as written. Include items mentioned only once. Missing one is a failure.
- titles: every distinct job title held.
- domains: industries or business domains worked in.
- years_experience: total professional years as a whole number.
- seniority: the candidate's current level in the resume's own wording, for example Junior, Mid, Senior, Staff, Principal, Lead, Architect, Engineering Manager or Director. Never force a management, architecture or hybrid track onto an individual-contributor ladder.
- leadership: responsibilities beyond writing code, such as leading or managing people, mentoring, hiring, on-call or delivery ownership, architecture ownership, and cross-team or stakeholder work. State team sizes and scope where the resume gives them. Empty array when the resume shows none.
- certifications, languages, education: short entries, left empty when the resume does not state them.

Respond with ONLY a valid JSON object matching the schema.`;

const PROFILE_SCHEMA = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING" },
    years_experience: { type: "NUMBER" },
    seniority: { type: "STRING" },
    titles: { type: "ARRAY", items: { type: "STRING" } },
    domains: { type: "ARRAY", items: { type: "STRING" } },
    technologies: { type: "ARRAY", items: { type: "STRING" } },
    leadership: { type: "ARRAY", items: { type: "STRING" } },
    certifications: { type: "ARRAY", items: { type: "STRING" } },
    languages: { type: "ARRAY", items: { type: "STRING" } },
    education: { type: "STRING" }
  },
  required: ["headline", "years_experience", "seniority", "titles", "domains", "technologies"]
};

function fingerprintFor(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${PROFILE_VERSION}:${hash.toString(36)}:${text.length}`;
}

function renderProfile(data) {
  const joined = (value) => (Array.isArray(value) && value.length ? value.join(", ") : "");
  const technologies = joined(data.technologies);
  if (!technologies) return "";

  return [
    data.headline,
    `Seniority: ${data.seniority} (${data.years_experience} years)`,
    joined(data.titles) && `Titles: ${joined(data.titles)}`,
    joined(data.domains) && `Domains: ${joined(data.domains)}`,
    `Technologies: ${technologies}`,
    joined(data.leadership) && `Leadership: ${joined(data.leadership)}`,
    joined(data.certifications) && `Certifications: ${joined(data.certifications)}`,
    joined(data.languages) && `Languages: ${joined(data.languages)}`,
    data.education && `Education: ${data.education}`
  ].filter(Boolean).join("\n");
}

export async function getCandidateProfile(apiKey, resumeText, onGenerate) {
  const resume = condenseText(resumeText, TEXT_LIMITS.resume);
  if (!resume) return "";

  const fingerprint = fingerprintFor(resume);
  const cached = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
  if (cached?.fingerprint === fingerprint && cached.profile) return cached.profile;

  onGenerate?.();
  const data = await callGeminiWithFallback(
    apiKey,
    PROFILE_SYSTEM_PROMPT,
    `RESUME:\n"""\n${resume}\n"""`,
    PROFILE_SCHEMA,
    undefined,
    PROFILE_MAX_OUTPUT_TOKENS
  );

  const profile = renderProfile(data);
  if (!profile) return "";

  await chrome.storage.local.set({ [CACHE_KEY]: { fingerprint, profile } });
  return profile;
}
