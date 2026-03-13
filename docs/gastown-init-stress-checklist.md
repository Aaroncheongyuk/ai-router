# Gastown Init Stress Checklist

## Purpose

Run this checklist for **every new Gastown project** before using a real task.

Goal:
- catch init and fallback bugs in a disposable simulation pass
- avoid discovering routing bugs only after a real project is already running

This checklist is intentionally split into:
1. fast local simulation
2. disposable Gastown end-to-end verification

Do not skip phase 1.

## Pass gate

A new project is not ready until all of these are true:
- wrapper resolves the expected runtime and role
- launch metadata is written
- recoverable exits advance to the next candidate
- project-local pin behavior is understood and intentional
- unpinned Gastown crew can relaunch on the next candidate
- independent towns are not accidentally sharing the tmux `default` socket

## Baseline requirement

Before running this checklist, confirm the Gastown codebase is based on a
recent upstream GitHub version that already includes the session/env fixes
needed by `ai-router`.

Recommended upstream baseline:
- `gastown origin/main`
- commit `e3a5f80a35b35a75db0d64252b7821a1b1dbd15d` or newer

Relevant upstream compatibility features:
- handoff restart honors `role_agents`
- tmux session env preserves `GT_AGENT` / `GT_PROCESS_NAMES`
- non-Claude startup paths no longer force Claude
- `gt crew start --rig` is available upstream

This checklist validates `ai-router` integration on top of that baseline. It
does not assume upstream Gastown natively implements ai-router fallback policy.

## Phase 0: project wiring checklist

- [ ] Gastown agent preset points to `wrappers/claude-38`
- [ ] if hooks are enabled, the preset uses the current upstream Claude hook shape: `hooks_provider=claude`, `hooks_settings_file=settings.json`
- [ ] project can read the central `ai-router` config, or explicitly documents an override via `AI_ROUTER_CONFIG_DIR`
- [ ] project inherits the global `ai-router` `gastown.*` route family unless a local override is explicitly intended and documented
- [ ] provider auth env such as `EP38_API_KEY` is available
- [ ] roles that need fallback are **not** pinned with `AI_ROUTER_TARGET_MODEL`
- [ ] role-to-route expectation is written down before testing
- [ ] team knows whether this Gastown tree includes local ai-router integration patches beyond upstream

Choose the project shape before testing:

- [ ] `shared town / shared rig registry`
  - project is only another rig under an existing town
  - reuse the town's Mayor, Deacon, Dolt server, tmux socket, and central `ai-router` route chain
  - do **not** allocate a new Dolt port or tmux socket just for this rig

- [ ] `independent town`
  - project has its own HQ / town root
  - assign a unique `GT_TMUX_SOCKET` before starting agents
  - do **not** run independent towns on tmux `default`
  - if this town is also isolated at the Dolt layer, assign its own Dolt port too

If you require **automatic** persistent-crew fallback, verify these local
integration items before using a real project:
- [ ] crew startup injects `AI_ROUTER_TOWN_ROOT` and the wrapper respects it, so metadata lands in the authoritative town runtime path
- [ ] persistent crew recovery reads `.runtime/ai-router/launch|exit`
- [ ] live `max_prompt_tokens` recovery behavior is defined: soft continue first, or direct restart fallback

If those items are absent, you may still use the wrapper and central routing,
but only wrapper-side fallback semantics are validated by this checklist.

Write down the expected route for this project:

```text
GT_ROLE=<rig>/crew/<name>
expected runtime=gastown
expected role=crew
expected candidates=MiniMax-M2.5 -> glm-5 -> glm-4.7
```

If this is an independent town, also write down:

```text
expected tmux socket=<unique per-town socket>
expected metadata root=<town>/.runtime/ai-router
```

## Phase 1: local simulation pressure test

Run these from the `ai-router` repo.

### Case 1: baseline wrapper resolution

- [ ] Command

```bash
EP38_API_KEY=dummy-key \
UNDERLYING_CLAUDE_BIN=env \
GT_RIG=testrig \
GT_ROLE=testrig/crew/worker1 \
bash wrappers/claude-38
```

- [ ] Expect
  - `AI_ROUTER_RESOLVED_RUNTIME=gastown`
  - `AI_ROUTER_RESOLVED_ROLE=crew`
  - `AI_ROUTER_SELECTED_MODEL=MiniMax-M2.5`
  - `AI_ROUTER_CANDIDATE_COUNT=3`

### Case 2: role normalization edge case

- [ ] Command

```bash
EP38_API_KEY=dummy-key \
UNDERLYING_CLAUDE_BIN=env \
GT_RIG=ai_router \
GT_ROLE=ai_router/crew/router_core \
bash wrappers/claude-38
```

- [ ] Expect
  - `AI_ROUTER_RESOLVED_RUNTIME=ai_router`
  - `AI_ROUTER_RESOLVED_ROLE=crew/router_core`

