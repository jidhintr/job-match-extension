# MatchResumer — Chrome Extension

MatchResumer is a Manifest V3 Chrome/Edge extension for job search workflow automation. It helps you:

- match a live job posting against your master resume
- generate and improve interview prep question sets for the same job
- bulk-scan a jobs page for likely matches
- create a cover letter and salary estimate from a matched role
- save job and prep data back to Google Sheets and manage tracked applicants

## Extension overview

The extension is organized as a side-panel app with multiple tabs and settings pages. It stores local settings in Chrome storage, keeps per-tab matcher state isolated, and syncs a subset of data to Google Sheets when configured.

## Installation and setup

### Install

1. Open chrome://extensions
2. Enable Developer mode
3. Click Load unpacked and select this project folder
4. Pin the extension if desired so the side panel is easier to access

### One-time configuration

From the extension options page:

1. Save a Google Gemini API key
2. Optionally add keys for Tavily, DeepSeek, OpenAI, and/or Perplexity for Interview Prep enrichment
3. Add or edit your master resume text
4. Optionally paste a Google Sheets webhook URL for syncing
5. Configure visible tabs, custom instructions, and tracker status labels as needed

The app stores settings locally in Chrome storage and keeps the resume matcher state per tab.

---

## Tab-by-tab functionality

### 1. Resume Matcher tab

Purpose: evaluate a job description against the candidate's resume and produce a role-specific summary.

Current behaviors:

- extracts or reuses the active tab's job text automatically
- checks whether an analysis for the same URL already exists in Google Sheets before re-running Gemini
- allows a per-tab resume override from a PDF or DOCX file
- supports re-analysis without re-scraping if the current tab already has the job text
- supports toggling and reordering report sections from Settings
- renders a rich summary with score, role/company info, warnings, missing skills, optimization tips, interview prep guidance, and company context

Typical output fields include:

- company_name
- job_title
- ats_score
- chance_of_getting_job
- warnings (language barrier / visa sponsorship concerns)
- missing_skills
- resume_optimization
- stage_1_attention_test
- stage_2_mindset_breakdown
- stage_3_tech_gap_table
- why_good_fit
- role_prep
- company_insights

Important logic notes:

- report blocks are individually enabled/disabled via Settings so unused sections are not requested from Gemini at all
- saved results are cached per tab in session state and can be restored quickly
- if a Google Sheets summary exists for the same URL, the app can load it instead of spending tokens again

### 2. Interview Prep tab

Purpose: generate realistic interview prep content for a job and track the candidate's progress through each area.

Current behaviors:

- identifies interview focus areas for the current role using Gemini
- lets the user add recruiter notes or round-specific notes
- fetches more candidate-reported question ideas per area from multiple sources
- consolidates noisy results from multiple sources into a final list
- assigns category, difficulty, and frequency to each final question
- tracks per-area completion and progress
- saves the full interview-prep snapshot to Google Sheets

Current supported sources in code:

- Gemini
- Tavily web search
- DeepSeek
- OpenAI
- Perplexity

Flow pattern:

1. Gemini predicts the highest-value interview focus areas for the role
2. A parallel scan fetches question candidates from configured sources
3. Gemini consolidates and deduplicates the raw pile
4. The UI renders questions with completion toggles, category badges, and progress tracking

### 3. Scan Jobs tab

Purpose: scan an entire jobs listing page and identify likely matches using a resume-vs-job filter.

Current behaviors:

- reads jobs from the current page
- opens the job details URL when needed to extract fuller description text
- scores each job against the resume
- keeps only jobs with a realistic match above a threshold
- renders a selectable list of likely matches
- allows saving selected jobs into the tracker sheet

The bulk scan uses Gemini with a custom schema that checks whether a page is a real job posting and returns:

- is_job_posting
- match_percent
- tech_stack

This is designed to avoid false positives from company pages, login pages, or generic career pages.

### 4. Cover Letter tab

Purpose: generate a tailored cover letter from the matched job result and the effective resume.

Current behaviors:

- builds a prompt using the job description and resume
- asks Gemini for a structured JSON response with:
  - candidate_name
  - opening_paragraph
  - key_points
  - closing_paragraph
