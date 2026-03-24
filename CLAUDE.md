# ai-router — Agent Instructions

## Mission

Build and maintain a shared AI routing layer that can be reused by different orchestration frameworks and runtimes.

## Architectural rule

Keep three concerns separate:

1. **Orchestration** — task dispatch, worktrees, lifecycle, supervision
2. **Routing** — provider/model/profile/auth/fallback resolution
3. **Runtime adaptation** — translate routing decisions into concrete CLI/provider settings

`ai-router` owns **(2)** and the reusable parts of **(3)**.
It does **not** own framework orchestration.

## P0 focus

P0 is strictly **Gastown-first bootstrap**.

Deliver the smallest useful slice:
- a clean repo scaffold
- routing config and contract docs
- a minimal `resolve` design
- Gastown-first wrapper/adaptation plan

Do **not** expand P0 into:
- a general proxy service
- a full SDK
- a complete multi-runtime matrix
- premature UI/telemetry work

## Source of truth docs

- `docs/architecture.md`
- `docs/p0-plan.md`
- `docs/roadmap.md`

## Integration boundary (Iron Rule)

**The `resolve` CLI is an internal implementation detail. All external projects MUST integrate through a wrapper (`wrappers/claude-38`, `wrappers/pi`, etc.), never by calling `resolve` directly.**

The wrapper is the enforcement layer for fallback logic, exit metadata, and automatic recovery. Bypassing it means no fallback on provider failure.

See `docs/INTEGRATION.md` for the full contract.

## Working rules

- Keep files small and explicit.
- Prefer plain YAML/JSON contracts over clever abstractions.
- Do not bake framework-specific assumptions into the core routing model.
- If a decision is temporary, mark it clearly.
- If adding a runtime-specific workaround, isolate it in an adapter/wrapper.

## Naming

Use **ai-router** as the project/system name.
Use **routing** as the internal concept/module name.

## Initial phase map

- P0: Gastown-first bootstrap
- P1: ai-router core stabilization
- P2: pi adapter
- P3: Claude standalone adapter/wrapper
