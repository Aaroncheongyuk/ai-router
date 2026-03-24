# AGENTS.md

Canonical project instructions live in `CLAUDE.md`.

If your runtime prefers `AGENTS.md`, follow both documents with this priority:

1. `CLAUDE.md`
2. `docs/architecture.md`
3. `docs/p0-plan.md`
4. `docs/roadmap.md`

Short version:
- keep routing separate from orchestration
- keep P0 minimal and Gastown-first
- avoid framework lock-in
- **resolve CLI is internal — integrate through wrappers only** (see `docs/INTEGRATION.md`)