- converts the result into a downloadable PDF letter
- handles retry and quota messaging if Gemini fails

### 5. Salary tab

Purpose: estimate a salary range for the selected job and company.

Current behaviors:

- reads the current matched job and job description
- optionally adds live web snippets from Tavily before asking Gemini
- asks Gemini for a structured compensation object containing:
  - location
  - local_currency
  - monthly_local / annual_local
  - monthly_pln / annual_pln
  - monthly_eur / annual_eur
  - benefits
  - negotiation_tips
  - basis_note
- renders the result in the side panel as salary estimates and context

### 6. Tracker tab

Purpose: track applications and statuses across jobs saved to Google Sheets.

Current behaviors:

- fetches tracked job rows from the Sheets webhook
- supports status filtering and sorting
- supports custom status labels configured in Settings
- lets users update status values via dropdown on each card
- color-codes statuses based on configuration
- reuses the same tracker data for duplicate checks when deciding whether a job has already been analyzed

### 7. Settings page

Purpose: configuration and operational control.

Current settings include:

- Gemini API key
- Tavily, DeepSeek, OpenAI, Perplexity keys and model overrides
- Google Sheets webhook URL
- visible tab preferences
- tracker status labels
- resume matcher report section enablement and ordering
- custom instructions for each feature (matcher, prep, cover letter, salary, bulk scan)

Special note:

- Gemini is treated as a required provider in the current configuration, even though the app has other provider integrations already available.
- The Interview Prep source picker allows selecting which external sources are used for that workflow.

---

## Google Sheets integration

The app supports Google Apps Script webhook syncing for both analysis and tracking flows.

### What it syncs

- job_match rows for resume analysis snapshots
- interview_prep snapshots for each company/role
- tracker rows for application status tracking
- status updates for existing tracked records

### Apps Script behavior

The included script is meant to be pasted into Google Apps Script and deployed as a Web App.

The current script logic is designed to:

- create required sheets/tabs if they do not exist
- append one row per job match summary
- replace the interview-prep company data instead of duplicating rows
- support lookup by job URL so existing rows can be identified and reused

---

## Current provider and model behavior

### Gemini fallback order in code

The current fallback order is:

1. gemini-3.1-flash-lite
2. gemini-2.5-flash
3. gemini-2.5-flash-lite
4. gemini-3.5-flash

If a request times out, returns a busy/quota error, returns a 4xx/5xx response, or reports that a model is unavailable, the next model is attempted.

The retry logic is implemented in the shared Gemini client and is reused by:

- Resume Matcher
- Interview Prep
- Cover Letter
- Salary
- Scan Jobs

This makes Gemini a central dependency for the main workflow, even though the app already contains separate provider integrations for the interview-prep scan flow.

---

## Current code structure

- manifest.json — MV3 extension manifest
- background.js — extension background service worker
- options.html / options.js — settings UI
- sidepanel/sidepanel.html / sidepanel/sidepanel.js / sidepanel/sidepanel.css — main panel shell and tab behavior
- sidepanel/features/bootstrap.js — tab setup, restore state, settings initialization
- sidepanel/features/matcher.js — resume analysis logic and report rendering
- sidepanel/features/prep.js — interview prep generation and progress tracking
- sidepanel/features/coverLetter.js — cover letter generation and PDF export
- sidepanel/features/salary.js — salary estimation and rendering
- sidepanel/features/scan.js — bulk job scanning and filtering
- sidepanel/features/tracker.js — tracker loading and status management
- sidepanel/services/aiProviders.js — non-Google provider scan adapters
- sidepanel/services/geminiClient.js — Gemini fetch, retry, and fallback logic
- sidepanel/services/storage.js — Chrome storage helpers
- sidepanel/services/tabMessaging.js — tab text extraction and page access helpers
- sidepanel/resumeParser.js — local resume parsing
- content/content.js — content extraction helper for job pages
- lib/pdfjs — PDF runtime bundle
- google-apps-script.js — Apps Script integration for Sheets sync

---

## Improvements to make

### 1. Token efficiency improvements — done

The guiding rule for this pass: **cut waste, never cut the answer.** Every limit is a guard against
runaway cost on junk input, not a squeeze on output quality.

Implemented:

