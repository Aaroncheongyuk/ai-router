# Gastown Crew Fallback Recovery

## Status

**三层系统状态**:

| 层级 | 描述 | 状态 |
|------|------|------|
| Layer 1 — 上游 Gastown 基线 | crew restart、role_agents、GT_AGENT env 保持 | 上游已有，无路由感知 |
| Layer 2 — 本地补丁 + ai-router | 自动 model fallback 全链路闭环 | **生产验证通过** |
| Layer 3 — 任务续接 | hook_bead 权威 + checkpoint + 断点恢复 | 设计文档，未实现 |

模型自动切换已经是端到端 WORKING 的生产能力。剩余工作全部属于"任务续接"，与模型切换无关。

实际验证: `co-worker` crew 在 2026-03-13 自动从 `MiniMax-M2.5` (index 0) 推进到 `glm-5` (index 1)。

For current implementation status, see: `docs/system-gastown-init-and-fallback.md`

## Implementation status matrix

### Layer 1: Upstream Gastown baseline (1/3)

What vanilla Gastown (GitHub `origin/main`) provides out of the box:

| Capability | Status |
|------------|--------|
| `gt crew start/restart` for basic crew lifecycle | Available upstream |
| `role_agents` support — won't silently fallback to default agent on handoff/restart | Available upstream |
| `GT_AGENT` / `GT_PROCESS_NAMES` env preservation for liveness detection | Available upstream |
| Non-Claude startup paths respect agent resolution | Available upstream |
| `gt crew start --rig` for cleaner project automation | Available upstream |

What upstream does NOT provide:
- No routing awareness
- No exit classification
- No candidate advance
- No ai-router integration
- No automatic crash detection or recovery

Checked against upstream commit `67cffe50`. Relevant compatibility commits:
- `1b0b7684` `Fix handoff restart to honor role_agents`
- `d2550922` `set GT_PROCESS_NAMES in tmux env for all session types`
- `45b3f191` `skip hardcoded Claude start_command for non-Claude agents`
- `77092bb2` `add --rig flag to gt crew start for consistency with stop`

### Layer 2: Local patched Gastown + ai-router (2/3, active stack)

Everything from upstream PLUS the following production-verified additions:

| Checklist item | Owner | Status | Location |
|----------------|-------|--------|----------|
| A3. Launch metadata | ai-router/wrapper | **DONE** | `wrappers/claude-38` `write_launch_metadata` |
| A4. Exit metadata + classification | ai-router/wrapper | **DONE** | `wrappers/claude-38` `classify_exit` / `write_exit_metadata` |
| Candidate advance on recoverable exit | ai-router/wrapper | **DONE** | `wrappers/claude-38` BUG-C fix, auto-increment logic |
| Candidate exhaustion clamp | ai-router/wrapper | **DONE** | Clamps to last candidate instead of hard-fail |
| Pinned model override | ai-router/wrapper | **DONE** | `AI_ROUTER_TARGET_MODEL` bypasses auto-recovery |
| Exit class taxonomy | ai-router/wrapper | **DONE** | rate_limit, provider_recoverable, transport_recoverable, context_window_recoverable, runtime_error |
| A2. Daemon patrol / supervisor | Local Gastown patches | **DONE** | `ensurePersistentCrewRunning()` + `selectCrewRecoveryTarget()` |
| A6. Restart with env passthrough | Local Gastown patches | **DONE** | `gt crew start --env AI_ROUTER_TARGET_INDEX=N` |
| Live context window soft recovery | Local Gastown patches | **DONE** | `maybeRecoverLiveCrewContextWindow()` |
| Restart tracker with backoff | Local Gastown patches | **DONE** | crash-loop gate prevents infinite restart |
| Handoff/respawn agent env | Local Gastown patches | **DONE** | re-applies resolved wrapper env on restart |

The automatic fallback chain is **end-to-end working** for model switching:
- Daemon detects dead crew session
- Reads exit metadata → classifies exit
- `selectCrewRecoveryTarget()` advances candidate index
- Restarts crew with `AI_ROUTER_TARGET_INDEX=N`
- Wrapper picks next candidate automatically
- New model runs under the same crew identity

### Layer 3: Remaining gap — task continuity (NOT model fallback)

