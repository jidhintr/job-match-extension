# Job Match AI — Resume Analyzer (Chrome Extension)

Personal-use MV3 extension that evaluates a job posting against your resume using Google Gemini, in a Chrome side panel.

## Load it (unpacked)

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `job-match-extension` folder.
4. Pin the extension (puzzle-piece icon → pin) so the side panel toggle is easy to reach.

## One-time setup

1. Click the extension icon → gear icon (or right-click the icon → **Options**).
2. Paste a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) and click **Save API Key**.
3. Paste your resume into the textarea and click **Save Resume**.

Both are stored locally via `chrome.storage.local` — never synced, never sent anywhere except directly to the Gemini API when you run an analysis.

## Optional: logging results to Google Sheets

1. Create (or open) a Google Sheet, then **Extensions → Apps Script**.
2. Delete the default `Code.gs` contents and paste in [google-apps-script.js](google-apps-script.js).
3. **Deploy → New deployment → Web app.** Set "Execute as" to **Me** and "Who has access" to **Anyone**. Deploy, and authorize it when prompted.
4. Copy the deployment's `.../exec` URL.
5. In the extension's Settings, paste it into **Google Sheets Webhook URL** and save.

The script auto-creates a "Job Match Log" sheet tab with headers on first use. After analyzing a job, click **💾 Save to Google Sheets** in the panel to append one row: Date, Company Name, Job Title, ATS Score, Interview Chance, Missing Skills, Job URL — nothing else (no resume text, no full job description) is ever sent to the sheet.

Apps Script Web Apps don't reliably let a cross-origin `fetch()` read their response back, so the button can't show a hard success/failure confirmation — it shows "Sent" once the request goes out, but check the sheet itself to confirm the row landed, especially the first time.

## Using it

1. Open a job posting (LinkedIn, Indeed, Glassdoor, Lever, Greenhouse, Workday, etc.).
2. Click the extension icon to open the side panel.
3. Click **Analyze Current Page**.
4. Tweak your resume inline via **Quick Resume Edit** and click **Re-Analyze Match** to re-run against the same job posting without re-scraping the page.

Each browser tab gets its own independent side panel and analysis — open the panel on one job tab, switch to another job tab and open its panel, and each keeps its own report. You can run analyses on two tabs at once, and switching back to a tab you already analyzed restores that result instead of losing it.

Every report section (Missing Skills, Resume Optimization, Stage 1–3, Good Fit, Interview & Role Prep, Company Insights) is independently collapsible — click a section header to fold it away; they all start expanded.

## Per-job resume (PDF/Word)

Click **📄 Upload Resume** to use a specific `.pdf` or `.docx` file for the job in *this tab only*, instead of your master resume:

- The file is parsed entirely locally (PDF via a bundled copy of [PDF.js](https://mozilla.github.io/pdf.js/); `.docx` via the browser's native unzip/inflate — no server, no upload anywhere) and never touches your saved master resume.
- Once uploaded, it's used for every Analyze/Re-Analyze in that tab; a banner shows which file is active with a one-click **Use master resume instead** to switch back.
- If you never upload anything for a tab, it just uses your master resume — nothing changes from before.
- Old binary `.doc` (pre-2007 Word format) isn't supported — save it as `.docx` or export to PDF first.

## Language & work-authorization rules

The system prompt is hardcoded with the candidate's real constraints, so every analysis applies them automatically:

- **English-only.** If a posting mandates fluency in another language (not just an incidental mention), the job's Interview Chance gauge is forced to 0% — enforced in code, not just prompted, so it's guaranteed — and a red warning banner explains why. ATS Score still reflects raw skill match for reference.
- **EU Blue Card, no sponsorship needed in Poland.** Roles outside Poland aren't penalized by default (Blue Card holders can transfer between EU countries with minimal paperwork). A yellow warning banner only appears if a posting *explicitly* rules out sponsorship/relocation for non-local candidates — worth a second look, not an automatic rejection.

Edit the "CANDIDATE CONTEXT" block near the top of `sidepanel/sidepanel.js` if your situation changes.

## Interview Prep tab

A second, independent tab next to Resume Matcher (switch via the header). It doesn't use your resume at all — just the job description.

1. Click **🎯 Generate Interview Prep**. It reuses the job text already scraped by Resume Matcher if you've run that on this tab, or scrapes fresh if not.
2. Gemini predicts 3–6 realistic interview focus areas for the role (e.g. Coding & DSA, System Design, Behavioral) with a predicted round and a weight — shown as a donut chart plus a progress card.
3. Each area is a card with its own checkbox (marks the whole area done) and a **Fetch Deep-Dive Questions** button — clicking it makes a *separate*, on-demand Gemini call scoped to just that area, so you're never paying for questions on areas you haven't opened yet. Each question gets its own checkbox.
4. The **Overall Prep Progress** bar is weighted by each area's predicted importance — checking off all of System Design's questions moves the bar by System Design's donut share, not a flat 1/N. Checking an area's own checkbox instantly completes it (and all its questions); unchecking any question un-completes the area.
5. Progress is saved to `chrome.storage.local` keyed by the job's URL (not per-tab like Resume Matcher) — revisit the same job later, even after restarting Chrome, and it's still there. **Regenerate breakdown** discards it and starts over.

## Files

- `manifest.json` — MV3 manifest (`storage`, `activeTab`, `scripting`, `sidePanel`).
- `background.js` — opens the side panel on toolbar-icon click, and binds a separate panel instance to every tab so each tab's analysis is isolated.
- `options.html` / `options.js` — API key, Sheets webhook URL, and master resume settings.
- `sidepanel/` — both tabs (Resume Matcher and Interview Prep) live in the same `sidepanel.html`/`.js`/`.css`, switched via CSS `hidden` classes rather than separate pages. Resume Matcher's per-tab state (result, uploaded resume) persists to `chrome.storage.session`; Interview Prep's progress persists to `chrome.storage.local` keyed by job URL instead — see above for why.
- `sidepanel/resumeParser.js` — extracts text from an uploaded PDF/DOCX. Loaded via dynamic `import()` only when you actually upload a file, so it never slows down opening the panel.
- `content/content.js` — injected on demand (not persistent) to extract job description text from the panel's own bound tab. Clones the matched container, strips scripts/styles/nav/footer/forms/ads before reading text, and caps it at 15,000 characters — keeps the Gemini prompt lean and avoids billing tokens for page chrome.
- `lib/pdfjs/` — a local copy of Mozilla's PDF.js (not loaded from a CDN — Manifest V3 blocks executing remotely-fetched code, so it has to ship inside the extension).
- `google-apps-script.js` — paste into your Google Sheet's Apps Script editor to receive the webhook and append rows.

## Model fallback

Gemini requests try `gemini-3.5-flash` first, then fall back to `gemini-3.1-flash-lite` and `gemini-2.5-flash` in turn if a model returns 503 (overloaded) or 429 (quota exhausted) — the panel shows "Busy — switching to X..." when this happens instead of just erroring out.