### Case 3: simulated recoverable fallback

- [ ] Command

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/exit"
cat > "$tmp/exit/sim-recover.json" <<'JSON'
{"target_index":0,"exit_class":"context_window_recoverable"}
JSON

EP38_API_KEY=dummy-key \
UNDERLYING_CLAUDE_BIN=env \
GT_SESSION=sim-recover \
GT_ROLE=testrig/crew/worker1 \
AI_ROUTER_RUNTIME=gastown \
AI_ROUTER_STATE_ROOT="$tmp" \
bash wrappers/claude-38
```

- [ ] Expect
  - `AI_ROUTER_SELECTED_TARGET_INDEX=1`
  - `AI_ROUTER_SELECTED_MODEL=glm-5`

Repeat the same pattern for:
- [ ] `rate_limit`
- [ ] `provider_recoverable`
- [ ] `transport_recoverable`

### Case 4: pinned-model override

- [ ] Command

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/exit"
cat > "$tmp/exit/sim-pin.json" <<'JSON'
{"target_index":0,"exit_class":"context_window_recoverable"}
JSON

EP38_API_KEY=dummy-key \
UNDERLYING_CLAUDE_BIN=env \
GT_SESSION=sim-pin \
GT_ROLE=testrig/crew/worker1 \
AI_ROUTER_RUNTIME=gastown \
AI_ROUTER_TARGET_MODEL=MiniMax-M2.5 \
AI_ROUTER_STATE_ROOT="$tmp" \
bash wrappers/claude-38
```

- [ ] Expect
  - `AI_ROUTER_SELECTED_TARGET_INDEX=0`
  - `AI_ROUTER_SELECTED_MODEL=MiniMax-M2.5`

If this case surprises the team, stop and remove the pin before using a real project.

### Case 5: candidate exhaustion clamp

- [ ] Command

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/exit"
cat > "$tmp/exit/sim-last.json" <<'JSON'
{"target_index":2,"exit_class":"context_window_recoverable"}
JSON

EP38_API_KEY=dummy-key \
UNDERLYING_CLAUDE_BIN=env \
GT_SESSION=sim-last \
GT_ROLE=testrig/crew/worker1 \
AI_ROUTER_RUNTIME=gastown \
AI_ROUTER_STATE_ROOT="$tmp" \
bash wrappers/claude-38
```

- [ ] Expect
  - `AI_ROUTER_SELECTED_TARGET_INDEX=2`
  - `AI_ROUTER_SELECTED_MODEL=glm-4.7`

### Case 6: generic runtime error still advances fallback

- [ ] Command

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/exit"
cat > "$tmp/exit/sim-runtime.json" <<'JSON'
{"target_index":1,"exit_class":"runtime_error"}
JSON

EP38_API_KEY=dummy-key \
UNDERLYING_CLAUDE_BIN=env \
GT_SESSION=sim-runtime \
GT_ROLE=testrig/crew/worker1 \
AI_ROUTER_RUNTIME=gastown \
AI_ROUTER_STATE_ROOT="$tmp" \
bash wrappers/claude-38
```

- [ ] Expect
  - `AI_ROUTER_SELECTED_TARGET_INDEX=2`
  - `AI_ROUTER_SELECTED_MODEL=glm-4.7`

### Case 7: metadata write path

- [ ] Command

```bash
tmp="$(mktemp -d)"
EP38_API_KEY=dummy-key \
UNDERLYING_CLAUDE_BIN=env \
GT_SESSION=sim-meta \
GT_ROLE=testrig/crew/worker1 \
AI_ROUTER_RUNTIME=gastown \
AI_ROUTER_STATE_ROOT="$tmp" \
bash wrappers/claude-38 >/tmp/sim-meta.out

cat "$tmp/launch/sim-meta.json"
```

- [ ] Expect
  - launch file exists
  - contains `runtime`, `role`, `target_index`, `candidate_count`, `selected_model`

## Phase 2: repo regression tests

- [ ] Run

```bash
npm test
```

- [ ] Expect
  - all tests pass
  - wrapper smoke tests include normalization, fallback advance, and pinned-model override semantics

## Phase 3: disposable Gastown E2E check

Use a disposable crew or test rig, not the real project first.

### Phase 3 preflight: socket sanity

- [ ] If this is an independent town, export `GT_TMUX_SOCKET=<unique-socket>`
- [ ] The `gt` binary you are using actually honors `GT_TMUX_SOCKET` for tmux operations
- [ ] Confirm the disposable town is not using tmux `default`
- [ ] Confirm you are not sharing `hq-mayor` / `hq-deacon` session names with another active town
- [ ] If this is only a new rig under a shared town, keep using the shared town socket

### Case 8: unpinned crew fresh launch