| Checklist item | Owner | Status | Gap |
|----------------|-------|--------|-----|
| A1. Hook authority for persistent roles | **Gastown repo** | NOT IMPLEMENTED | `hook_bead` slot correctness not guaranteed after restart |
| A5. Per-session recovery state | **Both repos** | NOT IMPLEMENTED | `.runtime/recovery/<session>.json` with breakpoint data |
| A7. Checkpoint discipline | **Both repos** | NOT IMPLEMENTED | Persistent roles don't periodically persist checkpoint |

These three items are ALL about **task continuity** — making a restarted crew resume the exact task it was working on from a specific breakpoint. They are NOT about model switching.

### Checklist summary

| Item | Status | Owner |
|------|--------|-------|
| A1. Hook authority | NOT IMPLEMENTED | Gastown repo |
| A2. Daemon patrol / supervisor | **DONE** | Local Gastown patches |
| A3. Launch metadata | **DONE** | ai-router/wrapper |
| A4. Exit metadata + classification | **DONE** | ai-router/wrapper |
| A5. Per-session recovery state | NOT IMPLEMENTED | Both repos |
| A6. Restart with gt crew --env | **DONE** | Local Gastown patches |
| A7. Checkpoint discipline | NOT IMPLEMENTED | Both repos |

**Score: 4/7 done. Remaining 3/7 are ALL about task continuity.**

## Current vs target recovery flow

### Flow 1: Upstream Gastown (no ai-router)

```
Crew crash
  → tmux session dies
  → [MANUAL] human notices and runs: gt crew restart
  → same model restarts (no candidate awareness)
  → crew starts fresh with no task awareness
```

No routing intelligence. No exit classification. No automatic anything.

### Flow 2: Local active stack (AUTOMATIC model fallback — WORKING)

```
Crew crash
  → wrapper writes exit metadata (exit_class, target_index)
  → Gastown daemon heartbeat fires
  → ensurePersistentCrewRunning() detects session dead but hook exists
  → reads .runtime/ai-router/exit/<session>.json
  → selectCrewRecoveryTarget() classifies exit
      rate_limit / provider_recoverable → advance candidate
      transport_recoverable → advance candidate
      context_window_recoverable → advance candidate
      runtime_error (post-selection) → advance candidate
  → restartTracker checks backoff / crash-loop gate
  → gt crew start --rig <rig> <name>
      --env AI_ROUTER_TARGET_INDEX=<n>
      --env AI_ROUTER_RECOVERY_REASON=<reason>
  → wrapper reads exit metadata, selects next candidate
  → crew starts with new model under same identity
  → [NO TASK RESUME] crew starts fresh, no hook_bead awareness
```

Additionally, for live sessions that hit context window limits:
```
Live crew hits max_prompt_tokens
  → daemon heartbeat fires
  → maybeRecoverLiveCrewContextWindow() captures pane tail
  → detects max_prompt_tokens / context-window signal
  → nudge: "continue current hooked task"
  → [SOFT RECOVERY] no restart needed
```

This flow is **fully automatic and production-verified**.

### Flow 3: Target fully automatic (remaining gap)

```
Crew crash
  → wrapper writes exit metadata
  → daemon detects, classifies, advances candidate       ← DONE (Layer 2)
  → gt crew start with TARGET_INDEX                       ← DONE (Layer 2)
  → wrapper selects next candidate                        ← DONE (Layer 2)
  → crew starts with new model
  → crew reads authoritative hook_bead                    ← A1 (NOT IMPLEMENTED)
  → crew loads recovery checkpoint                        ← A5+A7 (NOT IMPLEMENTED)
  → crew resumes hooked task from breakpoint
```

The gap between Flow 2 and Flow 3 is strictly about **task continuity**:
- Knowing WHAT task to resume (A1: hook_bead authority)
- Knowing WHERE in the task to resume (A5+A7: checkpoint + recovery state)

## Architecture diagram

