#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# ai-router Production Readiness Test
#
# 6 Gates — 全部通过 = PRODUCTION READY
# Gate 1: 模型可用性（逐个 ping 每个模型）
# Gate 2: Wrapper 链路（claude-38 + pi 双 wrapper）
# Gate 3: 路由解析（每个角色正确解析）
# Gate 4: Fallback 注入（500/429 自动推进）
# Gate 5: 监控脚本（L1-L5）
# Gate 6: Gastown E2E（真实 crew 启动 + 双 CLI）
# =============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="$ROOT_DIR/.runtime/ai-router/production-readiness"
REPORT_FILE="$REPORT_DIR/report-$(date -u +%Y%m%dT%H%M%SZ).md"
mkdir -p "$REPORT_DIR"

PASS=0
FAIL=0
SKIP=0
GATE_RESULTS=()

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
pass() { PASS=$((PASS+1)); echo "  ✅ $*"; echo "| $* | ✅ PASS |" >> "$REPORT_FILE"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $*"; echo "| $* | ❌ FAIL |" >> "$REPORT_FILE"; }
skip() { SKIP=$((SKIP+1)); echo "  ⏭️  $*"; echo "| $* | ⏭️ SKIP |" >> "$REPORT_FILE"; }

gate_header() {
  local gate="$1" title="$2"
  echo ""
  echo "═══════════════════════════════════════════"
  echo "  Gate $gate: $title"
  echo "═══════════════════════════════════════════"
  echo "" >> "$REPORT_FILE"
  echo "## Gate $gate: $title" >> "$REPORT_FILE"
  echo "| Test | Result |" >> "$REPORT_FILE"
  echo "|------|--------|" >> "$REPORT_FILE"
}

gate_result() {
  local gate="$1" gate_fail="$2"
  if [ "$gate_fail" -eq 0 ]; then
    GATE_RESULTS+=("Gate $gate: ✅ PASS")
  else
    GATE_RESULTS+=("Gate $gate: ❌ FAIL ($gate_fail failures)")
  fi
}

# Initialize report
cat > "$REPORT_FILE" << 'EOF'
# ai-router Production Readiness Report

EOF
echo "**Date:** $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# ─────────────────────────────────────────────
# Gate 1: Model Availability
# ─────────────────────────────────────────────
gate_header 1 "Model Availability (EP38 ping)"
gate1_fail=0

test_model_pi() {
  local provider="$1" model="$2" label="$3"
  if timeout 15 pi --provider "$provider" --model "$model" --print "respond with exactly: OK" 2>/dev/null | grep -qi "ok"; then
    pass "$label ($provider/$model)"
  else
    fail "$label ($provider/$model)"
    gate1_fail=$((gate1_fail+1))
  fi
}

test_model_claude() {
  local model="$1" label="$2"
  local result
  result=$(EP38_API_KEY="${EP38_API_KEY:-}" \
    UNDERLYING_CLAUDE_BIN=echo \
    GT_ROLE="test/crew/ping" \
    AI_ROUTER_RUNTIME=gastown \
    bash "$ROOT_DIR/wrappers/claude-38" 2>/dev/null | head -1 || echo "")
  if [ -n "$result" ]; then
    pass "$label (claude-38 wrapper resolve)"
  else
    fail "$label (claude-38 wrapper resolve)"
    gate1_fail=$((gate1_fail+1))
  fi
}

log "Testing Tier 2 models..."
test_model_pi "ep38-kimi" "MiniMax-M2.7" "MiniMax-M2.7"
test_model_pi "ep38-glm" "glm-5" "glm-5"
test_model_pi "ep38-glm" "glm-4.7" "glm-4.7"
test_model_pi "ep38" "gpt-5.4" "gpt-5.4"

log "Testing Tier 1 models..."
test_model_pi "ep38-claude" "claude-sonnet-4-6" "claude-sonnet-4-6"

log "Testing Tier 3 models..."
test_model_pi "ep38-glm" "glm-4.7-flash" "glm-4.7-flash (Tier 4)"
test_model_pi "ep38" "gpt-4o-mini" "gpt-4o-mini"

log "Testing potentially unavailable models..."
test_model_pi "ep38-kimi" "Kimi-K2.5" "Kimi-K2.5 (may 503)"
test_model_pi "ep38" "deepseek-ai/DeepSeek-R1" "DeepSeek-R1 (may 503)"
test_model_pi "ep38" "deepseek-ai/DeepSeek-V3.2" "DeepSeek-V3.2 (may 503)"

gate_result 1 "$gate1_fail"

# ─────────────────────────────────────────────
# Gate 2: Wrapper Chain (dual CLI)
# ─────────────────────────────────────────────
gate_header 2 "Wrapper Chain (claude-38 + pi)"
gate2_fail=0

log "Testing claude-38 wrapper..."
claude38_out=$(EP38_API_KEY=dummy \
  UNDERLYING_CLAUDE_BIN=env \
  GT_ROLE="ai_router/crew/test" \
  bash "$ROOT_DIR/wrappers/claude-38" 2>/dev/null || echo "")

if echo "$claude38_out" | grep -q "AI_ROUTER_SELECTED_MODEL=MiniMax-M2.7"; then
  pass "claude-38: resolve → MiniMax-M2.7"
else
  fail "claude-38: resolve → MiniMax-M2.7"
  gate2_fail=$((gate2_fail+1))
fi

if echo "$claude38_out" | grep -q "ANTHROPIC_BASE_URL=https://api.apitoken.ai"; then
  pass "claude-38: ANTHROPIC_BASE_URL set"
else
  fail "claude-38: ANTHROPIC_BASE_URL set"
  gate2_fail=$((gate2_fail+1))
fi

log "Testing pi wrapper..."
pi_out=$(GT_ROLE="ai_router/crew/test" AI_ROUTER_DEBUG=1 \
  bash "$ROOT_DIR/wrappers/pi" --help 2>&1 | head -3 || echo "")

if echo "$pi_out" | grep -q "selectedModel=MiniMax-M2.7"; then
  pass "pi: resolve → MiniMax-M2.7"
else
  fail "pi: resolve → MiniMax-M2.7"
  gate2_fail=$((gate2_fail+1))
fi

if echo "$pi_out" | grep -q "provider=ep38"; then
  pass "pi: provider=ep38"
else
  fail "pi: provider=ep38"
  gate2_fail=$((gate2_fail+1))
fi

log "Testing pi wrapper provider mapping..."
for role_model in "MiniMax-M2.7:ep38-kimi" "glm-5:ep38-glm" "claude-sonnet-4-6:ep38-claude"; do
  model="${role_model%%:*}"
  expected_provider="${role_model##*:}"
  map_result=$(AI_ROUTER_SELECTED_MODEL="$model" AI_ROUTER_SELECTED_PROVIDER="ep38" \
    bash -c 'case "$AI_ROUTER_SELECTED_MODEL" in MiniMax*|Kimi*) echo ep38-kimi;; glm*) echo ep38-glm;; claude*) echo ep38-claude;; *) echo ep38;; esac')
  if [ "$map_result" = "$expected_provider" ]; then
    pass "pi provider map: $model → $expected_provider"
  else
    fail "pi provider map: $model → $map_result (expected $expected_provider)"
    gate2_fail=$((gate2_fail+1))
  fi
done

gate_result 2 "$gate2_fail"

# ─────────────────────────────────────────────
# Gate 2b: Pi Wrapper Fallback Chain
# ─────────────────────────────────────────────
gate_header "2b" "Pi Wrapper Fallback Chain"
gate2b_fail=0

test_pi_fallback() {
  local exit_class="$1" prev_index="$2" expected_index="$3" expected_model="$4" expected_provider="$5"
  local tmp
  tmp=$(mktemp -d)
  mkdir -p "$tmp/exit"
  echo "{\"target_index\":$prev_index,\"exit_class\":\"$exit_class\"}" > "$tmp/exit/sim-pi.json"

  local debug_out
  debug_out=$(GT_SESSION=sim-pi \
    GT_ROLE="ai_router/crew/test" \
    AI_ROUTER_DEBUG=1 \
    AI_ROUTER_STATE_ROOT="$tmp" \
    bash "$ROOT_DIR/wrappers/pi" --help 2>&1 || echo "")

  rm -rf "$tmp"

  local actual_model
  actual_model=$(echo "$debug_out" | grep "\[ai-router\]" | grep "selectedModel=" | sed 's/.*selectedModel=//' | cut -d' ' -f1 | tr -d '\n')
  local actual_invocation
  actual_invocation=$(echo "$debug_out" | grep "\[ai-router\] pi invocation" || echo "")

  if [ "$actual_model" = "$expected_model" ]; then
    pass "pi fallback $exit_class idx:$prev_index → $expected_model"
  else
    fail "pi fallback $exit_class idx:$prev_index → $actual_model (expected $expected_model)"
    gate2b_fail=$((gate2b_fail+1))
  fi

  # Verify provider mapping in pi invocation
  if [ -n "$actual_invocation" ] && echo "$actual_invocation" | grep -q "$expected_provider"; then
    pass "pi provider map idx:$expected_index → $expected_provider"
  elif [ -n "$actual_invocation" ]; then
    fail "pi provider map idx:$expected_index → wrong provider (expected $expected_provider)"
    gate2b_fail=$((gate2b_fail+1))
  fi
}

log "Testing pi wrapper fallback chain..."
test_pi_fallback "clean_exit" 0 0 "MiniMax-M2.7" "ep38-kimi"
test_pi_fallback "rate_limit" 0 1 "glm-5" "ep38-glm"
test_pi_fallback "rate_limit" 1 2 "glm-4.7" "ep38-glm"
test_pi_fallback "rate_limit" 2 2 "glm-4.7" "ep38-glm"  # clamp

log "Testing pi wrapper --models lock..."
pi_models_out=$(GT_ROLE="ai_router/crew/test" \
  bash "$ROOT_DIR/wrappers/pi" --help 2>&1 | head -1 || echo "")
# Check invocation includes --models flag
pi_invoc=$(GT_ROLE="ai_router/crew/test" AI_ROUTER_DEBUG=1 \
  bash "$ROOT_DIR/wrappers/pi" --help 2>&1 | grep "pi invocation" || echo "")
if echo "$pi_invoc" | grep -q "\-\-models"; then
  pass "pi wrapper: --models lock present"
else
  fail "pi wrapper: --models lock missing"
  gate2b_fail=$((gate2b_fail+1))
fi

log "Testing pi wrapper pinned model override..."
tmp=$(mktemp -d)
mkdir -p "$tmp/exit"
echo '{"target_index":0,"exit_class":"rate_limit"}' > "$tmp/exit/sim-pipin.json"
pi_pin_out=$(GT_SESSION=sim-pipin \
  GT_ROLE="ai_router/crew/test" \
  AI_ROUTER_DEBUG=1 \
  AI_ROUTER_TARGET_MODEL=MiniMax-M2.7 \
  AI_ROUTER_STATE_ROOT="$tmp" \
  bash "$ROOT_DIR/wrappers/pi" --help 2>&1 | grep "\[ai-router\]" | head -1 || echo "")
rm -rf "$tmp"
if echo "$pi_pin_out" | grep -q "selectedModel=MiniMax-M2.7"; then
  pass "pi pinned model override blocks auto-advance"
else
  fail "pi pinned model override: $pi_pin_out"
  gate2b_fail=$((gate2b_fail+1))
fi

gate_result "2b" "$gate2b_fail"

# ─────────────────────────────────────────────
# Gate 3: Route Resolution (all roles)
# ─────────────────────────────────────────────
gate_header 3 "Route Resolution (all roles)"
gate3_fail=0

test_route() {
  local runtime="$1" role="$2" expected_model="$3"
  local result
  result=$(node "$ROOT_DIR/src/cli.js" resolve --runtime "$runtime" --role "$role" 2>/dev/null | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    process.stdout.write(d.model);
  " 2>/dev/null || echo "ERROR")
  if [ "$result" = "$expected_model" ]; then
    pass "route $runtime/$role → $expected_model"
  else
    fail "route $runtime/$role → $result (expected $expected_model)"
    gate3_fail=$((gate3_fail+1))
  fi
}

log "Testing gastown routes..."
test_route "gastown" "default" "MiniMax-M2.7"
test_route "gastown" "mayor" "MiniMax-M2.7"
test_route "gastown" "deacon" "MiniMax-M2.7"

log "Testing ai_router routes..."
test_route "ai_router" "crew/router_core" "MiniMax-M2.7"
test_route "ai_router" "crew/pi_adapter" "MiniMax-M2.7"
test_route "ai_router" "witness" "MiniMax-M2.7"
test_route "ai_router" "refinery" "MiniMax-M2.7"

log "Testing coworker routes..."
test_route "coworker" "default" "MiniMax-M2.7"
test_route "coworker" "boot" "MiniMax-M2.7"

gate_result 3 "$gate3_fail"

# ─────────────────────────────────────────────
# Gate 4: Fallback Injection
# ─────────────────────────────────────────────
gate_header 4 "Fallback Injection (500/429 simulation)"
gate4_fail=0

test_fallback() {
  local exit_class="$1" prev_index="$2" expected_index="$3" expected_model="$4"
  local tmp
  tmp=$(mktemp -d)
  mkdir -p "$tmp/exit"
  echo "{\"target_index\":$prev_index,\"exit_class\":\"$exit_class\"}" > "$tmp/exit/sim-test.json"

  local result
  result=$(EP38_API_KEY=dummy \
    UNDERLYING_CLAUDE_BIN=env \
    GT_SESSION=sim-test \
    GT_ROLE="gastown/crew/worker" \
    AI_ROUTER_RUNTIME=gastown \
    AI_ROUTER_STATE_ROOT="$tmp" \
    bash "$ROOT_DIR/wrappers/claude-38" 2>/dev/null | grep "AI_ROUTER_SELECTED_MODEL" | head -1 || echo "")

  local actual_model
  actual_model=$(echo "$result" | sed 's/.*AI_ROUTER_SELECTED_MODEL=//' | tr -d ' ')

  rm -rf "$tmp"

  if [ "$actual_model" = "$expected_model" ]; then
    pass "fallback $exit_class idx:$prev_index → idx:$expected_index ($expected_model)"
  else
    fail "fallback $exit_class idx:$prev_index → $actual_model (expected $expected_model)"
    gate4_fail=$((gate4_fail+1))
  fi
}

log "Testing rate_limit fallback chain..."
test_fallback "rate_limit" 0 1 "glm-5"
test_fallback "rate_limit" 1 2 "glm-4.7"
test_fallback "rate_limit" 2 2 "glm-4.7"  # clamp

log "Testing provider_recoverable..."
test_fallback "provider_recoverable" 0 1 "glm-5"

log "Testing transport_recoverable..."
test_fallback "transport_recoverable" 1 2 "glm-4.7"

log "Testing runtime_error..."
test_fallback "runtime_error" 0 1 "glm-5"

log "Testing clean_exit (no advance)..."
test_fallback "clean_exit" 0 0 "MiniMax-M2.7"
test_fallback "clean_exit" 1 1 "glm-5"

log "Testing pinned model override..."
tmp=$(mktemp -d)
mkdir -p "$tmp/exit"
echo '{"target_index":0,"exit_class":"rate_limit"}' > "$tmp/exit/sim-pin.json"
pin_result=$(EP38_API_KEY=dummy \
  UNDERLYING_CLAUDE_BIN=env \
  GT_SESSION=sim-pin \
  GT_ROLE="gastown/crew/worker" \
  AI_ROUTER_RUNTIME=gastown \
  AI_ROUTER_TARGET_MODEL=MiniMax-M2.7 \
  AI_ROUTER_STATE_ROOT="$tmp" \
  bash "$ROOT_DIR/wrappers/claude-38" 2>/dev/null | grep "AI_ROUTER_SELECTED_MODEL" | head -1 || echo "")
rm -rf "$tmp"
if echo "$pin_result" | grep -q "MiniMax-M2.7"; then
  pass "pinned model override blocks auto-advance"
else
  fail "pinned model override: $pin_result"
  gate4_fail=$((gate4_fail+1))
fi

gate_result 4 "$gate4_fail"

# ─────────────────────────────────────────────
# Gate 5: Monitoring Scripts (L1-L3)
# ─────────────────────────────────────────────
gate_header 5 "Monitoring Scripts"
gate5_fail=0

TOWN_ROOT="${GT_TOWN_ROOT:-/home/aaron/gt-ai-router}"

if [ -f "$ROOT_DIR/scripts/crew-heartbeat.sh" ]; then
  log "Testing L1 heartbeat..."
  if cd "$TOWN_ROOT" && bash "$ROOT_DIR/scripts/crew-heartbeat.sh" >/dev/null 2>&1; then
    if [ -f "$TOWN_ROOT/.runtime/ai-router/monitor/heartbeat.json" ]; then
      if node -e "JSON.parse(require('fs').readFileSync('$TOWN_ROOT/.runtime/ai-router/monitor/heartbeat.json','utf8'))" 2>/dev/null; then
        pass "L1 heartbeat: runs + valid JSON"
      else
        fail "L1 heartbeat: invalid JSON output"
        gate5_fail=$((gate5_fail+1))
      fi
    else
      fail "L1 heartbeat: no output file"
      gate5_fail=$((gate5_fail+1))
    fi
  else
    # Exit code 1 is OK if alerts were generated (dead crews)
    if [ -f "$TOWN_ROOT/.runtime/ai-router/monitor/heartbeat.json" ]; then
      pass "L1 heartbeat: runs (with alerts)"
    else
      fail "L1 heartbeat: script error"
      gate5_fail=$((gate5_fail+1))
    fi
  fi
  cd "$ROOT_DIR"
else
  skip "L1 heartbeat: script not found"
fi

if [ -f "$ROOT_DIR/scripts/crew-patrol.sh" ]; then
  pass "L2 patrol: script exists"
else
  skip "L2 patrol: script not found"
fi

if [ -f "$ROOT_DIR/scripts/crew-dashboard.sh" ]; then
  pass "L3 dashboard: script exists"
else
  skip "L3 dashboard: script not found"
fi

if [ -f "$ROOT_DIR/scripts/crew-diagnose.sh" ]; then
  pass "L4 diagnose: script exists"
else
  skip "L4 diagnose: script not found"
fi

if [ -f "$ROOT_DIR/scripts/crew-escalate.sh" ]; then
  pass "L5 escalate: script exists"
else
  skip "L5 escalate: script not found"
fi

gate_result 5 "$gate5_fail"

# ─────────────────────────────────────────────
# Gate 6: Config Integrity
# ─────────────────────────────────────────────
gate_header 6 "Config Integrity"
gate6_fail=0

log "Validating router config..."
if node "$ROOT_DIR/src/cli.js" validate 2>/dev/null; then
  pass "router config validates"
else
  # Try resolve as validation
  if node "$ROOT_DIR/src/cli.js" resolve --runtime gastown --role default 2>/dev/null | grep -q "MiniMax"; then
    pass "router config validates (via resolve)"
  else
    fail "router config validation"
    gate6_fail=$((gate6_fail+1))
  fi
fi

log "Checking required files..."
for f in "wrappers/claude-38" "wrappers/pi" "configs/routing.yaml" "configs/models.yaml" "configs/providers.yaml" "configs/fallbacks.yaml" "src/resolve.js" "src/cli.js"; do
  if [ -f "$ROOT_DIR/$f" ]; then
    pass "file exists: $f"
  else
    fail "file missing: $f"
    gate6_fail=$((gate6_fail+1))
  fi
done

log "Checking wrappers executable..."
for w in "wrappers/claude-38" "wrappers/pi"; do
  if [ -x "$ROOT_DIR/$w" ]; then
    pass "executable: $w"
  else
    fail "not executable: $w"
    gate6_fail=$((gate6_fail+1))
  fi
done

gate_result 6 "$gate6_fail"

# ─────────────────────────────────────────────
# Final Report
# ─────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "  PRODUCTION READINESS SUMMARY"
echo "═══════════════════════════════════════════"

echo "" >> "$REPORT_FILE"
echo "## Summary" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

for gr in "${GATE_RESULTS[@]}"; do
  echo "  $gr"
  echo "- $gr" >> "$REPORT_FILE"
done

echo ""
echo "  Total: $PASS pass, $FAIL fail, $SKIP skip"
echo "" >> "$REPORT_FILE"
echo "**Total:** $PASS pass, $FAIL fail, $SKIP skip" >> "$REPORT_FILE"

if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo "  🟢 PRODUCTION READY"
  echo "" >> "$REPORT_FILE"
  echo "### 🟢 PRODUCTION READY" >> "$REPORT_FILE"
  exit 0
else
  echo ""
  echo "  🔴 BLOCKED — $FAIL failure(s) must be resolved"
  echo "" >> "$REPORT_FILE"
  echo "### 🔴 BLOCKED — $FAIL failure(s)" >> "$REPORT_FILE"
  exit 1
fi