- `condenseText()` in `services/promptHelpers.js` runs on every resume, job description, recruiter note and web snippet before it enters a prompt. It strips page chrome (nav links, cookie/privacy/apply-now buttons, footers), collapses whitespace and drops duplicate lines. This is the bulk of the saving and it costs nothing in quality: the boilerplate filter only applies to lines of 60 characters or less, so prose that legitimately mentions those words ("users sign in via SSO", "privacy policy tooling experience") is never stripped. A realistic posting shrinks by roughly half.
- Character budgets live in one place (`TEXT_LIMITS`), set well above what a real posting needs — `content.js` already caps extraction at 15000 chars, and condensing usually lands a posting far below the 12000-char limit, so truncation should effectively only hit junk-heavy pages. High-frequency paths use the `brief` limits (5000), since bulk scan re-sends the resume once per job on the page.
- `callGeminiWithFallback` takes a `maxOutputTokens` cap and every feature passes its own budget: bulk scan 600, prep overview/questions 1200, prep consolidation 1800, cover letter 1500, salary 1500. These sit well above the visible output size because thinking tokens count against the cap on the flash models.
- The Resume Matcher budget is computed, not fixed: each entry in `RESUME_SECTIONS` declares its own `maxTokens` and the cap is the sum of the enabled sections plus a base. Disabling sections in Settings lowers the cap automatically.
- Safety valve: if a response ever does hit the cap (`finishReason: "MAX_TOKENS"`), the same model is retried once with no cap. So a cap that turns out too tight costs one extra request, never a failed or shortened report. It also no longer burns the whole model fallback chain on the same cap.
- Prep consolidation caps the raw pile at 60 items × 220 chars, so a noisy multi-source scan can't produce an unbounded prompt.
- Duplicated instructions were removed from the matcher schema (the `ats_score` / `chance_of_getting_job` descriptions repeated what the system prompt already says).

Deliberately not done:

- Splitting the Resume Matcher into one request per enabled block. It would raise total token use, not lower it — the resume and job description (the bulk of the input) would be re-sent with every block, and input tokens dominate this call. The per-section output budget gives the cost control that item was after, at one request.

### 2. Fragile logic and reliability issues

- Gemini is currently a hard dependency for many core features. This makes the app vulnerable to quota limits and 429 errors across the whole workflow.
- The Gemini retry logic is limited to a small hardcoded model list and does not include provider-aware routing or backoff policy.
- Short 10-second timeouts may be too aggressive for a model under load and can increase false retry loops.
- Some flows re-call Gemini repeatedly for nearby tasks without strong caching or deduplication.
- URL-based duplicate checks are useful, but they depend on correct URL matching and sheet availability; they should be treated as best-effort optimization, not a guarantee.

### 3. Provider routing and failover strategy

- Add a provider router with priority rules: cheaper or lower-latency provider first, Gemini as fallback for schema-heavy tasks.
- If Gemini returns quota or busy errors, immediately switch to another configured provider instead of retrying several models in sequence.
- Use exponential backoff with jitter before retrying a provider.
- Keep a per-feature provider preference map so different tabs use the appropriate model/provider combination.

### 4. Better state and UX resilience

- Centralize “last analysis” deduplication and save status checks so fewer duplicate requests are triggered.
- Show clearer user-facing feedback when a model is busy, quota-limited, or fallback is active.
- Add soft rate limiting for scan jobs and multi-source prep workflows so they do not hammer the API in parallel without bounds.
- Track provider/model telemetry so users can see which model actually handled a request and which requests were rejected.

### 5. Code review recommendations

- Keep the README and actual implementation aligned; the fallback model list and required-provider assumptions should be reviewed together.
- Separate core business logic from UI concerns to make failures easier to diagnose.
- Standardize error handling across all provider adapters so the app reacts consistently to quota, timeout, and malformed response cases.
- Add automated tests around provider fallback, schema validation, and save/dedupe logic to prevent regressions.

### 6. Recommended direction

The strongest next step is to make Gemini a fallback provider rather than the default central engine for every tab. The app already contains the right building blocks for a multi-provider model strategy, and using those consistently would reduce both 429 pressure and token waste while preserving the current feature set.