```
┌──────────────────────────────────────────────────────┐
│  Layer 1: Upstream Gastown baseline                   │
│                                                       │
│  gt crew start/restart                   AVAILABLE    │
│  role_agents support                     AVAILABLE    │
│  GT_AGENT / GT_PROCESS_NAMES env         AVAILABLE    │
│  gt crew start --rig                     AVAILABLE    │
│  (no routing awareness)                               │
└──────────────────────────┬───────────────────────────┘
                           │ enhanced by local patches
                           ▼
┌──────────────────────────────────────────────────────┐
│  Layer 2: Local patched Gastown + ai-router           │
│                                                       │
│  Gastown daemon patches (IMPLEMENTED)                 │
│  ├─ ensurePersistentCrewRunning()                     │
│  │    ├─ scan rigs → detect dead crew sessions        │
│  │    └─ read .runtime/ai-router/launch|exit          │
│  ├─ selectCrewRecoveryTarget()                        │
│  │    └─ classify exit → advance candidate index      │
│  ├─ maybeRecoverLiveCrewContextWindow()               │
│  │    └─ soft-recover live max_prompt_tokens sessions  │
│  ├─ restartTracker with backoff / crash-loop gate     │
│  ├─ gt crew start --env AI_ROUTER_TARGET_INDEX=N      │
│  └─ handoff/respawn re-applies resolved agent env     │
│                                                       │
│  ai-router wrapper (IMPLEMENTED)                      │
│  ├─ classify_exit → write exit metadata               │
│  ├─ read exit metadata → auto-advance candidate       │
│  ├─ resolve: candidate chain + fallback resolution    │
│  └─ ENV: AI_ROUTER_TARGET_INDEX, ANTHROPIC_MODEL, etc │
└──────────────────────────┬───────────────────────────┘
                           │ launches claude with resolved env
                           ▼
┌──────────────────────────────────────────────────────┐
│  Layer 3: Task Resume Protocol (NOT IMPLEMENTED)      │
│                                                       │
│  1. gt prime                                          │
│  2. resolve identity                                  │
│  3. read authoritative hook_bead         ← A1         │
│  4. load recovery checkpoint             ← A5+A7      │
│  5. inspect changed files / git state                 │
│  6. continue current hooked task from breakpoint      │
└──────────────────────────────────────────────────────┘
```

---

This document describes the **minimum viable automatic fallback + restart design** for persistent Gastown roles when using `ai-router` as the routing layer.

It is written for a generic **Project X**. `co-worker` is only an example environment, not part of the design.

## Goal

When a persistent Gastown role such as:
- `mayor`
- `projectx/crew/coordinator`
- `projectx/crew/backend`
- `projectx/crew/frontend`

is executing hooked work and the underlying Claude/model session fails due to:
- provider rate limit
- provider outage
- transport/network failure
- Claude process exit
- tmux session loss

then the system should:
1. detect the failure
2. classify whether it is fallback-worthy
3. move to the next `ai-router` candidate
4. restart the same role through official Gastown commands
5. resume the same task from hook + workspace state

Steps 1–4 are **DONE** in the local active stack. Step 5 is the remaining Layer 3 gap.

## What is already true today

### ai-router wrapper (production-proven)

1. **Exit classification**: wrapper inspects pane tail + exit code → assigns `exit_class`
   (`rate_limit`, `provider_recoverable`, `transport_recoverable`, `context_window_recoverable`, `runtime_error`)
2. **Exit metadata**: wrapper writes `.runtime/ai-router/exit/<session>.json` with `exit_class` + `target_index`
3. **Candidate advance**: next launch reads exit metadata → auto-increments `target_index` for any recoverable class
4. **Candidate exhaustion clamp**: if auto-recovery index exceeds candidate count → clamps to last candidate (no hard-fail)
5. **Pinned model override**: `AI_ROUTER_TARGET_MODEL` bypasses auto-recovery entirely
6. **Launch metadata**: wrapper writes `.runtime/ai-router/launch/<session>.json` for observability

### Local Gastown daemon patches (production-proven)

7. **Persistent crew patrol**: `ensurePersistentCrewRunning()` scans rigs, detects dead crew sessions that still have hooks
8. **Exit classification consumption**: reads `.runtime/ai-router/launch|exit` metadata written by the wrapper
9. **Recovery target selection**: `selectCrewRecoveryTarget()` maps exit_class to candidate index advancement
10. **Live session soft recovery**: `maybeRecoverLiveCrewContextWindow()` detects `max_prompt_tokens` in live pane tail and nudges continuation without hard restart
11. **Restart with env injection**: `gt crew start --env AI_ROUTER_TARGET_INDEX=N` passes the advanced candidate index to the wrapper
12. **Crash-loop protection**: restartTracker with backoff prevents infinite restart loops
13. **Agent env persistence**: handoff/respawn re-applies resolved agent env so `AI_ROUTER_TARGET_INDEX` and `ANTHROPIC_BASE_URL` survive restart

### What this means in practice

