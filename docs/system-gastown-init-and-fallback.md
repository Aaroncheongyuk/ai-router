# System Notes — Gastown Init And Fallback

## Status

This document is the **canonical source of truth** for the `ai-router` + Gastown integration.

For new-project validation, see: `docs/gastown-init-stress-checklist.md`

## Why this doc exists

This document captures the **actual running system shape** for the current
`ai-router` + Gastown integration.

It exists to prevent the same class of integration bugs from recurring:
- confusing Gastown rig identity with `ai-router` runtime identity
- losing role detail while normalizing `GT_ROLE`
- assuming fallback supervision already lives inside `ai-router`

## Current system boundary

Gastown owns:
- agent preset registration
- process launch
- hook installation and `gt prime`
- lifecycle, restart, supervision, and task durability

`ai-router` owns:
- runtime + role -> route resolution
- provider/model/auth/env contract
- ordered fallback candidate list

The wrapper owns:
- mapping Gastown env into `ai-router` inputs
- selecting the active route candidate
- exporting runtime env for Claude
- writing launch/exit metadata
- handling Claude startup prompts

## ASCII flows

These diagrams describe the **current implemented shape**, not an aspirational
future design.

### 1. System boundary

```text
┌──────────────────────────────────────────────────────────────────────┐
│                              Gastown                                 │
│                                                                      │
│  owns: town/rig/session lifecycle, tmux, hook durability, restart    │
│                                                                      │
│   human / daemon                                                     │
│        │                                                             │
│        ▼                                                             │
│   gt crew|witness|deacon|mayor start                                 │
│        │                                                             │
│        ▼                                                             │
│   settings/agents.json -> selected agent preset: claude-38           │
└────────┬─────────────────────────────────────────────────────────────┘
         │ launches
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         wrappers/claude-38                           │
│                                                                      │
│  owns: Gastown env normalization, candidate selection, metadata      │
│                                                                      │
│   GT_ROLE / GT_RIG / GT_SESSION / AI_ROUTER_*                        │
│        │                                                             │
│        ▼                                                             │
│   normalize runtime + role                                           │
│        │                                                             │
│        ▼                                                             │
│   node src/cli.js resolve --runtime ... --role ...                   │
└────────┬─────────────────────────────────────────────────────────────┘
         │ asks for route
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                            ai-router                                  │
│                                                                      │
│  owns: runtime+role routing, provider/model/env contract,            │
│        ordered fallback chain                                        │
│                                                                      │
│   configs/routing.json + models/providers/fallbacks                  │
│        │                                                             │
│        ▼                                                             │
│   return primary candidate + ordered fallbacks                       │
└────────┬─────────────────────────────────────────────────────────────┘
         │ returns decision
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         wrappers/claude-38                           │
│                                                                      │
│  export ANTHROPIC_* / provider env                                   │
│  write .runtime/ai-router/launch|exit metadata                       │
│  exec underlying Claude CLI                                          │
└──────────────────────────────────────────────────────────────────────┘
```

### 2. Gastown native startup path

```text
gt install / gt up
    │
    ├─ create mayor/, daemon/, deacon/, settings/, rigs.json, town.json
    │
    ├─ initialize tmux socket scope
    │    ├─ shared town: reuse one socket
    │    └─ independent town: assign unique GT_TMUX_SOCKET
    │
    ├─ register agent preset
    │    └─ settings/agents.json -> claude-38
    │
    └─ later session start
         │
         ├─ gt crew start --rig <rig> <name>
         ├─ gt witness start <rig>
         ├─ gt daemon start
         └─ gt mayor / gt deacon / gt refinery
              │
              ▼
         Gastown injects role env
              │
              ├─ GT_ROLE
              ├─ GT_RIG
              ├─ GT_SESSION / GT_PANE_ID / GT_AGENT / GT_PROCESS_NAMES
              ├─ GT_TMUX_SOCKET
              └─ AI_ROUTER_TOWN_ROOT   (local integration patch)
```

### 3. ai-router resolve path from Gastown

