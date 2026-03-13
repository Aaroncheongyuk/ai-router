# Resolve Contract

## Purpose

`resolve` is the first stable contract in `ai-router`.
It answers the question:

> For a given runtime + role, which provider/model/env wiring should be used?

## Example CLI

```bash
pnpm resolve -- --runtime gastown --role polecat
```

## Input

Required:
- `runtime`
- `role`

Optional later:
- `taskType`
- `profile`
- `modelHint`
- `providerHint`

## Output shape

```json
{
  "runtime": "gastown",
  "role": "polecat",
  "provider": "ep38",
  "protocol": "anthropic-messages",
  "baseUrl": "http://38.146.29.81:8000",
  "model": "glm-5",
  "wireModel": "glm-5",
  "fallbacks": ["MiniMax-M2.5", "glm-4.7"],
  "resolvedFallbacks": [
    {
      "provider": "ep38",
      "protocol": "anthropic-messages",
      "baseUrl": "http://38.146.29.81:8000",
      "model": "MiniMax-M2.5",
      "wireModel": "MiniMax-M2.5",
      "auth": {
        "type": "env",
        "env": "EP38_API_KEY"
      },
      "headers": {},
      "runtimeEnv": [
        { "name": "ANTHROPIC_BASE_URL", "source": { "type": "literal", "value": "http://38.146.29.81:8000" } },
        { "name": "ANTHROPIC_MODEL", "source": { "type": "literal", "value": "MiniMax-M2.5" } },
        { "name": "ANTHROPIC_API_KEY", "source": { "type": "env", "env": "EP38_API_KEY" } }
      ],
      "source": {
        "model": "configs/models.yaml#models.MiniMax-M2.5",
        "provider": "configs/providers.yaml#providers.ep38",
        "fallbacks": "configs/fallbacks.yaml#fallbacks.MiniMax-M2.5"
      }
    }
  ],
  "auth": {
    "type": "env",
    "env": "EP38_API_KEY"
  },
  "headers": {},
  "runtimeEnv": [
    { "name": "ANTHROPIC_BASE_URL", "source": { "type": "literal", "value": "http://38.146.29.81:8000" } },
    { "name": "ANTHROPIC_MODEL", "source": { "type": "literal", "value": "glm-5" } },
    { "name": "ANTHROPIC_API_KEY", "source": { "type": "env", "env": "EP38_API_KEY" } }
  ],
  "compat": {
    "strategy": "anthropic-compatible",
    "notes": ["Wrapper should inject env instead of hard-coding provider logic in Gastown."]
  },
  "source": {
    "route": "configs/routing.yaml#routes.gastown.polecat",
    "model": "configs/models.yaml#models.glm-5",
    "provider": "configs/providers.yaml#providers.ep38",
    "fallbacks": "configs/fallbacks.yaml#fallbacks.glm-5"
  }
}
```

## Contract principles

- Output must be runtime-consumable.
- Secrets should be referenced by source (`env`) rather than inlined.
- Runtime-specific workarounds should be represented as structured hints, not buried in config prose.
- This contract must remain reusable outside Gastown.
- `ai-router` resolves routes; it does not become the infra/provider itself.

## Manual fallback selection

`resolve` itself does not implement retry policy or restart logic.

The wrapper can still select a fallback candidate explicitly for smoke tests:

```bash
AI_ROUTER_TARGET_MODEL=MiniMax-M2.5 bash wrappers/claude-38
```

Normalized selectors such as `minimax-m2.5` are also accepted by the wrapper.

Or by candidate index:

```bash
AI_ROUTER_TARGET_INDEX=1 bash wrappers/claude-38
```

Current implementation note:
- the wrapper may automatically advance `AI_ROUTER_TARGET_INDEX` after a
  recoverable previous exit
- this is wrapper-side candidate selection only, not full Gastown supervision

See `docs/system-gastown-init-and-fallback.md` for the current boundary and
runtime behavior.
