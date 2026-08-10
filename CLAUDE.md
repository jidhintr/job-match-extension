# CLAUDE.md

This project is the MatchResumer Chrome/Edge extension for job search workflow automation.

## Project goal

The extension helps a candidate:

- compare a live job posting against a saved resume
- generate interview prep question sets for the role
- bulk-scan a jobs page for likely matches
- save job/application data to Google Sheets and track status

## Current architecture

- Manifest V3 Chrome extension
- Side panel UI with separate tabs for matcher, interview prep, scan jobs, tracker, KPI
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

## Code comment rule

- Default to zero comments. Clear naming and small functions are the documentation.
- Never restate what the code already says, and never add section banners, JSDoc blocks, file headers, or `// TODO`-style filler.
- Only genuinely non-obvious logic (a workaround, a browser quirk, an ordering constraint) may carry a comment, and it must be a single short line.
- If an explanation needs more than one line, it belongs in `docs/project-memory.md`, not in the source file.
- Do not re-add comments that were previously removed.

## UI copy rule

- No instructional hint text on the interface. Do not write "Click to…", "Hover to…", "Press X to…" or similar.
- Affordances are communicated by cursor, hover state and layout, not by captions.
- Labels and subtitles should describe what the data is, never how to operate the control.

## Working principles for future changes

1. Favor multi-provider fallback over Google-only dependence.
2. Keep costs and token use low by reducing prompt size and output size.
3. Preserve the extension's current feature set while improving resilience.
4. Keep code and documentation aligned.
5. When adding provider/model logic, update both runtime code and project memory docs.
6. Treat token caps as safety guards, not user-facing failures.

## Token guardrail rule

- Token limiting must never degrade the user experience or make the app feel unreliable.
- Output caps are a safety guard, not a failure mode.
- If a model hits a token limit or output barrier, automatically switch model or re-run with a smaller payload instead of surfacing a broken result.
- Do not treat a token cap as a “bad result” signal; it is only a signal that the current prompt or model path needs a safer fallback.
- Do not break user trust with visible "failed because of tokens" errors when a transparent fallback is available.
- Prefer automatic model adaptation over user-facing disruption: model switch, prompt trimming, or retry with a narrower request.
- Only escalate to an error when all fallback routes are exhausted.

## Quick decision rule

If a feature can be served by a cheaper or more reliable provider, prefer that path. Use Gemini as a fallback or schema-specialist model, not as the mandatory gateway for every operation.

## Relevant project memory

See `docs/project-memory.md` for the longer project context, change log, and implementation notes for future teammates.
