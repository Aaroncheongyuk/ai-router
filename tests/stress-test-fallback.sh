#!/bin/bash
# Stress Test: Model Availability Verification
# Tests each model in the fallback chain for availability

set -e

RESULTS_FILE="/home/aaron/ai-projects/ai-router/tests/model-availability.md"
CONFIG_DIR="/home/aaron/ai-projects/ai-router/configs"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test models from the fallback chain
MODELS=(
  "ep38-kimi:MiniMax-M2.7:MiniMax-M2.7"
  "ep38:gpt-5.4:gpt-5.4"
  "ep38:gpt-5:gpt-5"
  "ep38-glm:glm-5:glm-5"
  "ep38-kimi:Kimi-K2.5:Kimi-K2.5"
  "ep38-glm:glm-4.7:glm-4.7"
  "ep38-claude:claude-sonnet-4-6:claude-sonnet-4-6"
  "ep38:deepseek-ai/DeepSeek-R1:deepseek-ai/DeepSeek-R1"
  "ep38:deepseek-ai/DeepSeek-V3.2:deepseek-ai/DeepSeek-V3.2"
  "ep38:gpt-4o-mini:gpt-4o-mini"
  "ep38-glm:glm-4.7-flash:glm-4.7-flash"
)

# Initialize results file
cat > "$RESULTS_FILE" << 'EOF'
# Model Availability Test Results

**Date**: $(date +%Y-%m-%d)
**Test**: ai-router fallback chain model availability

## Test Method

Each model is tested using `pi --print --provider <provider> --model <model> 'respond OK'`
with a 30-second timeout.

## Results

| # | Provider | Model | Status | Response Time | Notes |
|---|----------|-------|--------|---------------|-------|
EOF

# Counter
index=1

echo "Starting model availability tests..."
echo ""

for model_entry in "${MODELS[@]}"; do
  IFS=':' read -r provider model wire_model <<< "$model_entry"
  
  echo -n "Testing: $provider / $model ... "
  
  start_time=$(date +%s.%N)
  
  # Run the test with timeout
  output=$(timeout 30 pi --provider "$provider" --model "$model" --print 'respond OK' 2>&1) || true
  end_time=$(date +%s.%N)
  response_time=$(echo "$end_time - $start_time" | bc 2>/dev/null || echo "N/A")
  
  # Determine status
  if echo "$output" | grep -qi "error\|fail\|cannot\|unable\|invalid"; then
    status="${RED}ERROR${NC}"
    notes=$(echo "$output" | head -2 | tr '\n' ' ')
  elif echo "$output" | grep -qi "OK\|hello\|response"; then
    status="${GREEN}OK${NC}"
    notes="Response received in ${response_time}s"
  elif [ -z "$output" ]; then
    status="${YELLOW}TIMEOUT${NC}"
    notes="No response within 30s"
  else
    status="${YELLOW}UNKNOWN${NC}"
    notes=$(echo "$output" | head -1 | cut -c1-50)
  fi
  
  # Add to markdown table
  echo "| $index | $provider | $model | $status | ${response_time}s | $notes |" >> "$RESULTS_FILE"
  
  echo "done (${status}${NC})"
  ((index++))
  
  # Small delay between tests
  sleep 1
done

echo ""
echo "Results written to: $RESULTS_FILE"

# Summary
echo ""
echo "=== Summary ==="
grep -c "OK" "$RESULTS_FILE" || echo "0 OK"
grep -c "ERROR" "$RESULTS_FILE" || echo "0 ERROR"
grep -c "TIMEOUT" "$RESULTS_FILE" || echo "0 TIMEOUT"
