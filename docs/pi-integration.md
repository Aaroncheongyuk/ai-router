# Pi Adapter Integration Guide

## Overview

The Pi Adapter enables Gastown crews to use **Pi Code Agent** (`pi`) instead of Claude Code as the underlying AI agent. It wraps the `pi` binary with ai-router's routing layer, providing:

- Automatic route resolution based on GT_ROLE
- Fallback chain support (MiniMax-M2.5 → glm-5 → glm-4.7)
- Environment variable injection for API configuration
- Launch/exit metadata for recovery

## Architecture

```
User Command + GT_AGENT=pi
  ↓
Gastown Framework (reads agent config)
  ↓
wrappers/pi  ← ai-router wrapper
  ↓
ai-router resolve (gets route config)
  ↓
Environment Variables (ANTHROPIC_*)
  ↓
pi binary (underlying agent)
```

## Prerequisites

1. **ai-router installed**: The wrapper expects ai-router at `../` relative to the wrapper script
2. **pi binary available**: `pi` from `@mariozechner/pi-coding-agent` npm package
3. **Gastown configured**: For integrated usage

## Installation

### 1. Install pi binary

```bash
npm install -g @mariozechner/pi-coding-agent
```

Verify:
```bash
pi --help
```

### 2. Configure Gastown (optional)

Edit `~/gastown-town/settings/config.json`:

```json
{
  "type": "town-settings",
  "version": 1,
  "default_agent": "claude",
  "agents": {
    "pi": {
      "command": "/path/to/ai-router/wrappers/pi"
    }
  }
}
```

## Usage

### Method 1: Environment Variable (recommended)

```bash
# Use pi for a specific convoy
GT_AGENT=pi gastown convoy create my-task

# Or set globally
export GT_AGENT=pi
gastown convoy create my-task
```

### Method 2: Configure Default Agent

Edit `~/gastown-town/settings/config.json`:

```json
{
  "default_agent": "pi"
}
```

## Verification

### Basic Test

```bash
# Test wrapper can resolve routes
GT_ROLE="ai_router/crew/test" /path/to/ai-router/wrappers/pi --help
```

Expected output should show:
```
[ai-router] gtRole=ai_router/crew/test normalizedRole=crew/test runtime=ai_router selectedModel=MiniMax-M2.5 provider=ep38
```

### Routing Verification

```bash
# Test different role mappings
GT_ROLE="gastown/crew/worker" ./wrappers/pi --help
# Expected: runtime=gastown, role=crew

GT_ROLE="ai_router/crew/router_core" ./wrappers/pi --help
# Expected: runtime=ai_router, role=crew/router_core
```

### Fallback Test

```bash
# Create exit metadata with rate_limit
echo '{"target_index": 0, "exit_class": "rate_limit"}' > .runtime/ai-router/exit/test-session.json

# Run wrapper - should auto-increment to glm-5
GT_SESSION=test-session GT_ROLE="ai_router/crew/test" ./wrappers/pi --print "test"
```

## Environment Variables

The wrapper exports these variables for pi:

| Variable | Description | Example |
|----------|-------------|---------|
| `ANTHROPIC_MODEL` | Selected model | `MiniMax-M2.5` |
| `ANTHROPIC_BASE_URL` | API endpoint | `http://38.146.29.81:8000` |
| `ANTHROPIC_API_KEY` | API key | (from .env) |
| `AI_ROUTER_SELECTED_MODEL` | Resolved model | `MiniMax-M2.5` |
| `AI_ROUTER_SELECTED_PROVIDER` | Provider name | `ep38` |
| `AI_ROUTER_SELECTED_TARGET_INDEX` | Fallback index | `0` |

### Override Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `AI_ROUTER_TARGET_MODEL` | Force specific model | `glm-5` |
| `AI_ROUTER_TARGET_INDEX` | Set fallback index | `1` |
| `AI_ROUTER_DEBUG` | Enable debug output | `1` |

## Debugging

### Enable Debug Mode

```bash
AI_ROUTER_DEBUG=1 GT_ROLE="ai_router/crew/test" ./wrappers/pi --help
```

Output shows:
- `gtRole`: Raw GT_ROLE value
- `normalizedRole`: Parsed role
- `runtime`: Resolved runtime
- `selectedModel`: Final model selection
- `provider`: Provider name

### Check Metadata

```bash
# View launch metadata
cat .runtime/ai-router/launch/<session>.json

# View exit metadata
cat .runtime/ai-router/exit/<session>.json
```

## Troubleshooting

### "pi not found"

Ensure `pi` is in PATH:
```bash
export PATH="$HOME/.npm-global/bin:$PATH"
# Or set explicitly:
UNDERLYING_PI_BIN=/full/path/to/pi ./wrappers/pi --help
```

### "Required dependency 'node' not found"

The wrapper requires Node.js. Ensure it's installed:
```bash
node --version
```

### Route not found

Check routing configuration:
```bash
node src/cli.js resolve --runtime gastown --role crew
```

### Fallback not working

Verify exit metadata exists:
```bash
ls -la .runtime/ai-router/exit/
```

## Testing

Run the test suite:

```bash
node --test tests/pi-wrapper.test.js
```

Tests cover:
- GT_ROLE parsing (ai_router vs gastown)
- Route resolution
- Fallback advancement
- Manual override
- Environment variable export
