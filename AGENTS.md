# AGENTS.md

This file stores project context for agentic coding tools and future collaborators.

## Project summary

This repository is a Chrome/Edge extension called MatchResumer.

It includes:

- resume matcher against job descriptions
- interview prep workflows
- bulk job scanning
- tracker sync to Google Sheets

## Important product direction

- The project should not depend on a single provider for all AI work.
- Gemini is useful, but it should be used with quota-aware fallback logic rather than as the mandatory default path.
- Multi-provider routing is a strategic improvement goal.
- Token efficiency is a first-class concern for all AI calls.

## Coding guardrails

- Keep feature logic separated across `sidepanel/features/*`.
- Shared provider logic belongs in `sidepanel/services/*`.
- Storage/settings logic belongs in `sidepanel/services/storage.js` and `sidepanel/state/store.js`.
- Do not hardcode Gemini as the only option for core features.
- When changing price/cost-sensitive prompts, update the docs and project memory.
- Token limits are guardrails, not user-facing failures.
- If a model hits a token cap or output barrier, automatically switch providers/models or shrink the payload before surfacing a failure.
- Do not break trust or UX with visible token-limit errors when a transparent fallback is available.
- Keep comments minimal and only add them when the logic is genuinely non-obvious.

## High-priority follow-up work

- improve provider failover logic
- reduce prompt size and structured JSON payload cost
- dedupe repeated analysis requests
- improve the user-facing handling of 429 / quota / timeout errors
- keep README and project memory aligned with implementation

## Preferred default approach for future work

Prefer a design that can route tasks across multiple providers with clear fallback behavior. Keep Gemini in the stack, but do not let it become the sole bottleneck for the application.
