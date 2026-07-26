# MatchResumer — Chrome Extension

MatchResumer is a Manifest V3 Chrome/Edge extension that helps you:

- analyze a job posting against your saved resume
- run an Interview Prep workflow on the same job description
- save the resume-match result and interview-prep progress to Google Sheets

## What the extension actually does

### 1. Resume Matcher tab

From the side panel, you can:

- open a job page and extract the job description text automatically
- analyze the page against a stored master resume
- re-run the analysis without scraping the page again if the resume content changes
- upload a per-tab resume override from a PDF or DOCX file for a single job tab
- save the condensed job-match result to Google Sheets

The output includes:

- company name and role title
- ATS score
- interview chance
- missing skills
- resume optimization suggestions
- role prep guidance
- company insights

### 2. Interview Prep tab

The Interview Prep tab is independent of the resume matcher and works from the job description alone.

It can:

- generate focus areas for the role using Gemini
- let you paste recruiter insights / round notes
- fetch deeper question suggestions for each area
- consolidate the results with Gemini
- track completion state per area and question
- save the full progress snapshot to Google Sheets

## Installation

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project folder.
4. Pin the extension if you want the side panel to stay easy to reach.

## One-time setup

In the extension options page:

1. Save your Google Gemini API key.
2. Optionally add provider keys for the Interview Prep scan sources.
3. Save your master resume text.
4. Optionally add a Google Sheets webhook URL.

The extension stores the settings locally in `chrome.storage.local`.

## Optional provider sources for Interview Prep

The deep-dive question scan is a two-step flow:

1. A parallel scan runs across every configured source for the selected interview area.
2. Gemini consolidates the combined raw results, dedupes them, and labels each final question with category / difficulty / frequency.

Configured sources in the current codebase include:

- Gemini
- Tavily
- DeepSeek
- OpenAI
- Perplexity

Gemini is always part of the flow and acts as the consolidation engine. The others are optional extra sources.

## Google Sheets integration

If you configure a webhook URL, the extension sends two payload types to Apps Script:

- `job_match` for the resume-match summary row
- `interview_prep` for the full per-company interview-prep snapshot

The included Apps Script file in this repo is meant to be pasted into Google Apps Script and deployed as a Web App.

The webhook sync is designed to:

- create the required sheet/tab if it does not exist
- append one row for resume-match logging
- fully replace the interview-prep company tab contents on each save, instead of duplicating rows

## Current code structure

- `manifest.json` — MV3 extension manifest
- `background.js` — background service worker for the extension
- `options.html` / `options.js` — settings page
- `sidepanel/sidepanel.html` / `sidepanel/sidepanel.js` / `sidepanel/sidepanel.css` — sidepanel.js is now a thin ES-module entry point that wires up the modules below
- `sidepanel/state/store.js` — central app state (settings, tab, matcher, prep, scan)
- `sidepanel/services/` — storage, Gemini client, non-Gemini providers (`aiProviders.js`), resume parsing, Sheets sync, tab/content-script messaging, prompt helpers
- `sidepanel/ui/` — DOM element cache, status-line factory, generic render helpers, formatting helpers
- `sidepanel/features/` — one controller per feature: `bootstrap.js` (settings/tabs/resume), `matcher.js`, `prep.js`, `coverLetter.js`, `salary.js`, `scan.js`
- `content/content.js` — page-text extraction helper
- `lib/pdfjs/` — bundled PDF.js runtime
- `google-apps-script.js` — Google Apps Script webhook handler

## Gemini fallback behavior

The current fallback order in the code is:

1. `gemini-2.5-pro`
2. `gemini-2.5-flash`
3. `gemini-2.0-flash`
4. `gemini-2.0-flash-lite`

If one Gemini attempt times out, returns a busy/quota error, or reports that a model is unavailable, the code retries the next model in the list instead of stopping immediately.

## Notes

- The panel keeps per-tab state in `chrome.storage.session` for the resume matcher.
- The Interview Prep question progress is generated fresh for the active job page and synced to the sheet rather than relying on older browser-local cached data.
- The project is a browser extension, not a Node.js application with an npm package setup.

## Senior architecture review: improvement roadmap

This project has a strong product idea and a clear user experience, but the current implementation is starting to show the classic signs of a feature-rich single-file extension that has outgrown its original structure. The biggest opportunity is not adding more features; it is making the codebase easier to reason about, test, and evolve.

### What is working well

- The extension has a clear product narrative: resume match, interview prep, and job scanning are all cohesive.
- The prompt engineering and response-schema approach is thoughtful and gives the AI outputs structure.
- The UI feels polished for a browser-extension MVP and the user flows are fairly complete.
- The use of browser storage for persistence is appropriate for this type of app.

### Highest-priority concerns

#### 1. The side panel code is too large and mixes too many responsibilities

The main file [sidepanel/sidepanel.js](sidepanel/sidepanel.js) is doing far too much at once:

- DOM rendering and event wiring
- AI orchestration and prompt assembly
- provider-specific network calls
- state persistence
- tab extraction and content-script coordination
- business logic for resume analysis, prep generation, salary estimation, and scan workflows

