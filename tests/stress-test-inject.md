# Fallback Chain Injection Test Results

**Date**: 2026-03-15
**Test**: ai-router fallback chain index injection

## Test 1: Route Resolution by Index

Testing that CLI can resolve routes for different runtime/role combinations:

| Runtime | Role | Primary Model | Fallback Count | Fallback List |
|---------|------|---------------|----------------|---------------|
| gastown | crew/test | MiniMax-M2.5 | 2 | glm-5, glm-4.7 |
| ai_router | crew/router_core | MiniMax-M2.5 | 2 | glm-5, glm-4.7 |
| coworker | crew/worker1 | MiniMax-M2.5 | 2 | glm-5, glm-4.7 |
| gastown | mayor | MiniMax-M2.5 | 2 | glm-5, glm-4.7 |
| gastown | deacon | MiniMax-M2.5 | 2 | glm-5, glm-4.7 |

## Test 2: Exit Metadata Simulation

Simulating exit files for different fallback indices:

| Index | Exit Class | Expected Next Index | Status |
|-------|------------|---------------------|--------|
| 0 | context_window_recoverable | 1 | CREATED |
| 1 | rate_limit | 2 | CREATED |
| 2 | provider_recoverable | 3 | CREATED |
| 3 | transport_recoverable | 4 | CREATED |

### Metadata Verification

All exit files were created and readable:

| File | Status | Content |
|------|--------|---------|
| sim-test-0.json | READABLE | target_index: 0, exit_class: context_window_recoverable |
| sim-test-1.json | READABLE | target_index: 1, exit_class: rate_limit |
| sim-test-2.json | READABLE | target_index: 2, exit_class: provider_recoverable |
| sim-test-3.json | READABLE | target_index: 3, exit_class: transport_recoverable |

## Summary

- **Route Resolution**: All 5 runtime/role combinations resolved correctly
- **Fallback Chain**: MiniMax-M2.5 -> glm-5 -> glm-4.7 (2 fallbacks per route)
- **Metadata**: Exit file creation and read-back working correctly
- **Status**: PASS