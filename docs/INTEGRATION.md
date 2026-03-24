# ai-router Integration Contract

> This document defines the rules for integrating ai-router into any project.
> Violations will cause silent fallback failures — models won't recover on provider errors.

## Architecture

```
Your Project (orchestration)
    │
    ▼
┌─────────────────┐
│  wrapper/claude-38│  ← ONLY supported integration point
│  wrapper/pi       │
└────────┬────────┘
         │ calls internally
         ▼
┌─────────────────┐
│  resolve CLI     │  ← INTERNAL, do not call directly
└────────┬────────┘
         │ reads
         ▼
┌─────────────────┐
│  configs/*.json  │  ← routing, models, providers, fallbacks
└─────────────────┘
```

## Integration Modes

### Mode 1: Wrapper (recommended, auto-fallback)

The wrapper handles everything: resolve, env export, fallback advancement, metadata.

```bash
# Gastown preset points to wrapper
wrappers/claude-38
```

The wrapper automatically:
1. Normalizes `GT_ROLE` → `(runtime, role)` for ai-router
2. Calls `resolve` internally
3. Exports `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, `ANTHROPIC_API_KEY`
4. Writes launch metadata to `.runtime/ai-router/launch/`
5. On exit, writes exit metadata with `exit_class`
6. If exit is recoverable, advances `AI_ROUTER_TARGET_INDEX` for next run

### Mode 2: Index Pin (explicit fallback position)

```bash
export AI_ROUTER_TARGET_INDEX=2   # use 3rd candidate (0-indexed)
wrappers/claude-38
```

Useful for: manual recovery after a known provider outage.

### Mode 3: Model Pin (disable fallback)

```bash
export AI_ROUTER_TARGET_MODEL=MiniMax-M2.5   # exact match, no fallback
wrappers/claude-38
```

Useful for: testing a specific model, debugging provider issues.

---

## MUST DO

| # | Rule | Why |
|---|------|-----|
| 1 | **Use a wrapper**, not `resolve` CLI directly | Wrapper implements fallback advancement, metadata, and exit handling. Calling resolve yourself means you must reimplement all of this correctly. |
| 2 | **Let the wrapper handle env export** | Wrapper sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, `ANTHROPIC_API_KEY` from resolve output. Don't override these manually. |
| 3 | **Write exit metadata** with correct `exit_class` | The exit class (`rate_limit`, `provider_recoverable`, `transport_recoverable`, `context_window_recoverable`, `runtime_error`, `success`) determines whether the next run advances the fallback index. |
| 4 | **Use `AI_ROUTER_TARGET_INDEX`** to advance fallback | Don't pick models manually. The wrapper reads this env var and selects the correct candidate from the resolved chain. |
| 5 | **Check `.runtime/ai-router/` for route decisions** | Don't parse tmux output or wrapper logs. Metadata JSON files are the source of truth. |
| 6 | **Register new runtimes in `configs/routing.json`** | Don't hardcode model names in your project. Define a route, let resolve return the chain. |

## MUST NOT DO

| # | Anti-pattern | What happens |
|---|-------------|--------------|
| 1 | **Hardcode model names** (`export ANTHROPIC_MODEL=glm-5`) | Fallback chain is bypassed. Provider outage = total failure. |
| 2 | **Hardcode provider URLs** (`export ANTHROPIC_BASE_URL=https://...`) | Provider migration breaks your project. |
| 3 | **Call `resolve` CLI directly and only use `.model`** | You get the primary model but ignore `resolvedFallbacks`. No recovery on failure. |
| 4 | **Implement your own retry/fallback logic** | Duplicates wrapper logic, will diverge over time. Use `AI_ROUTER_TARGET_INDEX` instead. |
| 5 | **Mix ai-router resolution with manual model selection** | Conflicting env vars cause unpredictable behavior. |
| 6 | **Skip exit metadata** | Wrapper can't auto-advance fallback index without knowing why the previous run exited. |
| 7 | **Read `configs/*.json` directly** from your project | Config schema may change. Use `resolve` output (via wrapper) as the stable contract. |

---

## Common Mistakes

### Mistake 1: Only using the primary model

```bash
# ❌ WRONG: ignores fallback chain
model=$(node src/cli.js resolve --runtime gastown --role crew | jq -r '.model')
export ANTHROPIC_MODEL=$model
claude ...
# → glm-5 goes down → your agent dies

# ✅ RIGHT: use wrapper, fallback is automatic
wrappers/claude-38
# → glm-5 goes down → wrapper advances to glm-4.7 → agent continues
```

### Mistake 2: Hardcoding models in scripts

```bash
# ❌ WRONG: hardcoded model
export ANTHROPIC_MODEL=glm-5
export ANTHROPIC_BASE_URL=https://api.apitoken.ai
claude ...

# ✅ RIGHT: let ai-router decide
# Define route in configs/routing.json, use wrapper
```

