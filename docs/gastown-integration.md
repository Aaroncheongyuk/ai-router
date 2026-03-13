# Gastown-first Integration

## Scope

This document provides a **quick reference** for wiring a new Gastown project with ai-router.

For detailed technical information, see: `docs/system-gastown-init-and-fallback.md`

For validation checklist, see: `docs/gastown-init-stress-checklist.md`

## What is now proven

`ai-router` + Gastown is no longer just a design sketch.

The current proven path is:
1. Gastown launches a custom preset that points at `wrappers/claude-38`.
2. The wrapper normalizes Gastown identity into `runtime` + `role`.
3. The wrapper resolves the route from `configs/routing.json`.
4. The wrapper exports Anthropic-compatible env for Claude.
5. The wrapper writes launch/exit metadata under `.runtime/ai-router/`.
6. On recoverable exits, the wrapper can advance to the next model candidate.

The canonical current-state note is:
- `docs/system-gastown-init-and-fallback.md`

## Minimal initialization checklist

Use this when wiring a real Gastown project.

1. Register a Gastown agent preset that launches `wrappers/claude-38`.
2. Keep routing in central `ai-router` config unless you intentionally override `AI_ROUTER_CONFIG_DIR`.
3. Make sure required auth env such as `EP38_API_KEY` is available.
4. Launch the role normally through Gastown, for example `gt crew start` or `gt crew restart`.

Example references:
- `examples/gastown/settings/agents.json`
- `examples/gastown/settings/config.json`

## Initialization rules that matter

- `GT_RIG` is not an `ai-router` runtime key.
- Runtime must be derived from `AI_ROUTER_RUNTIME` or normalized from `GT_ROLE`.
- Generic Gastown crew roles normalize to runtime `gastown` + role `crew`.
- `ai_router/crew/<name>` keeps its subrole and resolves as `crew/<name>`.

If these rules are wrong, Gastown launches still work, but route resolution silently falls back to the wrong route family.

## Fallback rules that are implemented today

Wrapper-side fallback is live today.

Recoverable exit classes currently recognized:
- `rate_limit`
- `provider_recoverable`
- `transport_recoverable`
- `context_window_recoverable`

Current behavior:
- if the previous exit is recoverable, the wrapper advances `AI_ROUTER_TARGET_INDEX`
- if the route is exhausted, auto-recovery clamps to the last candidate
- if `AI_ROUTER_TARGET_MODEL` is explicitly set, that pin wins and automatic fallback is effectively disabled

## Real-project verification checklist

When verifying a real Gastown project, check these in order:

1. Confirm the role is using an unpinned wrapper-based agent config.
2. Inspect `.runtime/ai-router/launch/<session>.json`.
3. Inspect `.runtime/ai-router/exit/<session>.json`.
4. Verify `target_index`, `candidate_count`, and `selected_model`.

Do not use tmux pane text or session env as the primary source of truth.

## Most important operational pitfall

If a project-local config sets `AI_ROUTER_TARGET_MODEL`, fallback will appear broken even when the central route has multiple candidates.

That behavior is intentional and covered by wrapper regression tests.

## Related docs

- `docs/system-gastown-init-and-fallback.md` — **canonical source of truth**
- `docs/gastown-init-stress-checklist.md` — **canonical validation checklist**
- `docs/gastown-crew-fallback.md` — design document for future recovery automation