- [ ] Start or restart the disposable crew through Gastown
- [ ] Prefer `gt crew start --rig <rig> <name>` on current upstream Gastown
- [ ] Inspect `.gastown/.runtime/ai-router/launch/<session>.json`

- [ ] Expect
  - `selected_model` is candidate 0
  - `candidate_count` matches the central route
  - metadata `town_root` points to the authoritative town root, not the crew worktree
  - for independent towns, the session lives on the configured town socket rather than tmux `default`

### Case 9: recoverable failure relaunch

Induce a recoverable exit on the disposable crew, or simulate it by writing the exit metadata before restart.

- [ ] Restart the same crew identity
- [ ] Inspect `.gastown/.runtime/ai-router/launch/<session>.json`

- [ ] Expect
  - `target_index` increments
  - `selected_model` moves to the next candidate

Important:
- this case only proves automatic relaunch if your Gastown tree includes the
  local ai-router recovery patchset
- on pure upstream Gastown, this case is still valid as a **manual**
  verification of wrapper-side candidate selection after a recoverable exit

Known-good disposable verification from `2026-03-13`:
- project: `co-worker`
- disposable crew: `coworker/pressure_test`
- socket: `co-worker`
- fail pass: fake runtime exit produced `exit_class=runtime_error`
- recovery pass: next launch advanced to `target_index=1`, `selected_model=glm-5`

### Case 9b: handoff / restart compatibility

- [ ] Trigger a handoff or restart on the disposable crew
- [ ] Confirm the relaunched session still uses the intended wrapper-based agent
- [ ] Confirm the relaunched session still resolves the same route family

- [ ] Expect
  - no silent fallback to a default non-wrapper agent
  - liveness detection does not misclassify the wrapped session as dead

This specifically validates the latest upstream Gastown compatibility fixes
around `role_agents`, `GT_AGENT`, and `GT_PROCESS_NAMES`.

### Case 10: project pin check

- [ ] Confirm whether the project config sets `AI_ROUTER_TARGET_MODEL`

- [ ] If yes, decide one of:
  - keep it intentionally and accept no automatic fallback
  - remove it and require fallback to work

Do not leave this ambiguous.

## Stop-ship conditions

Do not move to a real project if any of these are true:
- wrapper resolves the wrong runtime or role
- `candidate_count` is not what the team expects
- launch or exit metadata is missing
- pinned and unpinned behavior is not understood
- recoverable exits do not advance candidates in simulation
- the first disposable Gastown relaunch does not match the expected candidate

## Minimum test set after any Gastown upgrade

Yes: rerun tests after updating Gastown.

Minimum required:
- [ ] Phase 1 local simulation cases 1 through 7
- [ ] `npm test` in `ai-router`
- [ ] Phase 3 cases 8, 9, 9b, and 10 on a disposable Gastown project

If the upgrade changes session lifecycle, handoff, or agent resolution, also rerun:
- [ ] one real-project disposable crew validation before touching production crews

## What to record for each new project

Keep a short project note with:
- project path
- rig name
- crew name used for validation
- project shape: `shared town` or `independent town`
- tmux socket name
- whether config is pinned or unpinned
- expected candidate chain
- one successful launch JSON
- one successful recoverable-fallback launch JSON

This makes future regressions much easier to compare.

## Example: co-worker real validation

**Project**: `/home/aaron/ai-projects/co-worker`
**Rig**: `coworker`
**Crew**: `coworker/crew/backend`

### Config verification

| Check | Result |
|-------|--------|
| Agent preset → wrapper | `airouter-worker` → `/home/aaron/ai-projects/ai-router/wrappers/claude-38` |
| AI_ROUTER_CONFIG_DIR override | **none** — uses central ai-router config |
| AI_ROUTER_TARGET_MODEL pin | **none** — automatic fallback enabled |
| Validation result | **no problem found** |

### Dry-run resolution

```
runtime=gastown
role=crew
candidate_count=3
```

### Launch metadata location

**Critical**: Metadata is in workspace-local `.runtime/ai-router/`, NOT town-root:
- `.runtime/ai-router/launch/cw-crew-backend.json`
- `.runtime/ai-router/exit/cw-crew-backend.json`

### Fallback observed

| Run | target_index | selected_model |
|-----|--------------|----------------|
| Previous | 0 | MiniMax-M2.5 |
| Current | 1 | glm-5 |

The wrapper correctly advanced to the next candidate after recoverable exit.

## Critical debugging pitfall

**Metadata path confusion**: Launch/exit metadata is written to **workspace-local** `.runtime/ai-router/`, NOT the Gastown town-root path.

When debugging, check:
- `<workspace>/.runtime/ai-router/launch/<session>.json`
- `<workspace>/.runtime/ai-router/exit/<session>.json`

NOT `.gastown/.runtime/ai-router/` or similar paths.