```text
Gastown session starts
    │
    ▼
wrappers/claude-38
    │
    ├─ read env:
    │    GT_ROLE
    │    GT_RIG
    │    GT_SESSION
    │    AI_ROUTER_RUNTIME?          (explicit override wins)
    │    AI_ROUTER_TOWN_ROOT?        (authoritative metadata root)
    │
    ├─ normalize runtime
    │    mayor / deacon / boot          -> gastown
    │    <rig>/witness|refinery|crew    -> gastown
    │    ai_router/...                  -> ai_router
    │
    ├─ normalize role
    │    <rig>/crew/<name>              -> crew
    │    ai_router/crew/router_core     -> crew/router_core
    │    <rig>/witness                  -> witness
    │    <rig>/refinery                 -> refinery
    │    <rig>/polecats/<name>          -> polecat
    │
    ├─ call resolve
    │    node src/cli.js resolve --runtime X --role Y
    │
    ├─ ai-router returns
    │    primary candidate
    │    fallback candidates[]
    │    provider/auth/runtime env
    │
    ├─ wrapper selects candidate
    │    manual: AI_ROUTER_TARGET_MODEL
    │    manual: AI_ROUTER_TARGET_INDEX
    │    auto:   previous exit metadata -> advance index if recoverable
    │
    ├─ write launch metadata
    │    .runtime/ai-router/launch/<session>.json
    │
    └─ exec underlying Claude
         │
         └─ on exit -> classify -> write exit metadata
                         .runtime/ai-router/exit/<session>.json
```

### 4. Manual fallback flow

```text
run N starts
    │
    ├─ launch metadata
    │    target_index = 0
    │    selected_model = MiniMax-M2.5
    │
    ├─ runtime fails
    │
    └─ exit metadata
         exit_class = runtime_error

human runs:
    gt crew restart --rig ai_router fallback_smoke
    │
    ▼
wrapper reads previous exit metadata
    │
    ├─ previous target_index = 0
    ├─ previous exit_class = runtime_error
    └─ recoverable => advance to 1
            │
            ▼
new launch metadata
    target_index = 1
    selected_model = glm-5
```

### 5. Automatic fallback supervision flow

```text
persistent crew has hook/work in progress
    │
    ▼
Gastown daemon heartbeat
    │
    ├─ ensurePersistentCrewRunning()
    │
    ├─ scan rigs.json -> rig/crew/*
    │
    ├─ if session alive
    │    └─ maybeRecoverLiveCrewContextWindow()
    │         ├─ capture pane tail
    │         ├─ detect max_prompt_tokens / context-window signal
    │         └─ nudge: "continue current hooked task"
    │
    └─ if session dead but hook still exists
         │
         ├─ read launch metadata
         ├─ read exit metadata
         ├─ selectCrewRecoveryTarget()
         │    ├─ rate_limit / provider_recoverable
         │    ├─ transport_recoverable
         │    ├─ context_window_recoverable
         │    └─ runtime_error
         │          => advance to next candidate
         │
         ├─ restartTracker backoff / crash-loop gate
         │
         └─ gt crew start --rig <rig> <name>
              --env AI_ROUTER_TARGET_INDEX=<n>
              --env AI_ROUTER_RECOVERY_REASON=<reason>
                  │
                  ▼
              wrapper selects next candidate
                  │
                  ▼
              same crew identity resumes hooked task
```

### 6. Shared town vs independent town

```text
A. Shared town, multiple rigs

town root
  │
  ├─ one mayor
  ├─ one daemon
  ├─ one deacon
  ├─ one tmux socket
  ├─ one Dolt service
  ├─ global ai-router gastown.* route chain
  │
  ├─ rig A
  ├─ rig B
  └─ rig ai_router

Rule:
  new project as another rig => inherit shared Gastown + shared ai-router chain


B. Independent town

town A                          town B
  │                               │
  ├─ own mayor                    ├─ own mayor
  ├─ own daemon                   ├─ own daemon
  ├─ own deacon                   ├─ own deacon
  ├─ own GT_TMUX_SOCKET           ├─ own GT_TMUX_SOCKET
  └─ own .runtime/ai-router       └─ own .runtime/ai-router

Rule:
  if it is a real separate HQ, do not share tmux default
```

## Gastown native initialization baseline

Gastown's native startup model matters because the wrapper consumes its env.

What Gastown does upstream:
1. `gt install` creates the HQ skeleton, town identity files, and provider
   settings roots.
2. `settings/agents.json` registers custom agent presets at town or rig scope.
3. The chosen preset command is launched with Gastown role env already injected.
4. Hooks or fallback nudges run `gt prime` to load role context.