This makes the code hard to maintain, hard to test, and risky to change. A senior architect would break this into focused modules such as:

- state/store layer
- AI service layer
- storage service layer
- UI rendering helpers
- tab-extraction helpers
- feature-specific controllers

Suggested target: keep each module focused on one responsibility and avoid cross-coupling between UI and business logic.

#### 2. The codebase lacks a real architecture boundary between UI and business logic

Right now, the UI layer and the feature logic are tightly coupled. That means small changes can create cascading side effects and make debugging painful. The extension would benefit from a small, explicit application architecture:

- a central state store for current job, resume, analysis results, prep areas, and scan results
- feature controllers that react to state changes
- UI components that render from state instead of directly mutating many globals

This is the single biggest improvement if the extension is expected to grow beyond a prototype.

#### 3. AI provider handling is embedded directly into the UI flow

The current implementation has provider logic spread across multiple places and the error handling is largely ad hoc. The extension should have one consistent AI gateway that handles:

- provider selection
- retries and fallback behavior
- timeout handling
- model-specific errors
- normalized error formatting
- request cancellation and abort safety

This would make the product more resilient and much easier to extend when adding new providers or changing prompts.

#### 4. Error handling is too loose and often silently hides failures

There are multiple places where failures are swallowed with empty catch blocks, which creates hidden breakage. For example, background setup, some message listeners, and several async flows simply log and continue. That is risky for a tool that depends on external APIs and user content.

Recommended direction:

- replace silent failure paths with explicit, user-visible states
- introduce consistent error types and messages
- distinguish transient failures from hard failures
- log meaningful context instead of generic console noise

#### 5. The content extraction layer is heuristic-heavy and brittle

The content script is doing a lot of DOM scraping with hard-coded selectors and a large list of heuristics. That may work for some sites, but it is fragile and will break on layout changes and unsupported job boards.

Improvement areas:

- separate extraction strategy by site pattern
- support more structured fallback paths
- use more robust text normalization and cleanup
- add targeted tests for known job pages
- define a clear contract for the content extractor output

#### 6. The extension would benefit from a proper testing strategy

There are no visible tests for:

- prompt generation
- extraction heuristics
- response parsing
- storage state transitions
- feature-specific UI logic

This is the biggest gap if you want to ship confidently. A good next step is to introduce:

- unit tests for pure helpers
- integration tests for the AI service layer
- lightweight UI tests for critical flows
- fixture-based tests for content extraction

#### 7. The persistence and sync model should be formalized

The extension uses browser storage and Google Sheets sync in a fairly ad hoc way. The payloads are not strongly validated and the sync code is tightly coupled to the UI state. A better structure would define:

- a schema for persisted state
- versioned storage keys
- explicit save/load contracts
- idempotent sync behavior
- clear handling for partial failures

#### 8. Security and privacy should be treated as a first-class concern

The extension stores API keys and user resume content locally. That is expected for a local extension, but it should still be treated carefully. Improvement areas include:

- validating secrets before use
- avoiding accidental exposure in logs
- limiting what is sent to external providers
- clearly documenting what is stored where
- adding a safer approach for webhook-based sync integration

### Suggested implementation order

#### Phase 1 — architecture cleanup

1. Extract the AI provider layer into a dedicated service module.
2. Extract storage and state handling into separate modules.
3. Break the large side panel controller into smaller feature controllers.
4. Introduce a simple state store rather than relying on multiple globals.

#### Phase 2 — resilience and quality

1. Add consistent error handling and user feedback.
2. Improve content extraction robustness.
3. Add a retry/backoff strategy for network and provider failures.
4. Add telemetry or structured logging for failures.

#### Phase 3 — maintainability and confidence

1. Add tests for core parsing and state transitions.
2. Introduce linting and formatting rules.
3. Add a lightweight CI pipeline for static checks.
4. Add a documented extension architecture guide for future contributors.

### Concrete refactor targets

The most valuable files to refactor first are:

- [sidepanel/sidepanel.js](sidepanel/sidepanel.js): split by feature and responsibility.
- [sidepanel/aiProviders.js](sidepanel/aiProviders.js): formalize as the single AI gateway.
- [options.js](options.js): reduce duplicated config/state handling and make settings logic reusable.
- [content/content.js](content/content.js): move extraction logic into a more structured and testable pipeline.
- [google-apps-script.js](google-apps-script.js): introduce validation, auth, and more robust spreadsheet update behavior.

### Recommended engineering standards for the next iteration

- Keep modules under a manageable size and single responsibility.
- Prefer explicit interfaces over hidden shared state.
- Avoid silent catches in production paths.
- Make side effects testable and isolated from rendering.
- Treat AI calls, content extraction, and storage as services, not UI concerns.
- Add tests before major refactors.

### Bottom line

The product already has a compelling concept and a usable MVP. The main gap is architectural discipline. If you fix the structure first, the extension will become much easier to extend, much safer to evolve, and far more maintainable in the long term.
