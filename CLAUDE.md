# CLAUDE.md

This project is the MatchResumer Chrome/Edge extension for job search workflow automation.

## Project goal

The extension helps a candidate:

- compare a live job posting against a saved resume
- generate interview prep question sets for the role
- bulk-scan a jobs page for likely matches
- build a cover letter and salary estimate from the matched role
- save job/application data to Google Sheets and track status

## Current architecture

- Manifest V3 Chrome extension
- Side panel UI with separate tabs for matcher, interview prep, scan jobs, cover letter, salary, tracker
- Settings page stored in Chrome local storage
- Per-tab matcher state stored separately per browser tab
- Google Sheets sync via Apps Script webhook URL
- Multiple providers supported: Gemini, Tavily, DeepSeek, OpenAI, Perplexity

## Core files

- `manifest.json` — extension manifest
- `background.js` — extension service worker
- `options.html` / `options.js` — settings UI
- `sidepanel/sidepanel.js` — tab bootstrap
- `sidepanel/features/bootstrap.js` — initialization / restore state
- `sidepanel/features/matcher.js` — job-to-resume analysis and report rendering
- `sidepanel/features/prep.js` — interview prep generation and tracking
- `sidepanel/features/scan.js` — bulk scanning of jobs pages
- `sidepanel/features/coverLetter.js` — cover letter generation and PDF export
- `sidepanel/features/salary.js` — salary estimation
- `sidepanel/features/tracker.js` — tracked jobs and status management
- `sidepanel/services/geminiClient.js` — Gemini request / retry / fallback logic
- `sidepanel/services/aiProviders.js` — non-Google provider adapters
- `sidepanel/services/storage.js` — storage and settings helpers
- `google-apps-script.js` — Google Apps Script Sheets integration

## Current project direction

We are trying to move away from a single-provider dependency model and toward a multi-provider routing model.

Important project direction:

- Gemini should not be the universal default for every feature
- providers should be selected by capability and availability
- quota / 429 / timeout failures should trigger provider fallback, not repeated Gemini retries
- token usage must be reduced on expensive structured outputs
- reuse saved Sheet summaries where possible to avoid unnecessary AI calls

## Known issues to avoid

- Do not assume Gemini is the required path for all features.
- Do not add new round-robin Gemini attempts without quota-aware fallback rules.
- Do not keep hardcoded model assumptions in multiple places without updating the docs and routing logic together.
- Do not keep huge structured prompts when a trimmed version will suffice.
- Do not repeat expensive full analyses when a previous saved result already exists for the same job URL.

## Dedupe and product rules

- Prefer saved Google Sheets summaries over fresh AI calls when the URL matches.
- Keep per-tab state isolated.
- Keep settings local to the device unless a user explicitly uses the sheet sync.
- New provider integrations should be added through the shared source abstraction and router pattern.

## Working principles for future changes

1. Favor multi-provider fallback over Google-only dependence.
2. Keep costs and token use low by reducing prompt size and output size.
3. Preserve the extension's current feature set while improving resilience.
4. Keep code and documentation aligned.
5. When adding provider/model logic, update both runtime code and project memory docs.

## Quick decision rule

If a feature can be served by a cheaper or more reliable provider, prefer that path. Use Gemini as a fallback or schema-specialist model, not as the mandatory gateway for every operation.

## Relevant project memory

See `docs/project-memory.md` for the longer project context, change log, and implementation notes for future teammates.
