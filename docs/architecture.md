# Architecture

## Purpose

`ai-router` is a shared routing/control layer for LLM-backed development workflows.

It centralizes:
- provider profiles
- model selection
- runtime compatibility choices
- auth/header resolution
- fallback policy

It does **not** centralize orchestration.

## Boundary model

### 1. Orchestration layer
Examples:
- Gastown
- pi-overstory
- overstory
- future schedulers

Responsibilities:
- task decomposition
- agent lifecycle
- worktree/branch management
- supervision and queueing

### 2. Routing layer (`ai-router`)
Responsibilities:
- role -> model/profile resolution
- runtime -> provider/protocol resolution
- provider/auth/header resolution
- fallback/degrade policy

### 3. Runtime adapter layer
Examples:
- Gastown-facing wrapper
- pi adapter
- Claude wrapper

Responsibilities:
- translate routing output into concrete runtime flags/env/config
- isolate runtime-specific compatibility logic

## Initial design principle

Shared config and policy should be reusable across runtimes.
Shared protocol should **not** be assumed.
Different runtimes may consume the same route decision through different adapters.

## Planned repo shape

```text
ai-router/
├── configs/
├── core/
├── adapters/
├── wrappers/
├── docs/
└── tests/
```

P0 does not need all of these implemented, but the architecture should leave room for them.

## P0 architecture choice

For P0:
- Gastown is the orchestration layer
- Claude-style runtime wrapper can be the execution bridge
- `ai-router` remains the route/config source of truth

This is a proving ground, not the final runtime matrix.