Relevant upstream facts:
- Gastown loads custom agent presets from `~/gt/settings/agents.json` or
  `~/gt/<rig>/settings/agents.json`.
- Gastown exports compound `GT_ROLE` values for rig-scoped agents.
- Crew and polecat identity is carried by both `GT_ROLE` and the more specific
  `GT_CREW` / `GT_POLECAT` env vars.
- independent towns must not share tmux `default`; assign a unique
  `GT_TMUX_SOCKET` per town if you run multiple HQs on one machine.

Examples of upstream env shape:
- mayor -> `GT_ROLE=mayor`
- deacon -> `GT_ROLE=deacon`
- witness -> `GT_ROLE=<rig>/witness`
- refinery -> `GT_ROLE=<rig>/refinery`
- polecat -> `GT_ROLE=<rig>/polecats/<name>`
- crew -> `GT_ROLE=<rig>/crew/<name>`

## ai-router initialization path

The current P0 flow is:
1. Gastown selects the custom `claude-38` preset.
2. The preset launches [wrappers/claude-38](../wrappers/claude-38).
3. The wrapper normalizes Gastown env into `ai-router` `runtime` + `role`.
4. The wrapper calls `node src/cli.js resolve --runtime ... --role ...`.
5. `resolve` returns the primary candidate plus ordered fallback candidates.
6. The wrapper selects one candidate and exports Anthropic-compatible env.
7. The wrapper starts the underlying Claude CLI.

Operational rule:
- if a project is only another rig under an existing town, it should inherit
  the global `ai-router` `gastown.*` route chain instead of redefining its own
  fallback chain
- if a project is a truly separate town, it needs its own tmux socket before
  you start town-level sessions such as `hq-mayor` or `hq-deacon`

## Runtime normalization rules

These rules are now the intended behavior:

- `AI_ROUTER_RUNTIME` wins if explicitly set.
- `mayor`, `deacon`, `boot`, and `deacon/boot` resolve to runtime `gastown`.
- `ai_router/...` resolves to runtime `ai_router`.
- Other Gastown rig roles still resolve to runtime `gastown`.

Important rule:
- `GT_RIG` is a **Gastown rig identifier**, not an `ai-router` runtime key.
- Do not map `GT_RIG` directly to the `resolve` runtime input.

This was the root cause of the routing bug for normal Gastown crews:
- real Gastown env like `GT_RIG=testrig` and `GT_ROLE=testrig/crew/worker1`
  was incorrectly treated as runtime `testrig`
- that fell through to `configs/routing.json#routes.default`
- instead of using the intended Gastown route family

## Role normalization rules

The wrapper must preserve only the role detail that the routing table actually
uses.

Current normalized role behavior:
- `mayor` -> `mayor`
- `deacon` -> `deacon`
- `deacon/boot` -> `boot`
- `<rig>/witness` -> `witness`
- `<rig>/refinery` -> `refinery`
- `<rig>/polecats/<name>` -> `polecat`
- `<rig>/crew/<name>` under runtime `gastown` -> `crew`
- `ai_router/crew/<name>` under runtime `ai_router` -> `crew/<name>`

Why this split exists:
- Gastown currently routes all generic crew sessions through one shared `crew`
  route.
- `ai_router` crew names such as `router_core` are part of the routing key, so
  that suffix must survive normalization.

Concrete example:
- `GT_ROLE=ai_router/crew/router_core` must resolve as:
  - runtime: `ai_router`
  - role: `crew/router_core`

If it is flattened to `crew`, route resolution degrades to the default route and
loses the dedicated `ai_router` crew policy.

## Resolve contract: what is implemented vs not

Implemented today:
- route lookup by `runtime` + `role`
- runtime inheritance via runtime-level `inherits`
- provider/model/auth/header/env resolution
- ordered fallback candidate list via `modelChain`
- resolved fallback objects for wrapper consumption

Not implemented in `resolve` today:
- retry policy
- restart/supervision

Important clarification:
- `resolve` only returns candidates
- it does not decide when to restart or when to escalate

When a route is inherited:
- output `runtime` stays on the queried runtime namespace
- `source.route` points to the concrete role definition that supplied the route
- `source.inheritedFrom` points to the child runtime's `inherits` edge

