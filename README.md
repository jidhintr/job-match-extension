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
- `sidepanel/sidepanel.html` / `sidepanel/sidepanel.js` / `sidepanel/sidepanel.css` — the main UI for Resume Matcher + Interview Prep
- `sidepanel/aiProviders.js` — parallel provider scan logic
- `sidepanel/resumeParser.js` — local PDF/DOCX resume parsing
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
