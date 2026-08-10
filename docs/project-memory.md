# Project memory

## Why this project exists

This extension is intended to help a job seeker evaluate roles faster and with less manual context-switching.

The main workflow is:

1. open a job page
2. extract the role and description
3. compare it against the candidate resume
4. generate prep guidance and likely question areas
6. save the result to Sheets and track applications

## Architecture summary

The app is a browser extension with:

- settings and configuration in the options page
- a side panel with multiple tabs
- per-tab resume state and job session cache
- AI integrations for Gemini and other providers
- Google Sheets integration for summary and tracking data

## Current constraints

- Gemini quota and request throttling can cause 429s and failover loops
- Token use rises sharply with large structured prompts and repeated retries
- The app already has non-Google provider support but the main feature flow still has a strong Gemini dependency

## Product intent

We want to keep the app usable without forcing every feature through one provider.

The preferred end state is:

- multi-provider routing
- provider fallback on quota / timeout / unavailable errors
- reduced token usage via targeted prompts and smaller payloads
- saved-result reuse to avoid repeat AI work

## Gemini fallback cost control

Every fallback hop re-sends the whole prompt, so the cascade itself was a token multiplier: four models plus an uncapped output-cap retry each could reach eight full sends of the same payload for one logical call. `geminiClient.js` now bounds that.

- `MAX_PROMPT_SENDS` equals the model-list length. Each transmission counts, including the uncapped output-cap retry, so a single call can never send the prompt more times than there are models. Worst case dropped from 8 to 4.
- Timeouts scale with the request instead of a flat 10s: `callTimeoutFor()` gives `maxOutputTokens * 10ms`, clamped to 15–60s, and an uncapped retry gets the full 60s. The old flat cap aborted large matcher reports that were still working, then paid to re-send them to the next model.
- `modelCooldowns` parks a model after a failure so the wasted attempt happens once, not once per job in a scan loop: 6h for 404 / "not found", 5min for 429 / quota, 60s for a timeout. If every model is cooling, the full list is tried anyway rather than failing the feature.
- The map is module scope, so it is per side-panel document, meaning per browser tab. A dead model costs one wasted attempt in each tab rather than one per call.
- `MAX_PROMPT_SENDS` deliberately still allows every model a turn, which keeps the token guardrail rule intact — errors surface only once the routes are genuinely exhausted.
- `400` is still treated as retryable. It is usually a malformed request that will fail identically everywhere, but it can also mean one model rejects a schema feature, so the send budget bounds the cost rather than removing the fallback.

## Design notes

- Use Sheets as a cache and status source when a given job URL has already been analyzed.
- Preserve per-tab isolation so multiple pages can be evaluated independently.
- Prefer structured prompts but keep them short and targeted.
- Track provider/model failures and user-visible messaging clearly.

## Change log

### Token efficiency pass (README improvement 1)

- Added `condenseText()` and `TEXT_LIMITS` to `sidepanel/services/promptHelpers.js`. Every prompt input (resume, job text, recruiter notes, Tavily snippets, prep raw pile) goes through it. Use it for any new provider call too — do not paste raw extracted page text into a prompt.
- `callGeminiWithFallback(apiKey, systemPrompt, userPrompt, schema, onModelSwitch, maxOutputTokens)` — last argument is the output cap. Pass a cap for every new call site.
- Matcher output cap is derived from the enabled `RESUME_SECTIONS` entries' `maxTokens` plus `BASE_OUTPUT_TOKENS`. When adding a section, give it a `maxTokens` value.
- `finishReason: "MAX_TOKENS"` triggers one uncapped retry on the same model. Keep this behaviour: it is what makes the caps safe to tune, since a too-tight cap can only ever cost an extra request, not a degraded result. Note that thinking tokens count against `maxOutputTokens` on the flash models, so caps must stay well above the visible output size.
- The boilerplate filter in `condenseText()` only applies to lines of 60 chars or less, so real prose that mentions "sign in", "privacy policy" etc. survives. Do not widen it to match anywhere in a line.
- Rejected: one Gemini request per matcher block. Input tokens dominate that call, so re-sending the resume and posting per block costs more than the single combined request.

### Tracker search + gauge explainability

- Tracker toolbar has a search box left of the status dropdown. `state.tracker.searchQuery` filters cards on company name and job title, combined with the status filter in `filteredSortedItems()`. Pure client-side filtering over the already-fetched `state.tracker.items` — no extra Sheets requests.
- Both gauges explain themselves on hover via a shared `#gaugeTip` popup in the gauges row. Only negative factors are listed.
- The model fills a new required `score_factors: { ats, chance }` field (max 4 short items each), covered by the `BASE_OUTPUT_TOKENS` bump from 600 to 750.
- `scoreFactors()` falls back to signals already in the report (missing skills, non-Low tech gap rows, weak areas, credibility gaps, forgettable, warnings) so results saved before this field — and sheet-reconstructed summaries — still explain their scores without a re-analysis.

### KPI tab — phase 1 (sheet only)

- New `kpi` tab, toggleable in Settings > Visible Tabs like every other tab. Files: `sidepanel/features/kpiMetrics.js` (pure math) and `sidepanel/features/kpi.js` (rendering).
- Reads nothing but `state.tracker.items`. `ensureTrackerItems({ force })` in `tracker.js` is the shared UI-free loader that the Tracker tab, KPI tab and `findSavedJobByUrl()` all go through, so whoever needs the sheet first pays for the fetch. No AI calls anywhere in this tab.
- Metrics: headline tiles (total, distinct companies, avg ATS, avg chance), pipeline by status, jobs saved per week/month, ATS and chance band spreads (0-49 / 50-75 / 76-100), top missing skills, most applied companies. Range filter is all time / 30 / 90 / 365 days.
- Status order comes from `configuredStatuses()`, so renaming or adding a status in Settings reorders the funnel automatically. Statuses found in the sheet but no longer configured are appended, never dropped — those rows are still real applications.
- Charts are hand-rolled divs. MV3 CSP forbids remote scripts, so do not add Chart.js or any CDN library here.
- Known phase 1 limit, stated in the tab footnote: the sheet stores only the date a job was SAVED, never when its status changed, so nothing can measure time-in-stage.
- Phase 2 (not built): cross-check against Gmail for real reply timestamps, stage-by-stage progression and contact people.