### Mistake 3: Building custom retry logic

```bash
# ❌ WRONG: homebrew fallback
for model in glm-5 glm-4.7 MiniMax-M2.5; do
  export ANTHROPIC_MODEL=$model
  claude ... && break
done

# ✅ RIGHT: wrapper handles retry via TARGET_INDEX
# On recoverable exit, wrapper bumps index automatically
```

### Mistake 4: Parsing resolve output partially

```javascript
// ❌ WRONG: only reads primary model
const result = JSON.parse(execSync('node src/cli.js resolve --runtime gastown --role crew'));
const model = result.model;  // ignores result.resolvedFallbacks

// ✅ RIGHT: use wrapper, or if you must call resolve, use the FULL output
// result.resolvedFallbacks[n] contains provider, auth, wireModel for each candidate
```

---

## Decision Tree

```
Do you need to integrate ai-router?
│
├── YES: Does a wrapper exist for your runtime?
│   │
│   ├── YES (claude-38, pi) → Use the wrapper directly (Mode 1)
│   │   │
│   │   ├── Need a specific model? → Set AI_ROUTER_TARGET_MODEL (Mode 3)
│   │   └── Need a specific fallback position? → Set AI_ROUTER_TARGET_INDEX (Mode 2)
│   │
│   └── NO → Write a new wrapper based on wrappers/claude-38 as template
│       │
│       └── MUST implement: resolve call, env export, metadata write, exit classification
│
└── NO → Don't touch configs/*.json. Your project doesn't need ai-router.
```

---

## Writing a New Wrapper

If you need a new runtime wrapper, copy `wrappers/claude-38` and modify these sections:

1. **Role normalization**: Map your framework's role names to `(runtime, role)` pairs
2. **CLI exec path**: Change the final `exec` command to your runtime's CLI
3. **Env var names**: If your runtime uses different env var names (e.g., not `ANTHROPIC_*`)

Everything else (resolve call, fallback selection, metadata, exit handling) stays the same.

---

## Validation Checklist

Before shipping an integration, verify:

- [ ] Uses a wrapper (not direct `resolve` calls)
- [ ] Route exists in `configs/routing.json` for your `(runtime, role)`
- [ ] `modelChain` has >= 3 candidates
- [ ] All models in chain exist in `configs/models.json`
- [ ] All providers in chain exist in `configs/providers.json`
- [ ] Required env vars are available (e.g., `EP38_API_KEY`)
- [ ] Exit metadata writes to `.runtime/ai-router/exit/`
- [ ] Recoverable exits advance `AI_ROUTER_TARGET_INDEX`
- [ ] No hardcoded model names in your scripts
- [ ] No hardcoded provider URLs in your scripts

Run `node src/cli.js validate --runtime <X> --role <Y>` to check programmatically.

---

## Exit Classes Reference

| Exit Class | Recoverable | Wrapper Action |
|-----------|-------------|----------------|
| `success` | N/A | No action, agent completed successfully |
| `rate_limit` | Yes | Advance `TARGET_INDEX` to next candidate |
| `provider_recoverable` | Yes | Advance `TARGET_INDEX` to next candidate |
| `transport_recoverable` | Yes | Advance `TARGET_INDEX` to next candidate |
| `context_window_recoverable` | Yes | Advance `TARGET_INDEX` to next candidate |
| `runtime_error` | No | Do not advance, log error for investigation |

---

## Resolve Output Contract (reference only)

The wrapper calls `resolve` internally and gets this structure. You should NOT call this directly,
but understanding the output helps debug issues:

```json
{
  "runtime": "gastown",
  "role": "crew",
  "provider": "ep38",
  "protocol": "anthropic-messages",
  "baseUrl": "https://api.apitoken.ai",
  "model": "glm-5",
  "wireModel": "glm-5",
  "fallbacks": ["glm-4.7", "MiniMax-M2.5", "kimi-k2.5", "glm-4"],
  "resolvedFallbacks": [
    {
      "provider": "ep38",
      "protocol": "anthropic-messages",
      "baseUrl": "https://api.apitoken.ai",
      "model": "glm-4.7",
      "wireModel": "glm-4.7",
      "auth": { "type": "env", "env": "EP38_API_KEY" },
      "runtimeEnv": [...]
    }
  ],
  "auth": { "type": "env", "env": "EP38_API_KEY" },
  "runtimeEnv": [...],
  "source": {
    "route": "configs/routing.json#routes.gastown.crew",
    "model": "configs/models.json#models.glm-5",
    "provider": "configs/providers.json#providers.ep38",
    "fallbacks": "configs/fallbacks.json#fallbacks.glm-5"
  }
}
```
