#!/bin/bash
# Stress Test: Fallback Chain Injection
# Tests fallback index injection and validation

set -e

RESULTS_FILE="/home/aaron/ai-projects/ai-router/tests/stress-test-inject.md"
CLI="/home/aaron/ai-projects/ai-router/src/cli.js"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=== Fallback Chain Injection Test ==="
echo ""

# Test resolving with different target indices
echo "Testing route resolution with different roles and runtime..."
echo ""

# Initialize results
cat > "$RESULTS_FILE" << 'EOF'
# Fallback Chain Injection Test Results

**Date**: $(date +%Y-%m-%d)
**Test**: ai-router fallback chain index injection

## Test 1: Route Resolution by Index

Testing that CLI can resolve routes for different runtime/role combinations:

| Runtime | Role | Primary Model | Fallback Count | Fallback List |
|---------|------|---------------|----------------|---------------|
EOF

# Test cases
test_cases=(
  "gastown:crew/test"
  "ai_router:crew/router_core"
  "coworker:crew/worker1"
  "gastown:mayor"
  "gastown:deacon"
)

for test_case in "${test_cases[@]}"; do
  IFS=':' read -r runtime role <<< "$test_case"
  
  echo -n "Testing $runtime / $role ... "
  
  result=$(node "$CLI" resolve --runtime "$runtime" --role "$role" 2>&1)
  
  if [ $? -eq 0 ]; then
    primary=$(echo "$result" | grep -o '"model": "[^"]*"' | head -1 | cut -d'"' -f4)
    fallback_count=$(echo "$result" | grep -o '"fallbacks": \[[^]]*\]' | wc -w)
    fallbacks=$(echo "$result" | grep -o '"fallbacks": \[[^]]*\]' | sed 's/"fallbacks": //')
    
    echo "| $runtime | $role | $primary | $fallback_count | $fallbacks |" >> "$RESULTS_FILE"
    echo "${GREEN}OK${NC} -> $primary"
  else
    echo "${RED}FAILED${NC}"
    echo "| $runtime | $role | ERROR | - | $result |" >> "$RESULTS_FILE"
  fi
done

echo ""
echo "Results written to: $RESULTS_FILE"

# Test 2: Exit metadata simulation
echo ""
echo "=== Test 2: Exit Metadata Simulation ==="
echo ""

# Create temp directory for metadata
tmp_dir=$(mktemp -d)
echo "Using temp directory: $tmp_dir"

# Simulate exit files for different indices
exit_scenarios=(
  "0:context_window_recoverable"
  "1:rate_limit"
  "2:provider_recoverable"
  "3:transport_recoverable"
)

cat >> "$RESULTS_FILE" << 'EOF'

## Test 2: Exit Metadata Simulation

Simulating exit files for different fallback indices:

| Index | Exit Class | Expected Next Index | Status |
|-------|------------|---------------------|--------|
EOF

for scenario in "${exit_scenarios[@]}"; do
  IFS=':' read -r target_index exit_class <<< "$scenario"
  
  session_name="sim-test-$target_index"
  
  # Create exit metadata
  mkdir -p "$tmp_dir/exit"
  cat > "$tmp_dir/exit/${session_name}.json" << JSON
{
  "target_index": $target_index,
  "exit_class": "$exit_class",
  "timestamp": "$(date -Iseconds)"
}
JSON
  
  # Expected next index (for recoverable types)
  if [ "$exit_class" = "context_window_recoverable" ] || [ "$exit_class" = "rate_limit" ] || [ "$exit_class" = "provider_recoverable" ] || [ "$exit_class" = "transport_recoverable" ]; then
    expected_next=$((target_index + 1))
  else
    expected_next=$target_index
  fi
  
  echo "| $target_index | $exit_class | $expected_next | ${GREEN}CREATED${NC} |" >> "$RESULTS_FILE"
  echo "Created exit file for index $target_index ($exit_class)"
done

# Verify metadata can be read back
echo ""
echo "Verifying metadata read-back..."

cat >> "$RESULTS_FILE" << 'EOF'

### Metadata Verification

EOF

for scenario in "${exit_scenarios[@]}"; do
  IFS=':' read -r target_index exit_class <<< "$scenario"
  session_name="sim-test-$target_index"
  
  if [ -f "$tmp_dir/exit/${session_name}.json" ]; then
    content=$(cat "$tmp_dir/exit/${session_name}.json")
    echo "| ${session_name}.json | ${GREEN}READABLE${NC} | $content |" >> "$RESULTS_FILE"
    echo "Verified: ${session_name}.json"
  else
    echo "| ${session_name}.json | ${RED}MISSING${NC} | - |" >> "$RESULTS_FILE"
  fi
done

# Cleanup
rm -rf "$tmp_dir"

echo ""
echo "=== Test Complete ==="
echo "Results: $RESULTS_FILE"
