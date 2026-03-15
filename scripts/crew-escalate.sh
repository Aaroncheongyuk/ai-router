#!/bin/bash
# L5: Escalation Handler
# Uses MiniMax-M2.5 (highest quality) for critical decisions
# Frequency: Only when L4 recommends escalation or critical alerts
# Outputs: Escalation report and triggers external notifications

set -euo pipefail

MONITOR_DIR=".runtime/ai-router/monitor"
ALERTS_DIR="$MONITOR_DIR/alerts"
DIAGNOSIS_DIR="$MONITOR_DIR/diagnosis"
ESCALATION_LOG="$MONITOR_DIR/escalations.log"

CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
CURRENT_TIME_HUMAN=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

# Ensure directories exist
mkdir -p "$ALERTS_DIR" "$DIAGNOSIS_DIR" "$MONITOR_DIR"

# Function to log escalation
log_escalation() {
    local crew="$1"
    local severity="$2"
    local reason="$3"
    local details="$4"

    echo "[${CURRENT_TIME}] [${severity}] ${crew}: ${reason}" >> "$ESCALATION_LOG"
    echo "Details: $details" >> "$ESCALATION_LOG"
    echo "---" >> "$ESCALATION_LOG"
}

# Function to escalate to human
escalate_to_human() {
    local crew="$1"
    local severity="$2"
    local diagnosis_file="$3"

    echo "=== ESCALATING ${crew} (${severity}) ==="

    # Read diagnosis
    local diagnosis=""
    local root_cause=""
    local action=""
    local commands=()

    if [ -f "$diagnosis_file" ] && command -v jq &> /dev/null; then
        diagnosis=$(jq -r '.diagnosis // "No diagnosis"' "$diagnosis_file")
        root_cause=$(jq -r '.root_cause // "Unknown"' "$diagnosis_file")
        action=$(jq -r '.action // "unknown"' "$diagnosis_file")

        # Get commands as array
        mapfile -t commands < <(jq -r '.commands[]? // empty' "$diagnosis_file")
    fi

    # Generate escalation report using LLM
    local escalation_report=""
    if command -v claude &> /dev/null; then
        escalation_report=$(ANTHROPIC_MODEL=MiniMax-M2.5 \
                          ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL:-"http://38.146.29.81:8000"} \
                          claude --print 2>/dev/null << EOF
Generate a human-readable escalation report in Markdown format.

Crew: ${crew}
Severity: ${severity}
Diagnosis: ${diagnosis}
Root Cause: ${root_cause}
Recommended Action: ${action}
Commands to execute: ${commands[*]}

Include:
1. Summary of the issue
2. Why this requires human attention
3. Suggested next steps
4. Commands that should be run (if any)

Keep it concise but informative.
EOF
                          )
    else
        escalation_report="# Escalation Report
**Crew:** ${crew}
**Severity:** ${severity}
**Time:** ${CURRENT_TIME_HUMAN}

## Issue
${diagnosis}

## Root Cause
${root_cause}

## Recommended Action
${action}

## Commands
$(printf '%s\n' "${commands[@]}")
"
    fi

    # Save escalation report
    local escalation_file="$MONITOR_DIR/escalation-${crew}-$(date +%Y%m%d-%H%M%S).md"
    echo "$escalation_report" > "$escalation_file"

    # Log escalation
    log_escalation "$crew" "$severity" "$diagnosis" "$escalation_report"

    # Print escalation report
    echo ""
    echo "=== ESCALATION REPORT ==="
    echo "$escalation_report"
    echo ""
    echo "Full report saved to: $escalation_file"

    # Optional: Send notification (commented out - customize as needed)
    # send_notification "$escalation_report"

    return 0
}