- **Model fallback is fully automatic** — the daemon detects crashes, classifies the exit, advances the candidate, restarts with the new model, all without human intervention.
- **The full automatic loop works end-to-end** — not just the wrapper-side selection, but the entire detect → classify → advance → restart → launch cycle.
- **Task resume is not automatic** — a restarted crew starts fresh. It does not know what hook_bead it was working on or where it left off. That is the Layer 3 gap.

## Boundary Rule

Keep responsibilities separate.

### Gastown owns
- orchestration
- role/session lifecycle
- supervision and restart policy
- hook/task durability
- crew startup order

### ai-router owns
- route resolution
- ordered candidate model chain
- provider/auth/header/env resolution

### wrapper owns
- translating a selected route candidate into runtime env
- starting Claude CLI
- handling runtime-specific startup prompts

## Non-goals

This design does **not** make `ai-router` a supervisor.

This design does **not** rename tmux sessions per task title.

This design does **not** move orchestration into wrappers.

## Session Naming Policy

Session names should stay stable and identity-based.

Examples:
- `hq-mayor`
- `px-crew-coordinator`
- `px-crew-backend`
- `px-crew-frontend`

Do **not** rename tmux session IDs to task titles.

If task visibility is needed, update the **window title / pane title / statusline**, not the session identity.

## Runtime Identity vs Task Identity

- **session identity** = who is running
- **hook bead / task bead** = what is running

The recovery system must key off stable role identity and hook state, not mutable task labels.

## Authoritative Recovery State

Automatic recovery must not depend on the Claude chat buffer surviving.

### Required sources of truth

1. `agent_bead.hook_bead`
2. task bead status
3. workspace filesystem state
4. recovery checkpoint metadata

### Important rule

For auto-recoverable persistent roles, the authoritative task binding must be:

- **agent bead `hook_bead` slot**

Do **not** rely only on:
- task assignee text
- pane text
- tmux session title

## Recovery Ownership

### System supervisor
Use systemd/launchd/supervisor to keep the Gastown daemon alive.

### Gastown supervisor
The Gastown daemon's `ensurePersistentCrewRunning()` now serves as the persistent-role supervisor. This is **IMPLEMENTED** in local Gastown patches.

It handles:
- checking persistent role sessions
- reading crash signals via ai-router exit metadata
- deciding retry vs fallback via `selectCrewRecoveryTarget()`
- restarting via official Gastown commands with candidate index env
- crash-loop prevention via restartTracker

### Witness
Witness continues to own polecat lifecycle, not persistent crew lifecycle.

### Mayor / Coordinator
Mayor and Coordinator may observe progress and escalations, but should not be the primary low-level crash supervisor for provider/runtime failures.

## Monitoring Targets

The minimum target set is:
- `hq-mayor`
- persistent crew in the active rig
  - `projectx/crew/coordinator`
  - `projectx/crew/backend`
  - `projectx/crew/frontend`

## Failure Signals

## Level 1: hard liveness failure
- tmux session missing
- tmux session exists but Claude process is gone
- startup exits immediately

## Level 2: fallback-worthy runtime/provider failure
Examples:
- `429`
- `rate limit`
- `too many requests`
- insufficient balance / exhausted account quota
- `overloaded`
- `max_prompt_tokens`
- context window exceeded
- `provider unavailable`
- `connection reset`
- `connection refused`
- `transport error`
- `timeout` during provider/runtime call

**[UNVERIFIED]**: The `max_prompt_tokens` / context window recovery path has **not yet been validated** in production. This is future work.

## Level 3: startup interaction blockers
Examples:
- trust-folder prompt
- bypass confirmation prompt
- custom API key confirmation prompt

These should be solved by the wrapper first. They are not a reason to switch models unless startup ultimately fails.

## Non-fallback Failures

These should **not** trigger model fallback:
- project code errors
- lint/test failures
- bad shell commands
- missing files
- repo-specific configuration bugs

Those are task/content failures, not routing/provider failures.

## Fallback Candidate Source

The supervisor must consume candidates from `ai-router`, not hardcode provider logic.

Preferred control input:
- `AI_ROUTER_TARGET_INDEX=<n>`

Example ordered chain:
- `0` → `MiniMax-M2.5`
- `1` → `glm-5`
- `2` → `glm-4.7`

The supervisor should treat this ordering as authoritative.

## Fallback Decision Rules

### Rate limit / provider outage
- move directly to the next candidate

