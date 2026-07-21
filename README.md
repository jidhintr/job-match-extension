# MatchResumer — Resume Analyzer (Chrome Extension)

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

A second, independent tab next to Resume Matcher (switch via the header). It doesn't use your resume at all — just the job description, and it determines its own company name/job title via Gemini rather than depending on Resume Matcher having run first, so it works standalone.

1. Optionally paste recruiter feedback or round details into **Recruiter Insights** at the top — anything in there overrides Gemini's own guesses about focus areas and weighting.
2. Click **🎯 Generate Interview Prep** (or **Update Focus Areas** if you've added/changed recruiter insights and want to regenerate). It reuses the job text already scraped by Resume Matcher if you've run that on this tab, or scrapes fresh if not.
3. Gemini predicts 3–6 realistic interview focus areas for the role (e.g. Coding & DSA, System Design, Behavioral) with a predicted round and a weight, plus a fixed "🔮 AI Company & Stack Predictions" wildcard area — shown as a donut chart plus a progress card.
4. Each area is a card with its own checkbox (marks the whole area done) and a **Fetch Deep-Dive Questions** button — clicking it makes a *separate*, on-demand call to your chosen provider (see below) scoped to just that area, so you're never paying for questions on areas you haven't opened yet. Each question gets its own checkbox.
5. The **Overall Prep Progress** bar is weighted by each area's predicted importance — checking off all of System Design's questions moves the bar by System Design's donut share, not a flat 1/N. Checking an area's own checkbox instantly completes it (and all its questions); unchecking any question un-completes the area.
6. Progress is saved to `chrome.storage.local` keyed by the job's URL (not per-tab like Resume Matcher) — revisit the same job later, even after restarting Chrome, and it's still there.

### Multi-agent question scan + Gemini consolidation

**Fetch Deep-Dive Questions** is a two-stage pipeline, not a single call:

1. **Parallel scan** (`Promise.allSettled`) — every source with a key configured in Settings fires at once for that area:
   - **Gemini** (always — its key drives stage 2) reasons from training knowledge.
   - **Tavily** (`tvly-…`) — **live web search** of Glassdoor / LeetCode / Reddit / Blind for real reported questions.
   - **DeepSeek** (`deepseek-v4-flash`) — training knowledge, strict JSON mode.
   - **OpenAI** (`gpt-5-mini`) — training knowledge, strict JSON mode (`response_format`).
   One source failing (bad key, timeout, rate limit) is captured and skipped — it can't sink the batch. The button hint shows which sources will run (e.g. "Gemini + Tavily 🌐 + DeepSeek").
2. **Gemini master consolidation** — the combined raw pile (web snippets + model answers) goes **only to Gemini**, which dedupes near-identical wordings, drops off-topic noise, and tags each surviving question with a **category** (Behavioral / System Design / Coding / Domain), **difficulty** (Easy / Medium / Hard), and **frequency** (High / Med / Low). Those show as colored badges on each question and sync to the Sheet.

Gemini alone is enough — the other three are optional extra sources. Only Resume Matcher and the *area breakdown* use Gemini directly (no scan).

#### Gemini model cascade

Every Gemini call (matching, question generation, consolidation) walks an ordered six-model priority list — `gemini-3.1-pro` → `gemini-3.5-flash` → `gemini-3-flash` → `gemini-2.5-pro` → `gemini-2.5-flash` → `gemini-2.5-flash-lite` — with a **10-second timeout per attempt**. It drops to the next tier on rate-limit (429), server-busy (503), model-unavailable (404/400), timeout, or an empty/malformed response; a genuine auth error (401/403) surfaces immediately instead of burning all six tiers.

> **Notes on this build vs. the original spec:** (1) The spec's model IDs (`deepseek-chat`, `gpt-4o-mini`, `gemini-2.5-flash`, and some of the cascade tiers) are retired or being retired as of this writing, and several of the newer Gemini tiers may not be live for every key/region. That's handled by design — a 404 is treated as retryable, so an unavailable tier is skipped rather than dead-ending — and every non-Gemini model name is a user-editable field. (2) Keys are stored in `chrome.storage.local` (matching the rest of the extension) rather than the spec's `chrome.storage.sync` — `local` keeps API keys on this one device instead of replicating them to every Chrome you're signed into, the safer default for secrets. Switch the `chrome.storage.local` calls to `chrome.storage.sync` in `options.js`/`sidepanel.js` if you specifically want cross-device sync. (3) Grok and Perplexity are excluded per the spec; Tavily is the live-web-search source.

### Syncing to Google Sheets

With a webhook URL configured (see above), Interview Prep writes to its **own tab per company** in the same sheet (e.g. a "Meta" tab, an "Amazon" tab), separate from Resume Matcher's shared "Job Match Log" tab — auto-created, auto-named. Checking a box syncs automatically (debounced) and **💾 Save Progress to Sheet** syncs immediately. Each sync fully replaces that company tab's rows with the current state, so re-syncing never piles up duplicates the way a naive append would.

The company tab now also carries **Category / Difficulty / Frequency** columns per question (from the consolidation pass). **Any time `google-apps-script.js` changes** — including this column addition — re-paste it into your Apps Script editor and redeploy: **Deploy → Manage deployments → edit (pencil) → New version → Deploy**. You don't need a new URL, just a new version of the same deployment; the webhook URL in Settings stays the same. (An earlier version also had two now-fixed bugs: it treated every save as interview-prep data — dropping Resume Matcher's ATS/Chance/Missing-Skills columns — and appended duplicate rows on every checkbox toggle instead of replacing them.)

## Files

- `manifest.json` — MV3 manifest (`storage`, `activeTab`, `scripting`, `sidePanel`).
- `background.js` — opens the side panel on toolbar-icon click, and binds a separate panel instance to every tab so each tab's analysis is isolated.
- `options.html` / `options.js` — API key, Sheets webhook URL, and master resume settings.
- `sidepanel/` — both tabs (Resume Matcher and Interview Prep) live in the same `sidepanel.html`/`.js`/`.css`, switched via CSS `hidden` classes rather than separate pages. Resume Matcher's per-tab state (result, uploaded resume) persists to `chrome.storage.session`; Interview Prep's progress persists to `chrome.storage.local` keyed by job URL instead — see above for why.
- `sidepanel/resumeParser.js` — extracts text from an uploaded PDF/DOCX. Loaded via dynamic `import()` only when you actually upload a file, so it never slows down opening the panel.
- `sidepanel/aiProviders.js` — the parallel question-scan sources (Tavily live web + DeepSeek + OpenAI). `scanNonGeminiSources()` runs them via `Promise.allSettled` and returns the combined raw items for Gemini to consolidate. Loaded via dynamic `import()` only when a scan actually runs.
- `content/content.js` — injected on demand (not persistent) to extract job description text from the panel's own bound tab. Clones the matched container, strips scripts/styles/nav/footer/forms/ads before reading text, and caps it at 15,000 characters — keeps the Gemini prompt lean and avoids billing tokens for page chrome.
- `lib/pdfjs/` — a local copy of Mozilla's PDF.js (not loaded from a CDN — Manifest V3 blocks executing remotely-fetched code, so it has to ship inside the extension).
- `google-apps-script.js` — paste into your Google Sheet's Apps Script editor to receive the webhook and append rows.

## Model fallback

Gemini requests try `gemini-3.5-flash` first, then fall back to `gemini-3.1-flash-lite` and `gemini-2.5-flash` in turn if a model returns 503 (overloaded) or 429 (quota exhausted) — the panel shows "Busy — switching to X..." when this happens instead of just erroring out.
