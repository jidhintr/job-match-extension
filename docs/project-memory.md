# Project memory

## Why this project exists

This extension is intended to help a job seeker evaluate roles faster and with less manual context-switching.

The main workflow is:

1. open a job page
2. extract the role and description
3. compare it against the candidate resume
4. generate prep guidance and likely question areas
5. optionally create a cover letter or salary estimate
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

## Design notes

- Use Sheets as a cache and status source when a given job URL has already been analyzed.
- Preserve per-tab isolation so multiple pages can be evaluated independently.
- Prefer structured prompts but keep them short and targeted.
- Track provider/model failures and user-visible messaging clearly.

## Future work checklist

- tune model routing logic for each task type
- add backoff and retry policy
- reduce expensive Gemini usage in non-critical flows
- centralize provider abstraction and fallback rules
- keep documentation and implementation in sync

## One-sentence project principle

This project should be resilient, cost-aware, and multi-provider by default, without losing the convenience of a single side-panel workflow.
