#!/bin/bash
# L1: Heartbeat Detection for Crew Members
# Pure bash - zero cost, high frequency (every 2 minutes)
# Outputs: .runtime/ai-router/monitor/heartbeat.json

set -euo pipefail

MONITOR_DIR=".runtime/ai-router/monitor"
HEARTBEAT_FILE="$MONITOR_DIR/heartbeat.json"
ALERTS_DIR="$MONITOR_DIR/alerts"

# Ensure directories exist
mkdir -p "$MONITOR_DIR" "$ALERTS_DIR"

# Crew members to monitor (tmux session names)
CREW_SESSIONS=(
    "ar-crew-pi_adapter"
    "ar-crew-router_core"
    "ar-crew-runtime_recovery"
    "ar-crew-infra_sre"
    "ar-crew-sop_watchdog"
)

# Output arrays
CREW_DATA=()
ALERTS=()
CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Function to extract session name from tmux session name
get_crew_name() {
    local session="$1"
    echo "$session" | sed 's/ar-crew-//'
}

# Function to detect error patterns in tmux output
detect_errors() {
    local output="$1"
    local errors=()

    # Common error patterns
    local error_patterns=(
        "error:"
        "Error:"
        "ERROR:"
        "failed"
        "Failed"
        "FAILED"
        "fatal"
        "Fatal"
        "FATAL"
        "panic:"
        "Panic:"
        "PANIC:"
        "undefined"
        "Undefined"
        "UNDEFINED"
        "cannot"
        "Cannot"
        "CANNOT"
        "unable to"
        "Unable to"
        "UNABLE TO"
    )

    for pattern in "${error_patterns[@]}"; do
        if echo "$output" | grep -qi "$pattern"; then
            errors+=("$pattern")
        fi
    done

    printf '%s\n' "${errors[@]}"
}

# Function to calculate idle time from tmux pane
get_idle_seconds() {
    local pane="$1"

    # Get pane content and check for timestamps or activity
    local content
    content=$(tmux capture-pane -pt "$pane" -S -20 2>/dev/null || echo "")

    if [ -z "$content" ]; then
        echo 0
        return
    fi

    # Simple heuristic: if last line contains a prompt, recently active
    # If last line is empty or just cursor, might be idle
    echo "$content" | tail -1 | grep -q '$' && echo 30 || echo 300
}

# Function to get last command from pane
get_last_command() {
    local pane="$1"
    local content
    content=$(tmux capture-pane -pt "$pane" -S -5 2>/dev/null || echo "")

    # Extract last command (looks for prompt pattern)
    echo "$content" | grep -E '^\$|>|#' | tail -1 | sed 's/^[>$#] //'
}

# Monitor each crew session
for session in "${CREW_SESSIONS[@]}"; do
    crew_name=$(get_crew_name "$session")
    alive=false
    pane=""
    idle_seconds=0
    last_command=""
    has_error=false
    error_patterns=()

    # Check if session exists
    if tmux list-sessions 2>/dev/null | grep -q "^${session}:"; then
        alive=true

        # Get pane ID
        pane=$(tmux list-panes -s -t "$session" -F "#{pane_id}" 2>/dev/null | head -1 || echo "")

        if [ -n "$pane" ]; then
            # Get pane content
            pane_output=$(tmux capture-pane -pt "$pane" -S -50 2>/dev/null || echo "")

            # Detect errors
            error_patterns=$(detect_errors "$pane_output")
            if [ -n "$error_patterns" ]; then
                has_error=true
            fi

            # Get idle time
            idle_seconds=$(get_idle_seconds "$pane")

            # Get last command
            last_command=$(get_last_command "$pane")
        fi
    fi

    # Build crew entry
    crew_entry="{
      \"name\": \"${crew_name}\",
      \"session\": \"${session}\",
      \"pane\": \"${pane}\",
      \"alive\": ${alive},
      \"idle_seconds\": ${idle_seconds},
      \"last_command\": \"${last_command}\",
      \"has_error\": ${has_error}
    }"

    CREW_DATA+=("$crew_entry")

    # Generate alerts for critical conditions
    if [ "$alive" = false ]; then
        alert_file="$ALERTS_DIR/${crew_name}-dead.json"
        cat > "$alert_file" << EOF
{
  "timestamp": "${CURRENT_TIME}",
  "crew": "${crew_name}",
  "severity": "CRITICAL",
  "type": "crew_dead",
  "message": "Crew member ${crew_name} session is dead",
  "session": "${session}",
  "triggered_by": "L1_heartbeat"
}
EOF
        ALERTS+=("CRITICAL: ${crew_name} is dead")
    elif [ "$idle_seconds" -gt 900 ]; then
        # Idle > 15 minutes
        alert_file="$ALERTS_DIR/${crew_name}-stuck.json"
        cat > "$alert_file" << EOF
{
  "timestamp": "${CURRENT_TIME}",
  "crew": "${crew_name}",
  "severity": "HIGH",
  "type": "crew_stuck",
  "message": "Crew member ${crew_name} idle for ${idle_seconds}s",
  "idle_seconds": ${idle_seconds},
  "last_command": "${last_command}",
  "triggered_by": "L1_heartbeat"
}
EOF
        ALERTS+=("HIGH: ${crew_name} stuck (${idle_seconds}s idle)")
    elif [ "$has_error" = true ]; then
        alert_file="$ALERTS_DIR/${crew_name}-error.json"
        cat > "$alert_file" << EOF
{
  "timestamp": "${CURRENT_TIME}",
  "crew": "${crew_name}",
  "severity": "MEDIUM",
  "type": "error_detected",
  "message": "Error patterns detected in ${crew_name}",
  "patterns": [$(printf '"%s",' ${error_patterns} | sed 's/,$//')],
  "triggered_by": "L1_heartbeat"
}
EOF
        ALERTS+=("MEDIUM: ${crew_name} has errors")
    fi
done

# Generate heartbeat JSON
cat > "$HEARTBEAT_FILE" << EOF
{
  "timestamp": "${CURRENT_TIME}",
  "crews": [
$(printf '    %s' "${CREW_DATA[0]}")
$(for entry in "${CREW_DATA[@]:1}"; do printf ',\n    %s' "$entry"; done)
  ],
  "summary": {
    "total": ${#CREW_SESSIONS[@]},
    "alive": $(printf '%s\n' "${CREW_DATA[@]}" | grep -c '"alive": true' || echo 0),
    "dead": $(printf '%s\n' "${CREW_DATA[@]}" | grep -c '"alive": false' || echo 0),
    "errors": $(printf '%s\n' "${CREW_DATA[@]}" | grep -c '"has_error": true' || echo 0),
    "alerts": ${#ALERTS[@]}
  }
}
EOF

# Print summary
echo "Heartbeat completed at $CURRENT_TIME"
echo "Total crews: ${#CREW_SESSIONS[@]}"
echo "Alerts generated: ${#ALERTS[@]}"
if [ ${#ALERTS[@]} -gt 0 ]; then
    echo "Alerts:"
    printf '  - %s\n' "${ALERTS[@]}"
fi

# Exit with error code if critical alerts
if [ ${#ALERTS[@]} -gt 0 ]; then
    exit 1
fi

exit 0