# Function to check if escalation is needed
should_escalate() {
    local crew="$1"
    local diagnosis_file="$2"

    if [ ! -f "$diagnosis_file" ]; then
        return 1
    fi

    if ! command -v jq &> /dev/null; then
        # Without jq, escalate all diagnosed issues
        return 0
    fi

    local escalate
    local severity
    local auto_recoverable

    escalate=$(jq -r '.escalate // false' "$diagnosis_file")
    severity=$(jq -r '.severity // "MEDIUM"' "$diagnosis_file")
    auto_recoverable=$(jq -r '.auto_recoverable // true' "$diagnosis_file")

    # Escalate if:
    # 1. Diagnosis explicitly says escalate: true
    # 2. Severity is CRITICAL or HIGH
    # 3. Not auto-recoverable

    if [ "$escalate" = "true" ]; then
        return 0
    fi

    if [ "$severity" = "CRITICAL" ] || [ "$severity" = "HIGH" ]; then
        return 0
    fi

    if [ "$auto_recoverable" = "false" ]; then
        return 0
    fi

    return 1
}

# Function to process critical alerts directly (without diagnosis)
escalate_critical_alert() {
    local alert_file="$1"

    if ! command -v jq &> /dev/null; then
        echo "Cannot process alert without jq: $alert_file"
        return 1
    fi

    local crew
    local severity
    local message
    local alert_type

    crew=$(jq -r '.crew // "unknown"' "$alert_file")
    severity=$(jq -r '.severity // "MEDIUM"' "$alert_file")
    message=$(jq -r '.message // "No message"' "$alert_file")
    alert_type=$(jq -r '.type // "unknown"' "$alert_file")

    # Only escalate CRITICAL alerts without diagnosis
    if [ "$severity" != "CRITICAL" ]; then
        return 1
    fi

    echo "Processing critical alert for ${crew}: ${alert_type}"

    # Create synthetic diagnosis for critical alerts
    local diagnosis_file="$DIAGNOSIS_DIR/${crew}-critical.json"
    cat > "$diagnosis_file" << EOF
{
  "timestamp": "${CURRENT_TIME}",
  "crew": "${crew}",
  "diagnosis": "${message}",
  "root_cause": "Critical alert triggered: ${alert_type}",
  "auto_recoverable": false,
  "action": "escalate",
  "escalate": true,
  "confidence": "high",
  "severity": "${severity}"
}
EOF

    escalate_to_human "$crew" "$severity" "$diagnosis_file"

    # Mark alert as escalated
    mv "$alert_file" "${alert_file}.escalated"

    return 0
}

# Main execution
echo "Starting L5 escalation handler..."
echo "Time: $CURRENT_TIME_HUMAN"
echo ""

# Track escalations
escalated_count=0

# First: Process critical alerts that bypass diagnosis
if [ -d "$ALERTS_DIR" ]; then
    for alert_file in "$ALERTS_DIR"/*.json; do
        if [ -f "$alert_file" ] && [[ ! "$alert_file" =~ \.(resolved|escalated)$ ]]; then
            escalate_critical_alert "$alert_file" && escalated_count=$((escalated_count + 1))
        fi
    done
fi

# Second: Process diagnosis results that recommend escalation
if [ -d "$DIAGNOSIS_DIR" ]; then
    for diagnosis_file in "$DIAGNOSIS_DIR"/*.json; do
        if [ -f "$diagnosis_file" ]; then
            crew=$(basename "$diagnosis_file" .json)

            if should_escalate "$crew" "$diagnosis_file"; then
                severity=$(jq -r '.severity // "HIGH"' "$diagnosis_file")
                escalate_to_human "$crew" "$severity" "$diagnosis_file"
                escalated_count=$((escalated_count + 1))
            fi
        fi
    done
fi

# Summary
echo ""
echo "=== Escalation Summary ==="
echo "Total escalations: $escalated_count"
echo "Escalation log: $ESCALATION_LOG"

if [ $escalated_count -gt 0 ]; then
    echo ""
    echo "⚠️  ESCALATIONS REQUIRED - Human intervention needed"
    echo "Review escalation reports in $MONITOR_DIR/escalation-*.md"
    exit 1
fi

echo ""
echo "✓ No escalations needed - all issues resolved or auto-recovered"

exit 0