## Fallback behavior: current reality

Wrapper-side recovery is now intentionally broad:
- `context_window_recoverable` remains a useful diagnostic subtype
- but fallback advancement no longer depends on enumerating every upstream API or
  CLI error code
- after a candidate has been selected, any later non-zero runtime failure is now
  allowed to advance to the next fallback candidate

There are now two different fallback layers and they must not be confused.

### Layer 1: wrapper candidate selection

Implemented now in [wrappers/claude-38](../wrappers/claude-38):
- manual selection via `AI_ROUTER_TARGET_MODEL`
- manual selection via `AI_ROUTER_TARGET_INDEX`
- automatic candidate advance after certain recoverable exit classes

Recoverable exit classes currently recognized explicitly:
- `rate_limit`
- `provider_recoverable`
- `transport_recoverable`
- `context_window_recoverable`

Current wrapper behavior:
- if the previous run ended in one of the explicit recoverable classes, advance
  to the next candidate index
- if the previous run ended in a generic `runtime_error`, also advance to the
  next candidate index
- if the route only has one candidate, clamp back to index `0`
- only pre-selection startup failures remain non-recoverable by default

### Layer 2: Gastown restart and supervision

Latest upstream Gastown now provides several **compatibility primitives** that
make `ai-router` integration safer:
- handoff / restart preserves `role_agents` selection instead of silently
  falling back to the default agent
- tmux session env now carries `GT_AGENT` / `GT_PROCESS_NAMES` more reliably
  for liveness detection
- non-Claude role launches respect agent resolution instead of forcing Claude
  in some startup paths
- `gt crew start --rig` is available upstream for cleaner project automation

However, upstream Gastown still does **not** own `ai-router` fallback policy.
The following remain outside upstream Gastown and still need local
`ai-router`-aware integration work when you want full automatic recovery:
- wrapper must respect injected `AI_ROUTER_TOWN_ROOT` before self-discovery, so
  crew metadata lands in the authoritative town runtime path
- Gastown tmux operations must honor exported `GT_TMUX_SOCKET` so disposable or
  independent towns do not silently spill into tmux `default`
- persistent crew patrol loop that reads `.runtime/ai-router/launch|exit`
- automatic restart with `AI_ROUTER_TARGET_INDEX=<n>` based on ai-router
  recoverable metadata
- `max_prompt_tokens` soft recovery for live sessions before hard restart
- fallback budget / escalation policy tied to ai-router recovery state

Boundary rule:
- `ai-router` decides candidate selection and recoverable semantics
- Gastown executes session lifecycle, restart, handoff, and supervision

### Upstream compatibility baseline

Checked against `gastown` GitHub `origin/main` at commit:
- `67cffe50`

Relevant upstream compatibility commits:
- `1b0b7684` `Fix handoff restart to honor role_agents`
- `d2550922` `set GT_PROCESS_NAMES in tmux env for all session types`
- `45b3f191` `skip hardcoded Claude start_command for non-Claude agents`
- `77092bb2` `add --rig flag to gt crew start for consistency with stop`

These upstream changes are compatible with `ai-router` and should be treated as
the preferred baseline before applying any local `ai-router`-specific patches.

Operational note:
- do not keep carrying a heavily dirty long-lived `gastown` checkout forward
- sync against a clean upstream worktree first, then reapply only the minimal
  `ai-router` integration delta

### Local integration delta validated on 2026-03-13

The current local patchset additionally proves:
- `wrappers/claude-38` now keeps injected `AI_ROUTER_TOWN_ROOT` and only falls
  back to directory walking when neither `AI_ROUTER_TOWN_ROOT` nor
  `GT_TOWN_ROOT` is present
- when walking from `crew/` or `polecats/` paths, the wrapper now prefers the
  outermost town root instead of the first nested `mayor/town.json`
- Gastown tmux subprocesses now honor `GT_TMUX_SOCKET`, so `gt crew start|stop`
  can target a specific town socket from outside tmux
- latest Gastown also needs local crew env override wiring:
  `gt crew start|restart --env KEY=VALUE` must reach the initial wrapper
  process, not only future tmux panes
- crew startup injects `AI_ROUTER_TOWN_ROOT` so wrapper metadata lands under the
  authoritative town `.runtime/ai-router`
