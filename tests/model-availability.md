# Model Availability Test Results

**Date**: 2026-03-15
**Test**: ai-router fallback chain model availability

## Test Method

Each model is tested using `pi --print --provider <provider> --model <model> 'respond OK'`
with a 30-second timeout.

## Results

| # | Provider | Model | Status | Notes |
|---|----------|-------|--------|-------|
| 1 | ep38-kimi | MiniMax-M2.5 | OK | Working |
| 2 | ep38 | gpt-5.4 | OK | Working |
| 3 | ep38 | gpt-5 | OK | Working |
| 4 | ep38-glm | glm-5 | OK | Working |
| 5 | ep38-kimi | Kimi-K2.5 | TIMEOUT | No response within 30s |
| 6 | ep38-glm | glm-4.7 | OK | Working |
| 7 | ep38-claude | claude-sonnet-4-6 | UNKNOWN | Unexpected event order |
| 8 | ep38 | deepseek-ai/DeepSeek-R1 | TIMEOUT | No response within 30s |
| 9 | ep38 | deepseek-ai/DeepSeek-V3.2 | TIMEOUT | No response within 30s |
| 10 | ep38 | gpt-4o-mini | OK | Working |
| 11 | ep38-glm | glm-4.7-flash | OK | Working |

## Summary

- **Working**: 8/11 (MiniMax-M2.5, gpt-5.4, gpt-5, glm-5, glm-4.7, gpt-4o-mini, glm-4.7-flash)
- **Timeout**: 3/11 (Kimi-K2.5, DeepSeek-R1, DeepSeek-V3.2)
- **Unknown**: 1/11 (claude-sonnet-4-6 - provider issue)

## Fallback Chain Validation

Based on the current routing config (MiniMax-M2.5 -> glm-5 -> glm-4.7):

| Index | Model | Provider | Status |
|-------|-------|----------|--------|
| 0 | MiniMax-M2.5 | ep38-kimi | OK |
| 1 | glm-5 | ep38-glm | OK |
| 2 | glm-4.7 | ep38-glm | OK |

All three primary fallback chain models are available.
