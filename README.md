# ai-router

Shared AI routing layer for multi-agent developer workflows.

## Goal

`ai-router` separates model/provider/auth/fallback routing from orchestration.

- **Orchestration** stays in frameworks like Gastown, pi-overstory, or others.
- **Routing** lives here as a reusable shared layer.
- **Runtime adapters/wrappers** translate routing decisions into concrete CLI/provider settings.

## Current phase

This repository starts with **P0: Gastown-first bootstrap**.

P0 goal:
- prove that Gastown can launch an agent through an `ai-router`-controlled route
- keep routing config independent from the orchestration framework
- defer pi native adapter, Claude standalone adapter, and proxy work until later phases

## P0 scope

In scope:
- shared routing/config docs
- `resolve` contract for route selection
- Gastown-first wrapper/bootstrap plan

Out of scope for P0:
- full proxy layer
- pi native provider integration
- Codex/Gemini adapters
- observability/budget dashboard

## Key docs

- `CLAUDE.md` — canonical agent instructions for this repo
- `AGENTS.md` — compatibility shim for runtimes that prefer AGENTS.md
- `docs/architecture.md` — repo boundaries and architecture
- `docs/p0-plan.md` — P0 implementation target and acceptance criteria
- `docs/system-gastown-init-and-fallback.md` — canonical current-state note for Gastown init, normalization, fallback, and real-project findings
- `docs/gastown-integration.md` — practical Gastown initialization checklist and verification flow
- `docs/gastown-init-stress-checklist.md` — reusable new-project simulation and pressure-test checklist
- `docs/gastown-crew-fallback.md` — implemented-vs-designed fallback/restart boundary for persistent crews
- `docs/roadmap.md` — phase roadmap after P0

## Initial repo policy

- Keep this repo framework-agnostic.
- Do not hard-bind 38ep logic to Gastown, pi, or Claude-specific code.
- Prefer stable contracts over fast hacks.
- P0 must stay minimal.