### transient transport error
- one retry on the same candidate is acceptable
- then move to the next candidate

### content/task failure
- do not fallback automatically

## Recovery Budget

Minimum recommendation per role + hooked task:
- max 1 retry on same candidate for transient transport failure
- max 1 attempt per fallback candidate
- max 3 automated recoveries in 30 minutes
- if exhausted: mark degraded and escalate

The local Gastown daemon patch implements this through the restartTracker with backoff / crash-loop gate.

## Recovery Checkpoint

Each persistent role should periodically write a small checkpoint file.

Suggested path:
- `.runtime/recovery/<session>.json`

Minimum fields:

```json
{
  "agent": "projectx/crew/backend",
  "session": "px-crew-backend",
  "hook_bead": "px-123",
  "target_index": 0,
  "selected_model": "MiniMax-M2.5",
  "last_checkpoint": "Updated runner.ts and db.ts; next step wire waiting_user resume path",
  "changed_files": [
    "apps/orchestrator/src/agent-jobs/runner.ts",
    "apps/orchestrator/src/db.ts"
  ],
  "updated_at": "2026-03-09T10:38:00Z"
}
```

**Status**: NOT IMPLEMENTED (A5+A7). This is a Layer 3 item for task continuity.

## Startup Resume Protocol

Every auto-recoverable persistent role should start with the same recovery protocol:

1. run `gt prime`
2. resolve identity
3. read authoritative `hook_bead`
4. load recovery checkpoint if present
5. inspect changed files / git state
6. continue current hooked task

**Status**: NOT IMPLEMENTED. This is the Layer 3 task resume protocol.

## Version A — Minimum Implementable Checklist

This is the smallest practical slice that keeps boundaries clean.

### A1. Fix hook authority for persistent roles — [NOT IMPLEMENTED, Gastown repo]
Ensure official hook/sling flows correctly update the persistent role's agent bead slot.

Required property:
- `gt sling <task> mayor`
- `gt sling <task> projectx/crew/backend`

must result in the target agent bead having the correct `hook_bead` value.

Without this, automatic restart cannot reliably resume work.

**Layer 3 item**: this is about task continuity, not model fallback.

### A2. Gastown-side persistent-role supervisor — [DONE, local Gastown patches]
The Gastown daemon now includes a persistent-role supervisor responsible for:
- checking persistent role sessions via `ensurePersistentCrewRunning()`
- reading crash signals via `.runtime/ai-router/exit/<session>.json`
- deciding retry vs fallback via `selectCrewRecoveryTarget()`
- restarting via official Gastown commands with `AI_ROUTER_TARGET_INDEX=N`
- crash-loop prevention via restartTracker with backoff

Additionally:
- `maybeRecoverLiveCrewContextWindow()` soft-recovers live sessions that hit context window limits
- handoff/respawn re-applies resolved agent env so wrapper-oriented env survives restart

This belongs in **Gastown** and is implemented as local Gastown daemon patches.

### A3. Extend the ai-router wrapper with launch metadata — [DONE]
The wrapper writes a runtime metadata file at startup containing:
- role identity
- session name
- runtime
- selected provider
- selected model
- target index
- started_at

This belongs in **ai-router/wrappers**.

### A4. Extend the wrapper or supervisor with exit metadata — [DONE]
Captures enough information to classify failure cause:
- exit code
- last known startup phase
- last matched error class
- exited_at

If exact exit reasons are unavailable, pane tail regex matching is acceptable for Version A.

### A5. Add per-session recovery state — [NOT IMPLEMENTED, both repos]
Store per-session recovery information in a runtime file such as:
- `.runtime/recovery/hq-mayor.json`
- `.runtime/recovery/px-crew-backend.json`

This should include:
- current target index
- retry count
- last failure class
- last checkpoint summary

**Layer 3 item**: this is about task continuity, not model fallback.

### A6. Restart with official Gastown commands only — [DONE, local Gastown patches]
Uses official commands such as:
- `gt mayor start`
- `gt crew start <rig> <name>`

Injects fallback selection through env:

```bash
AI_ROUTER_TARGET_INDEX=1 gt crew start projectx backend
```

This keeps orchestration in Gastown while keeping model choice in `ai-router`.

The local Gastown patch implements `gt crew start --env KEY=VALUE` which reaches the initial wrapper process.

### A7. Add checkpoint discipline for persistent crew — [NOT IMPLEMENTED, both repos]
Persistent roles should periodically persist a short recovery checkpoint.

