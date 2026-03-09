# P0 Plan — Gastown-first Bootstrap

## Objective

Build the minimum viable shared routing bootstrap that proves:

1. routing can live outside the orchestration framework
2. Gastown can call a runtime through an `ai-router`-controlled route
3. the routing contract can later be reused by pi and Claude standalone flows

## P0 deliverables

### D1. Clean repository bootstrap
- independent repo
- agent-readable project docs
- initial git history and working branch

### D2. Routing config skeleton
Target files:
- `configs/providers.yaml`
- `configs/models.yaml`
- `configs/routing.yaml`
- `configs/fallbacks.yaml`

### D3. `resolve` contract
A minimal contract that returns:
- runtime
- provider/profile
- protocol
- endpoint/base URL
- model
- auth env or auth source
- fallback chain
- runtime compat hints

### D4. Gastown-first wrapper path
A wrapper approach that allows Gastown presets to launch a routed runtime without embedding 38ep logic in Gastown itself.

## Non-goals

- no proxy service yet
- no pi native provider yet
- no Codex/Gemini adapters yet
- no observability platform yet

## Acceptance criteria

P0 is complete when:
- repo bootstrap is clean and documented
- routing config shape is defined
- `resolve` contract is documented well enough to implement
- Gastown integration path is explicit and testable

## Suggested first implementation branch

`feat/p0-gastown-bootstrap`
