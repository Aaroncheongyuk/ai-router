#!/bin/bash
# L4: Diagnosis Script
# Uses Claude Sonnet (high-quality model) for error analysis
# Frequency: Only when triggered by alerts
# Outputs: Diagnosis results and recovery recommendations

set -euo pipefail

MONITOR_DIR=".runtime/ai-router/monitor"
ALERTS_DIR="$MONITOR_DIR/alerts"
PATROL_DIR="$MONITOR_DIR/patrol"
HEARTBEAT_FILE="$MONITOR_DIR/heartbeat.json"

CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Ensure directories exist
mkdir -p "$ALERTS_DIR" "$MONITOR_DIR/diagnosis"

# Function to diagnose a crew member
diagnose_crew() {
    local crew_name="$1"
    local alert_file="$2"

    echo "=== Diagnosing ${crew_name} ==="

    # Read alert details
    local alert_type
    local severity
    local message

    if command -v jq &> /dev/null; then
        alert_type=$(jq -r '.type // "unknown"' "$alert_file")
        severity=$(jq -r '.severity // "UNKNOWN"' "$alert_file")
        message=$(jq -r '.message // "No message"' "$alert_file")
    else
        alert_type="unknown"
        severity="UNKNOWN"
        message="Unable to parse alert"
    fi

    # Get patrol data if available
    local patrol_file="$PATROL_DIR/${crew_name}.json"
    local patrol_data=""
    if [ -f "$patrol_file" ]; then
        patrol_data=$(cat "$patrol_file")
    fi

    # Get heartbeat data
    local heartbeat_data=""
    if [ -f "$HEARTBEAT_FILE" ]; then
        heartbeat_data=$(cat "$HEARTBEAT_FILE")
    fi

    # Get tmux session info
    local session="ar-crew-${crew_name}"
    local pane=""
    local tmux_output=""

    if tmux list-sessions 2>/dev/null | grep -q "^${session}:"; then
        pane=$(tmux list-panes -s -t "$session" -F "#{pane_id}" 2>/dev/null | head -1 || echo "")
        if [ -n "$pane" ]; then
            tmux_output=$(tmux capture-pane -pt "$pane" -S -200 2>/dev/null || echo "")
        fi
    fi

    # Use Claude Sonnet for diagnosis
    local diagnosis=""
    if command -v claude &> /dev/null; then
        diagnosis=$(ANTHROPIC_MODEL=claude-sonnet-4-5 \
                   ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL:-"http://38.146.29.81:8000"} \
                   claude --print 2>/dev/null << EOF
Diagnose the following crew member issue and provide recovery recommendations:

Alert Details:
- Type: ${alert_type}
- Severity: ${severity}
- Message: ${message}
- Crew: ${crew_name}

Patrol Data:
${patrol_data}

Heartbeat Data:
${heartbeat_data}

Tmux Output:
${tmux_output}

Please analyze:
1. What is the root cause of this issue?
2. Is this automatically recoverable?
3. What specific recovery action should be taken? (restart, retry, ignore, escalate)
4. What commands should be executed to recover?
5. Should this be escalated to human intervention?

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
  "crew": "${crew_name}",
  "diagnosis": "brief diagnosis of the root cause",
  "root_cause": "specific technical reason",
  "auto_recoverable": true|false,
  "action": "restart|retry|ignore|escalate|manual",
  "commands": ["cmd1", "cmd2"],
  "escalate": true|false,
  "confidence": "high|medium|low"
}
EOF
                   )
    else
        # Fallback: rule-based diagnosis
        diagnosis=$(cat <<EOF
{
  "crew": "${crew_name}",
  "diagnosis": "Unable to perform LLM diagnosis - claude command not found",
  "root_cause": "Tooling unavailable",
  "auto_recoverable": false,
  "action": "manual",
  "commands": [],
  "escalate": true,
  "confidence": "low"
}
EOF
                   )
    fi

    # Extract JSON from response
    local json_diagnosis
    json_diagnosis=$(echo "$diagnosis" | grep -A 20 '{' | grep -B 20 '}' | head -21)

    # Save diagnosis to file
    local diagnosis_file="$MONITOR_DIR/diagnosis/${crew_name}.json"
    cat > "$diagnosis_file" << EOF
{
  "timestamp": "${CURRENT_TIME}",
  "alert_file": "${alert_file}",
  $(echo "$json_diagnosis" | tail -n +2 | head -n -1)
}
EOF

    echo "Diagnosis saved to $diagnosis_file"

    # Display diagnosis
    if command -v jq &> /dev/null; then
        echo ""
        echo "Diagnosis:"
        jq -r '.diagnosis // "N/A"' "$diagnosis_file"
        echo "Root Cause: $(jq -r '.root_cause // "N/A"' "$diagnosis_file")"
        echo "Action: $(jq -r '.action // "N/A"' "$diagnosis_file")"
        echo "Escalate: $(jq -r '.escalate // false' "$diagnosis_file")"
        echo ""
    fi

    # Auto-recover if recommended
    if command -v jq &> /dev/null; then
        local auto_recoverable
        auto_recoverable=$(jq -r '.auto_recoverable // false' "$diagnosis_file")
        local action
        action=$(jq -r '.action // "none"' "$diagnosis_file")

        if [ "$auto_recoverable" = "true" ] && [ "$action" != "manual" ] && [ "$action" != "escalate" ]; then
            echo "Attempting auto-recovery with action: $action"

            # Extract and execute commands
            jq -r '.commands[]? // empty' "$diagnosis_file" | while read -r cmd; do
                if [ -n "$cmd" ]; then
                    echo "Executing: $cmd"
                    eval "$cmd" 2>&1 || echo "Command failed: $cmd"
                fi
            done

            # Mark alert as resolved
            mv "$alert_file" "${alert_file}.resolved"
        fi
    fi
}

# Main execution
echo "Starting L4 diagnosis analysis..."

# Check if there are any alerts
if [ ! -d "$ALERTS_DIR" ] || [ -z "$(find "$ALERTS_DIR" -name "*.json" -not -name "*.resolved" 2>/dev/null)" ]; then
    echo "No alerts found. Nothing to diagnose."
    exit 0
fi

# Process each alert
for alert_file in "$ALERTS_DIR"/*.json; do
    if [ -f "$alert_file" ] && [[ ! "$alert_file" =~ \.resolved$ ]]; then
        if command -v jq &> /dev/null; then
            crew_name=$(jq -r '.crew // "unknown"' "$alert_file")
        else
            crew_name=$(basename "$alert_file" .json | sed 's/-.*//')
        fi

        diagnose_crew "$crew_name" "$alert_file"
        echo ""
    fi
done

echo "L4 diagnosis completed"
echo "Diagnosis reports saved to $MONITOR_DIR/diagnosis/"

exit 0