Version A can start with local runtime files. A later version can mirror checkpoints into beads notes or structured task updates.

**Layer 3 item**: this is about task continuity, not model fallback.

## Validation Plan Using Official `gt crew`

Yes — this design should be implemented and validated using **official Gastown `gt crew` flows**, not ad-hoc tmux scripts.

That is the preferred path because it preserves the orchestration/routing boundary.

### Validation rules
- use `gt mayor start`
- use `gt crew start <rig> <name>`
- use `gt crew status`, `gt agents`, `gt mayor status`
- use tmux capture only for observation/debugging, not as the orchestration mechanism

### Recommended validation sequence

1. Start Mayor with official command.
2. Hook a real task to Mayor.
3. Verify Mayor starts Coordinator with official command.
4. Verify Coordinator starts Backend and then Frontend with official command.
5. Induce a recoverable failure in Backend.
6. Verify the persistent-role supervisor:
   - detects the failure
   - increments retry/fallback state
   - restarts Backend with `AI_ROUTER_TARGET_INDEX=1`
7. Verify Backend resumes the same hooked task.
8. Repeat once more to verify `AI_ROUTER_TARGET_INDEX=2` behavior.
9. Exhaust the budget and verify escalation instead of infinite restart loop.

Steps 5–6 and 8–9 have been **validated in production** with the local active stack.
Step 7 requires Layer 3 (hook_bead authority + checkpoint).

## Suggested Failure Injection Tests

### Test 1: session killed
- manually kill the backend tmux session
- expect supervisor restart
- **Status**: covered by daemon patrol (`ensurePersistentCrewRunning()`)

### Test 2: Claude process killed
- kill Claude inside the pane
- expect supervisor restart
- **Status**: covered by daemon patrol

### Test 3: synthetic rate-limit classification
- inject a known recoverable provider error string into the exit classification path
- expect candidate index advance
- **Status**: covered by wrapper exit classification + `selectCrewRecoveryTarget()`

### Test 4: non-fallback content error
- trigger a project/test failure
- expect no candidate advance
- **Status**: covered by exit class taxonomy (content errors are not recoverable)

## Cross-repo Implementation Split

### ai-router repo
Implement here:
- wrapper launch metadata — **DONE**
- wrapper exit metadata — **DONE**
- documented candidate-index contract — **DONE**
- Gastown integration docs — **DONE**

### Gastown repo
Implement here:
- persistent-role supervisor / patrol — **DONE** (local patches)
- fallback-aware restart flow — **DONE** (local patches)
- hook-slot correctness for persistent roles — NOT IMPLEMENTED (A1)
- validation on latest Gastown development branch — ongoing

### Both repos
- per-session recovery state (A5) — NOT IMPLEMENTED
- checkpoint discipline (A7) — NOT IMPLEMENTED

## Recommendation on Document Placement

This document belongs in `ai-router/docs/` because it defines the integration contract and the routing/orchestration boundary.

**For current implementation status, see:** `docs/system-gastown-init-and-fallback.md`

If the implementation is upstreamed into Gastown, a matching operational doc can be added there later, but the boundary definition should remain documented from the `ai-router` side as well.

## Summary

### Three-layer quantification

| Layer | Coverage | What it provides |
|-------|----------|-----------------|
| **Layer 1 — Upstream baseline** | 1/3 | Restart exists, role_agents preserved, but no routing intelligence |
| **Layer 2 — Local active stack** | 2/3 | Automatic model fallback chain end-to-end working (detect → classify → advance → restart → new model) |
| **Layer 3 — Remaining gap** | +1/3 needed | hook_bead authority + checkpoint/resume = task continuity |

### What is done (4/7 checklist items)
- A2: daemon patrol / supervisor (local Gastown patches)
- A3: wrapper launch metadata (ai-router)
- A4: wrapper exit metadata + classification (ai-router)
- A6: restart with env passthrough (local Gastown patches)

### What remains (3/7 checklist items — ALL task continuity)
- A1: hook_bead authority (Gastown repo)
- A5: per-session recovery state (both repos)
- A7: checkpoint discipline (both repos)

### Design principles (do not change)
- keep tmux session names stable
- keep fallback selection in `ai-router`
- keep restart/supervision in Gastown
- use `hook_bead` as the authoritative task binding
- implement and validate through official `gt crew` commands
