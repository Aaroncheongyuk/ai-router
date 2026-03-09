# Roadmap

## P0 — Gastown-first bootstrap
Goal:
- prove clean separation between orchestration and routing
- bootstrap repo, contracts, and Gastown-first integration path

## P1 — ai-router core stabilization
Goal:
- implement route resolution
- stabilize config schema
- stabilize fallback policy
- add contract tests

## P2 — pi adapter
Goal:
- connect pi to the shared routing layer
- start with wrapper mode if needed
- move toward a more native provider integration later

## P3 — Claude standalone adapter/wrapper
Goal:
- allow Claude-driven workflows to consume the same routing decisions outside Gastown

## Later phases
Possible future work:
- Codex adapter
- Gemini/Google CLI adapter
- proxy/data-plane service
- observability, quota, and policy tooling