### Auto-track on analyse

- The matcher writes the row to Sheets itself the moment an analysis succeeds (`autoSaveAnalysis()` in `matcher.js`), so nothing analysed goes untracked even if the user walks away from a bad score.
- `ANALYSED_STATUS` ("Analysed") in `tracker.js` is a reserved system status: always first in `enabledStatuses()`, has its own pink outside the semantic colour rules, is stripped from any user-configured list by `sanitizeTrackerStatusOptions()` in both `tracker.js` and `options.js`, and does not count toward `MAX_TRACKER_STATUSES`.
- The payload sends `status` only when the URL has no existing row, plus `defaultStatus` always. `handleJobUpsert()` applies `defaultStatus` on append only, so re-analysing a job the user already moved to Applied/Rejected refreshes its scores without resetting its status. Sending both means an un-redeployed Apps Script still stamps Analysed instead of falling back to Pending.
- A failed auto-save never fails the analysis — the report stays on screen and `savedToSheets` resets so the next Analyze retries the write.
- Any write to the sheet (analysis auto-save, scan save) fires `tracker:refresh`, which runs `refreshTrackerFromSheet()`: clear the persisted cache, drop the in-memory copy, refetch, re-render the Tracker, then fire `tracker:updated` so the KPI tab recomputes. It is never awaited by the analysis flow — the report renders first and the matcher status line updates when the refresh lands.
- `warmTrackerCache()` runs at the end of `init()` so the Tracker tab has data on first open without a visible load.

### Status colours

- Statuses are free text, so `colorForStatus()` in `tracker.js` resolves colour by meaning, not by list position. Renaming or reordering a status no longer changes its colour.
- `STATUS_COLOR_RULES` matches substrings in this order: kee → light saffron, ignore/withdraw/archive → grey, reject/declined/ghosted → red, pending/waiting/on hold → yellow, applied/submitted → blue. First match wins, which is why "Rejected after tech round" reads red rather than green.
- Green is reserved for real interview progression. `PROGRESS_KEYWORDS` (recruiter, screen, call, interview, round, tech, coding, hiring manager, system design, engineering manager, onsite, final, offer, hr, …) only applies after the rules above miss, and each matching status takes the next shade from `PROGRESS_GREENS`, light to deep, in the order the statuses appear in Settings. Ordering the list by stage therefore gives a natural light-to-deep progression.
- Anything unmatched falls back to `NEUTRAL_STATUS_COLOR` grey, including the default "New".
- Do not put green in `STATUS_COLOR_RULES` or in any other status palette; a green card must always mean forward progress.
### Save guard

`sidepanel/features/saveGuard.js` gates the auto-save behind a Save/Discard modal. Rules, in precedence order:

1. `warnings.language_barrier` set → always ask, even at 95% with a keyword hit. The user can't work around a language requirement.
2. A Settings keyword (default `.net`) found in the job text → save silently, scores ignored.
3. Both `ats_score < guardMinAts` (50) and `chance_of_getting_job < guardMinChance` (40) → ask. Either score clearing its own threshold is enough to save silently.
4. Otherwise save silently.

`warnings.visa_sponsorship_concern` never blocks a save — it still renders as a warning chip, but the user handles relocation/sponsorship themselves. Discarding writes nothing and leaves `savedToSheets` false, so re-running Analyze offers the choice again.

- The "Re-Analyze Match" and "Save to Google Sheets" buttons are gone. Analyze Current Page is the single entry point: first click on a known URL serves the free sheet summary, clicking again runs the full analysis, which is also how a re-uploaded resume is re-run.

### Code review hardening

- `safeHttpUrl()` in `ui/format.js` is the only way sheet or model supplied URLs reach a link or `window.open`. Anything that isn't `http:`/`https:` becomes `""`. Never assign a raw `jobUrl`/`applyUrl` to `href` again.
- No feature builds markup from model output with `innerHTML`. Use `textContent` or element construction.
- `shared/settingsSchema.js` is the single source for settings defaults and sanitisers, imported by both the side panel and the options page. `options.js` is now `type="module"` for this reason. Add new settings rules there, not in two places.
- `ensureTrackerItems()` serialises through `loadQueue`, so concurrent callers collapse to one fetch and a forced refresh can never resolve with items an in-flight load is about to replace.
- `ui/chartKit.js` owns `el`/`svg` and the tooltip + hover/click wiring (`createChartTooltip`). KPI renderers consume it rather than redefining DOM helpers.

## Future work checklist

- tune model routing logic for each task type
- add backoff and retry policy
- reduce expensive Gemini usage in non-critical flows
- centralize provider abstraction and fallback rules
- keep documentation and implementation in sync

## One-sentence project principle

This project should be resilient, cost-aware, and multi-provider by default, without losing the convenience of a single side-panel workflow.

### Cover Letter & Salary removed

The Cover Letter and Salary features are gone: the `apply` tab, `features/coverLetter.js`, `features/salary.js`, their prompts and Settings boxes, and the bundled jsPDF library. Do not reintroduce them. `refreshApplyButtons()` and `setApplyStatus()` no longer exist, and `customInstructions` now only holds matcher, prep and scan.
