#!/bin/bash
# L3: Analyst Dashboard Generation
# Uses MiniMax-M2.5 or glm-5 (mid-tier model) for summarization
# Frequency: Every 30 minutes
# Outputs: .runtime/ai-router/monitor/dashboard.md

set -euo pipefail

MONITOR_DIR=".runtime/ai-router/monitor"
HEARTBEAT_FILE="$MONITOR_DIR/heartbeat.json"
PATROL_DIR="$MONITOR_DIR/patrol"
DASHBOARD_FILE="$MONITOR_DIR/dashboard.md"
ALERTS_DIR="$MONITOR_DIR/alerts"

# Ensure directories exist
mkdir -p "$MONITOR_DIR"

CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
CURRENT_DATE=$(date -u +"%Y-%m-%d")
CURRENT_TIME_HUMAN=$(date -u +"%Y-%m-%d %H:%M UTC")

# Function to generate summary from all patrol reports
generate_dashboard() {
    local summary=""

    # Count crews by status
    local total=0
    local active=0
    local idle=0
    local dead=0
    local alert_count=0

    # Read heartbeat data
    if [ -f "$HEARTBEAT_FILE" ]; then
        if command -v jq &> /dev/null; then
            total=$(jq '.summary.total' "$HEARTBEAT_FILE" 2>/dev/null || echo 0)
            alive=$(jq '.summary.alive' "$HEARTBEAT_FILE" 2>/dev/null || echo 0)
            dead=$(jq '.summary.dead' "$HEARTBEAT_FILE" 2>/dev/null || echo 0)
            alert_count=$(jq '.summary.alerts' "$HEARTBEAT_FILE" 2>/dev/null || echo 0)
        fi
    fi

    # Count active/idle from patrol reports
    if [ -d "$PATROL_DIR" ]; then
        for patrol_file in "$PATROL_DIR"/*.json; do
            if [ -f "$patrol_file" ]; then
                if command -v jq &> /dev/null; then
                    status=$(jq -r '.status // "unknown"' "$patrol_file" 2>/dev/null)
                    case "$status" in
                        working) active=$((active + 1)) ;;
                        idle) idle=$((idle + 1)) ;;
                        dead) dead=$((dead + 1)) ;;
                    esac
                fi
            fi
        done
    fi

    # Count alerts
    if [ -d "$ALERTS_DIR" ]; then
        alert_count=$(find "$ALERTS_DIR" -name "*.json" 2>/dev/null | wc -l)
    fi

    # Use LLM to generate dashboard if available
    local dashboard_content=""
    local patrol_data=""

    # Collect patrol data
    if [ -d "$PATROL_DIR" ]; then
        for patrol_file in "$PATROL_DIR"/*.json; do
            if [ -f "$patrol_file" ]; then
                patrol_data="${patrol_data}\n$(cat "$patrol_file")"
            fi
        done
    fi

    # Generate dashboard with LLM
    if command -v claude &> /dev/null && [ -n "$patrol_data" ]; then
        dashboard_content=$(ANTHROPIC_MODEL=MiniMax-M2.5 \
                          ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL:-"http://38.146.29.81:8000"} \
                          claude --print 2>/dev/null << EOF
Generate a crew monitoring dashboard report in Markdown format based on the following patrol data:

Patrol data:
${patrol_data}

Current time: ${CURRENT_TIME_HUMAN}

Create a dashboard with these sections:
1. Summary header with total/active/idle/dead counts and alert count
2. Crew Status table with columns: Crew, Status, Task, Progress, Model
3. Alerts section listing any critical issues
4. Trend analysis (last 2 hours) if historical data available

Use ONLY Markdown format. Keep it concise and readable.
EOF
                          )
    fi

    # If LLM failed or unavailable, generate basic dashboard
    if [ -z "$dashboard_content" ]; then
        dashboard_content="# Crew Monitor Dashboard
## ${CURRENT_TIME_HUMAN}

### Summary
- Total: ${total} crews | Active: ${active} | Idle: ${idle} | Dead: ${dead}
- Alerts: ${alert_count}

### Crew Status
| Crew | Status | Task | Progress | Model |
|------|--------|------|----------|-------|
"

        # Add crew rows
        if [ -d "$PATROL_DIR" ]; then
            for patrol_file in "$PATROL_DIR"/*.json; do
                if [ -f "$patrol_file" ]; then
                    if command -v jq &> /dev/null; then
                        crew=$(jq -r '.crew // "unknown"' "$patrol_file")
                        status=$(jq -r '.status // "unknown"' "$patrol_file")
                        task=$(jq -r '.task // "N/A"' "$patrol_file" | head -c 30)
                        progress=$(jq -r '.progress // "N/A"' "$patrol_file")
                        model="MiniMax-M2.5"

                        dashboard_content="${dashboard_content}| ${crew} | ${status} | ${task} | ${progress} | ${model} |
"
                    fi
                fi
            done
        fi

        # Add alerts section
        dashboard_content="${dashboard_content}
### Alerts
"

        if [ -d "$ALERTS_DIR" ] && [ "$alert_count" -gt 0 ]; then
            for alert_file in "$ALERTS_DIR"/*.json; do
                if [ -f "$alert_file" ]; then
                    if command -v jq &> /dev/null; then
                        severity=$(jq -r '.severity // "UNKNOWN"' "$alert_file")
                        crew=$(jq -r '.crew // "unknown"' "$alert_file")
                        message=$(jq -r '.message // "No message"' "$alert_file")

                        dashboard_content="${dashboard_content}- [${severity}] ${crew}: ${message}
"
                    fi
                fi
            done
        else
            dashboard_content="${dashboard_content}- No active alerts
"
        fi

        dashboard_content="${dashboard_content}
### Trend (last 2h)
- No historical data available
- Run this script periodically to collect trend data
"
    fi

    echo "$dashboard_content"
}

# Main execution
echo "Generating L3 analyst dashboard..."

dashboard_content=$(generate_dashboard)

# Write dashboard file
echo "$dashboard_content" > "$DASHBOARD_FILE"

# Display summary
echo "Dashboard generated at $DASHBOARD_FILE"
echo ""
echo "=== Dashboard Summary ==="
echo "$dashboard_content" | head -20
echo "..."
echo ""
echo "Full dashboard: cat $DASHBOARD_FILE"

exit 0
