import { state } from "../state/store.js";
import { callGeminiWithFallback, isRetryableError, formatModelRetryMessage } from "../services/geminiClient.js";
import { buildEditablePrompt, condenseText, TEXT_LIMITS } from "../services/promptHelpers.js";
import { coverLetterBtn } from "../ui/dom.js";
import { effectiveResume, setApplyStatus, refreshApplyButtons } from "./bootstrap.js";

// Seeds the Cover Letter box in Settings > Custom AI Instructions the first time it's opened.
// Anything the user types there fully replaces this body (COVER_LETTER_FIXED_SUFFIX always stays
// appended and isn't editable, so the response still matches COVER_LETTER_SCHEMA).
export const DEFAULT_COVER_LETTER_PROMPT = `You are an expert career coach writing a concise, professional cover letter for a specific job application.

You will be given a candidate's MASTER RESUME and a JOB DESCRIPTION. Write a genuine, tailored one-page cover letter — never use placeholder text like "[Your Name]" or "[Company Name]"; extract the candidate's actual name from the resume and the company/role from the job description, and use them directly. If the candidate's name truly cannot be found in the resume, omit it (return an empty string) rather than inventing or placeholding it.

Structure:
- opening_paragraph: hook the reader, state the role and genuine interest, 2-3 sentences.
- key_points: exactly 3 to 5 short, punchy bullet points, each a specific, concrete selling point connecting the candidate's real resume experience to this job's actual requirements (use real numbers/technologies/outcomes from the resume, not generic claims).
- closing_paragraph: confident close with a call to action, 2-3 sentences.
- candidate_name: the candidate's full name as found in the resume, or empty string if genuinely absent.

Keep the whole letter fitting on one page (roughly 250-350 words total). Be specific, not generic. No markdown, no placeholders.`;

const COVER_LETTER_FIXED_SUFFIX = "Respond with ONLY a valid JSON object matching the schema.";

const COVER_LETTER_SCHEMA = {
  type: "OBJECT",
  properties: {
    candidate_name: { type: "STRING" },
    opening_paragraph: { type: "STRING" },
    key_points: { type: "ARRAY", items: { type: "STRING" } },
    closing_paragraph: { type: "STRING" }
  },
  required: ["candidate_name", "opening_paragraph", "key_points", "closing_paragraph"]
};

// A one-page letter is ~250-350 words, so this leaves headroom without paying for an essay.
const COVER_LETTER_MAX_OUTPUT_TOKENS = 1500;

async function generateCoverLetter() {
  if (!state.matcher.lastResult || !state.matcher.lastJobText) return;
  coverLetterBtn.disabled = true;
  setApplyStatus("Writing your cover letter...");
  try {
    const resume = condenseText(effectiveResume(), TEXT_LIMITS.resume);
    const job = condenseText(state.matcher.lastJobText, TEXT_LIMITS.job);
    const userPrompt = `MASTER RESUME:\n"""\n${resume}\n"""\n\nJOB DESCRIPTION:\n"""\n${job}\n"""\n\nCOMPANY: ${state.matcher.lastResult.company_name || ""}\nROLE: ${state.matcher.lastResult.job_title || ""}`;
    const data = await callGeminiWithFallback(state.settings.apiKey, buildEditablePrompt(state.settings.customInstructions.coverLetter, DEFAULT_COVER_LETTER_PROMPT, COVER_LETTER_FIXED_SUFFIX), userPrompt, COVER_LETTER_SCHEMA, (m) => {
      setApplyStatus(`Busy — switching to ${m}...`);
    }, COVER_LETTER_MAX_OUTPUT_TOKENS);
    buildCoverLetterPdf(data);
    setApplyStatus("Cover letter downloaded.", "ok");
  } catch (err) {
    console.error(err);
    setApplyStatus(isRetryableError(err) ? formatModelRetryMessage(err, "Gemini") : (err.message || "Couldn't generate cover letter."), "err");
  } finally {
    refreshApplyButtons();
  }
}

function buildCoverLetterPdf(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 56;
  const maxWidth = 612 - marginX * 2;
  const lineGap = 16;
  let y = 72;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(new Date().toLocaleDateString(), marginX, y);
  y += lineGap * 2;

  doc.text(`Re: Application for ${state.matcher.lastResult.job_title || "the role"} at ${state.matcher.lastResult.company_name || "your company"}`, marginX, y);
  y += lineGap * 2;

  doc.text("Dear Hiring Manager,", marginX, y);
  y += lineGap * 1.5;

  const writeParagraph = (text) => {
    const lines = doc.splitTextToSize(text, maxWidth);
    doc.text(lines, marginX, y);
    y += lines.length * lineGap + lineGap * 0.5;
  };

  writeParagraph(data.opening_paragraph || "");

  (data.key_points || []).forEach((point) => {
    const lines = doc.splitTextToSize(`•  ${point}`, maxWidth - 14);
    doc.text(lines, marginX + 14, y);
    y += lines.length * lineGap;
  });
  y += lineGap * 0.5;

  writeParagraph(data.closing_paragraph || "");

  y += lineGap * 0.5;
  doc.text("Sincerely,", marginX, y);
  y += lineGap * 1.5;
  if (data.candidate_name) doc.text(data.candidate_name, marginX, y);

  const safe = (s) => (s || "").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "Unknown";
  doc.save(`Cover_Letter_${safe(state.matcher.lastResult.company_name)}_${safe(state.matcher.lastResult.job_title)}.pdf`);
}

coverLetterBtn.addEventListener("click", generateCoverLetter);