- daemon-side persistent crew recovery reads `.runtime/ai-router/launch|exit`,
  soft-recovers live `max_prompt_tokens`, and restarts the next candidate via
  `AI_ROUTER_TARGET_INDEX`
- daemon recovery now treats generic post-selection `runtime_error` as
  fallback-advance eligible, matching current wrapper semantics
- handoff / respawn re-applies resolved agent env, so wrapper-oriented env such
  as `AI_ROUTER_TARGET_INDEX` and transport env such as `ANTHROPIC_BASE_URL`
  survive restart on the same role
- Linux host builds can be kept user-space only by staging ICU under
  `~/.local/opt/icu72`; latest `gastown` Makefile can auto-detect that prefix
  during `make build`

Real validation performed against `co-worker` disposable crew
`coworker/pressure_test`:
- fail run on `GT_TMUX_SOCKET=co-worker` wrote launch/exit metadata under
  `/home/aaron/ai-projects/co-worker/.runtime/ai-router`
- launch metadata recorded `town_root=/home/aaron/ai-projects/co-worker`
- induced non-zero fake runtime exited as `runtime_error`
- next launch on the same crew auto-advanced from `MiniMax-M2.5` to `glm-5`
- the session existed on tmux socket `co-worker` and did not appear on tmux
  `default`

## Gastown crew fallback behavior

Current example:
- `configs/routing.json#routes.gastown.crew`
- model chain: `["MiniMax-M2.5", "glm-5", "glm-4.7"]`

Effect:
- generic Gastown crew now follows the central ai-router fallback chain
- wrapper auto-recovery can advance from index `0` to later candidates after a
  recoverable exit
- projects that still set `AI_ROUTER_TARGET_MODEL` remain effectively pinned
  until that per-project override is removed

## Real-project validation: `sora2_hk_sdwan_plan`

The real project validation surfaced two important operational facts.

### 1. Central ai-router config is authoritative for route shape

The real Gastown project at:
- `/home/aaron/ai-projects/sora2_hk_sdwan_plan/.gastown`

uses the wrapper preset from its own `settings/config.json`, but route
resolution still comes from the central `ai-router` repo unless
`AI_ROUTER_CONFIG_DIR` is explicitly overridden.

That means:
- changing `configs/routing.json#routes.gastown.crew` in `ai-router`
  immediately changes the candidate chain for real Gastown crew launches
- project-local Gastown config does not define its own routing table here

### 2. Project-local target-model pins can silently disable fallback

In the real project, the wrapper was initially wired through a pinned agent
config that set:
- `AI_ROUTER_TARGET_MODEL=MiniMax-M2.5`

Even after the central `gastown.crew` route was changed to three candidates,
that project-local env still forced selection back to the first model.

For real fallback validation, the project had to switch crew from the pinned
agent to the unpinned wrapper agent.

### Verified real-project result

After:
- changing the central `gastown.crew` model chain to three candidates
- switching the real project crew role to the unpinned wrapper agent
- marking the real project's prior exit as recoverable

the next real crew launch produced:
- `target_index: 1`
- `candidate_count: 3`
- `selected_model: glm-5`

in:
- `/home/aaron/ai-projects/sora2_hk_sdwan_plan/.gastown/.runtime/ai-router/launch/shs-crew-simulation_harness.json`

This confirms that real Gastown crew fallback now works against the central
`ai-router` chain once project-local pins are removed.

## Real-project validation: `co-worker`

Verified on 2026-03-11 for the `coworker/crew/backend` role.

### Validation facts

- **project**: `/home/aaron/ai-projects/co-worker`
- **rig**: `coworker`
- **crew role**: `coworker/crew/backend`
- **agent preset**: `airouter-worker` → `/home/aaron/ai-projects/ai-router/wrappers/claude-38`
- **validation result**: `no problem found`

### Config verification

- `AI_ROUTER_CONFIG_DIR`: **not overridden** — uses central ai-router config
- `AI_ROUTER_TARGET_MODEL`: **not pinned** — automatic fallback enabled
- `AI_ROUTER_TARGET_INDEX`: **not pinned**

### Dry-run resolution

```
runtime=gastown
role=crew
candidate_count=3
```

### Launch metadata path (CRITICAL)

