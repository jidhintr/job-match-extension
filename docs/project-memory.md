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

## Section-aware condensing

`condenseText()` in `promptHelpers.js` used to strip only short boilerplate *lines*, then hard-truncate from the top at the char cap. Whole marketing sections survived, and on a posting that opens with "About us" / "Our values" / "Benefits" the budget was spent before the requirements were reached — so the section that actually drives matching was the part cut off by `[truncated]`. That was a quality bug, not only a token cost.

- `stripNoiseSections()` walks the deduped lines and drops everything under a heading matching `NOISE_SECTION_HEADING` (about us, values, benefits, perks, diversity, EEO, hiring process, how to apply, legal). Dropping stops at the next `CONTENT_SECTION_HEADING` (responsibilities, requirements, qualifications, skills, what you'll do, nice to have, tech stack).
- Only lines up to `SECTION_HEADING_MAX_LEN` are considered headings, so a long prose line can never be mistaken for one.
- Trimming is applied only if a content heading was positively identified. A posting written in another language, or one with no recognisable structure, is returned untouched rather than guessed at.
- `MIN_TRIMMED_CHARS` is the second guard: if the kept text is under it the original is used, which covers a stray heading word (a lone "Experience" in a nav menu) matching and leaving a stub.
- Both guards fail toward keeping too much. A false positive costs tokens; a false negative would silently delete the requirements, so the asymmetry is deliberate.
- Affects Matcher, Scan Jobs and Interview Prep, since all three condense through this function.

## Local junk-page rejection in scan

The bulk scan used to spend a full AI call on every list entry, including cookie banners, login walls and talent-network signups, because `is_job_posting` was decided by the model. `looksLikeJobPosting()` in `scan.js` now decides that locally, after extraction and before the call.

- Keep if `JOB_POSTING_SIGNAL` matches, otherwise keep anyway when the text is at least `MIN_JOB_TEXT_CHARS` and `JUNK_PAGE_SIGNAL` does not match. Rejection therefore needs both no posting signal and either junk wording or too little text.
- The length fallback is what protects postings written in another language, which carry none of the English keywords.
- Deliberately biased toward keeping: a false positive costs one call the model would have rejected anyway, a false negative silently hides a job the user would never see. Anything ambiguous, such as a careers homepage listing several roles, still goes to the model.
- Empty extractions are now skipped locally. Previously they were sent as "(no description available)" and the model returned `is_job_posting: false`, so the outcome is unchanged and the call is saved.
- Skipped entries are counted and reported in the scan status line so over-rejection is visible rather than silent.
- The job page is still opened to get its text, so the saving is the AI call and its round trip, not the tab fetch.

## Cached candidate profile (scan only)

Bulk scan re-sent the same 5000-char resume on every job, so a 25-job scan spent roughly 31k tokens repeating one document. `candidateProfile.js` replaces that with a ~450-char fact block generated once and cached in `chrome.storage.local`.

- It is an **extraction, not a summary**. The prompt demands every technology, framework, tool and language named anywhere in the resume, copied as written, including single mentions. Narrative prose is dropped because it does not move a 0-100 match; a one-off niche skill would, so losing one is treated as a failure.
- `seniority` takes the resume's own wording and explicitly covers Staff, Principal, Architect, Engineering Manager and Director. Forcing every candidate onto an individual-contributor ladder would under-score management and architecture roles.
- `leadership` captures people management, mentoring, hiring, delivery and architecture ownership with team sizes. Without it the profile is all-IC signal and Staff / Architect / EM postings match poorly, since their requirements are mostly non-coding.
- Scan only. Matcher still receives the full resume, because its report quotes and reasons about actual wording.
- The cache key is `PROFILE_VERSION` plus a djb2 hash and the length of the condensed resume, so editing the resume, switching to a per-tab uploaded resume, or changing the schema all invalidate it automatically.
- Any failure falls back to the previously condensed resume, so a profile problem costs tokens rather than breaking the scan.
- `renderProfile()` returns an empty string when the model gives back no technologies, which routes the caller to the same fallback instead of sending a hollow profile.
- The generating call is charged once per resume version, so it pays for itself from the second scanned job onward.

**Not verified against live results.** The design preserves matchable signal by construction, but no A/B of scan scores has been run. If scores drift, compare a profile-based scan against a full-resume scan on the same listing page before tuning further.

**Rejected: a two-stage scan then deep-scan funnel.** It already exists as Scan Jobs then Matcher, and it cannot protect a cheap first pass — a funnel's recall is capped by its first stage, so anything wrongly scored low in step one is never offered for step two.

## Tracked status on the Matcher tab

`#jobStatusBadge` sits under the gauges inside the job identity card and shows the job's tracker status, so a saved job's state is visible without switching tabs.

- The status is read live from `state.tracker.items` by `lastJobUrl` via `trackedStatusForUrl()`, never copied into `lastResult`. Copying it would persist into per-tab session state and go stale the moment the status changed elsewhere.
- Colour comes from `paintStatusChip()`, which reuses `colorForStatus()` and `hexToRgba()` in `tracker.js`, so the badge, the tracker card and the KPI charts can never disagree about what a status looks like.
- `tryLoadSavedAnalysisForCurrentTab()` assigns `lastJobUrl` before calling `renderReport()`. The old order rendered first, which would leave the badge blank on the sheet-restore path.
- `notifyTrackerUpdated()` now fires from `refreshTrackerFromSheet()`, `warmTrackerCache()` and a successful `changeStatus()`. Only the first of those dispatched before, so the KPI tab was also silently stale after a status change and after warm-up.
- On session restore the tracker may not be loaded yet, so the badge starts hidden and appears when warm-up lands. It is absent rather than wrong.
- Display only. Changing status still happens in Tracker, so there is one write path to the sheet.

## Tracker cache invalidation

Two separate defects made the Matcher badge disagree with the Tracker and with the sheet.

**TTL was only ever consulted on the first load.** `ensureTrackerItems()`, `loadTrackerItems()` and `loadTrackerData()` all gated on `state.tracker.loaded` alone, and nothing ever set it back to false. Once a side panel document had loaded items, it served that in-memory copy for as long as the document lived, so `cacheTtlHours` had no effect after the first read. All three now gate on `loadedItemsStillFresh()`, which re-checks `state.tracker.cachedAt` against the TTL on every call. A `cachedAt` of null is treated as stale, so an unstamped copy is never trusted.

**There is one side panel document per browser tab, each with its own `state`.** Changing a status in one tab's panel wrote to the shared `chrome.storage.local` cache, but every other open panel kept its own stale array in memory and never re-read it. `onTrackerCacheChanged()` in `trackerCache.js` now watches the storage key and pushes the new items into `state`, then fires `tracker:updated` so the tracker list, KPI charts and Matcher badge all repaint.

- Each document stamps its writes with a `WRITER_ID`, and the listener ignores its own, so a status change repaints the other panels without the originating one re-rendering the list under the user's cursor.
- `clearTrackerCache()` fires a change event with no `newValue`, which the guard drops — a clear is always followed by a fetch that writes fresh items anyway.
- Cache entries written before this change carry no `writerId`, so they read as foreign and are applied. That is the safe direction.
- `warmTrackerCache()` no longer early-returns when items are already loaded. It delegates freshness to `ensureTrackerItems()` and always notifies, which is what paints the Matcher badge on panel open.

## Job URL identity

The sheet is keyed on the exact URL string (`findRowByJobUrl` in `google-apps-script.js` does a trimmed string compare), but the two writers produce different strings for the same job. Scan sends the listing anchor's href, Matcher sends `window.location.href` from the content script. A trailing slash, a `utm_` parameter, `www.`, or a `#` fragment was enough to create a second row, so one job could sit in the sheet twice with different statuses, and an exact-match lookup would return whichever row it happened to hit.

- `canonicalJobUrl()` in `format.js` forces https, drops `www.`, drops the hash, strips tracking parameters (`utm_*`, `fbclid`, `gclid`, `trk`, `refId`, `ref`, `source`, …) and removes trailing slashes. Real identifying query parameters such as `?id=12` are preserved, so distinct jobs stay distinct.
- All lookups compare canonical to canonical via `findTrackedItemByUrl()`. Nothing depends on the raw string matching any more.
- When several rows canonicalise to the same job, an actively chosen status wins over an untouched one (`""`, `Pending`, `Analysed`); ties break on the newest `dateTime`. A stale scan-created `Pending` therefore never masks the `Applied` the user set by hand.
- Writes avoid creating further duplicates: `buildSheetPayload()` reuses the existing row's exact `jobUrl` when a canonical match is found, so the Apps Script still updates that row, and only genuinely new rows get a canonical key. Scan writes canonical keys directly.
- Rows that already exist in duplicate are not merged. The lookup rules make the UI correct, but the sheet stays dirty until cleaned by hand.

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