For this validation, the metadata lived in:
- `/home/aaron/ai-projects/co-worker/coworker/crew/backend/.runtime/ai-router/launch/cw-crew-backend.json`
- `/home/aaron/ai-projects/co-worker/coworker/crew/backend/.runtime/ai-router/exit/cw-crew-backend.json`

**Critical debugging pitfall**: Do NOT look in the town-root path first. The workspace-local `.runtime/ai-router/` directory is where launch/exit metadata is written for each crew.

### Fallback advancement observed

Previous run (index 0): `MiniMax-M2.5`
Current run (index 1): `glm-5`

The wrapper correctly advanced from target_index 0 to target_index 1 after a recoverable exit.

### Important debugging note

**Critical pitfall**: metadata path confusion.

For this integration, tmux session env is not the best source of truth for
selected candidate state.

Use:
- `.runtime/ai-router/launch/*.json` (workspace-local, NOT town-root)
- `.runtime/ai-router/exit/*.json` (workspace-local, NOT town-root)

The metadata lives in each crew's workspace under `.runtime/ai-router/`, not in the Gastown town root. Inspecting the wrong path leads to false conclusions about wrapper behavior.

## Verified regression tests

The following cases are now covered by wrapper smoke tests:
- default wrapper launch exports Anthropic-compatible env
- recoverable exit advances to the next candidate
- real Gastown env `GT_RIG=<rig>` + `GT_ROLE=<rig>/crew/<name>` still maps to
  runtime `gastown` and generic role `crew`
- `GT_ROLE=ai_router/crew/router_core` preserves `crew/router_core`
- Gastown crew advances to index `1` after a recoverable failure
- explicit `AI_ROUTER_TARGET_MODEL` pins override auto-recovery candidate
  advance
- quoted API keys can be loaded from local `.env`

### Real-project validations

1. **sora2_hk_sdwan_plan**: generic crew, fallback from MiniMax-M2.5 → glm-5
2. **co-worker**: `coworker/crew/backend`, fallback from index 0 → index 1, validation result: `no problem found`

## Operational guidance

When debugging this integration, check these in order:
1. the raw Gastown env: `GT_ROLE`, `GT_RIG`, `GT_CREW`, `GT_POLECAT`
2. the wrapper-normalized values: `AI_ROUTER_RESOLVED_RUNTIME`,
   `AI_ROUTER_RESOLVED_ROLE`
3. the selected candidate:
   `AI_ROUTER_SELECTED_TARGET_INDEX`, `AI_ROUTER_SELECTED_MODEL`
4. the resolved route source returned by `src/cli.js resolve`
5. the wrapper exit metadata under `.runtime/ai-router/exit/`

If routing looks wrong, first suspect normalization, not provider config.

## Real-task continuation: Feishu native E2E follow-up

The same real `sora2_hk_sdwan_plan` crew was later continued after the user
manually completed Feishu QR login on `2026-03-11`.

Important live facts confirmed on device `192.168.80.143:5555`:
- package: `com.ss.android.lark`
- launcher activity: `.main.app.MainActivity`

This surfaced a separate runtime safety rule:
- a pre-logged-in native-app validation must not call `pm clear` on the target
  app
- otherwise the freshly established login session is destroyed before the test
  begins

For that reason, the real crew added a `preserveLogin` option to the local
`NativeExecutor` path in the crew workspace so the executor can skip cache/data
clearing for Feishu-driven runs.

Another important limitation was confirmed:
- the current login check in `src/executor/native-executor.js` reads
  `/sdcard/Sora/status.txt`
- that check is Sora-specific and is not a valid login signal for Feishu

So the real Feishu validation used:
- `preserveLogin: true`
- `skipLoginCheck: true`
- `skipWaitForRender: true`

What this proved:
- the native server can be configured to target a real logged-in Feishu app
  without wiping session state
- a real `POST /v1/videos` request can advance through the task state machine to
  completion under that configuration

What this did **not** prove:
- true Feishu-specific UI automation for prompt entry
- real generation submission semantics inside Feishu
- real render completion / artifact collection through the app UI

Practical interpretation:
- this is a valid integration proof for the API/task-state/control-path layer
- it is not yet a full proof of production-grade native Feishu execution

If the goal is full native Feishu automation, the next required work is
Feishu-specific UI control for:
- focusing the correct input
- entering the prompt reliably
- triggering the correct send/generate action
- detecting render completion
- collecting the real output artifact
