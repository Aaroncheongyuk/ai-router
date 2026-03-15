#!/bin/bash
# L2: Patrol Analysis for Crew Members
# Uses glm-4.7 (cheapest LLM) for routine analysis
# Frequency: Every 10 minutes, or triggered by L1
# Outputs: .runtime/ai-router/monitor/patrol/<crew>.json

set -euo pipefail

MONITOR_DIR=".runtime/ai-router/monitor"
HEARTBEAT_FILE="$MONITOR_DIR/heartbeat.json"
PATROL_DIR="$MONITOR_DIR/patrol"

# Ensure directories exist
mkdir -p "$PATROL_DIR"

# Check if heartbeat file exists
if [ ! -f "$HEARTBEAT_FILE" ]; then
    echo "Error: Heartbeat file not found at $HEARTBEAT_FILE"
    echo "Run crew-heartbeat.sh first"
    exit 1
fi

# Function to analyze a crew member using LLM
analyze_crew() {
    local crew_name="$1"
    local session="$2"
    local pane="$3"
    local patrol_file="$PATROL_DIR/${crew_name}.json"

    # Skip if no pane (crew is dead)
    if [ -z "$pane" ]; then
        cat > "$patrol_file" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "crew": "${crew_name}",
  "status": "dead",
  "task": null,
  "progress": "N/A",
  "stuck": false,
  "errors": ["Session not found"],
  "summary": "Crew session does not exist"
}
EOF
        return
    fi

    # Capture tmux output
    local tmux_output
    tmux_output=$(tmux capture-pane -pt "$pane" -S -100 2>/dev/null || echo "Unable to capture pane")

    # Use claude --print mode with cheap model for analysis
    # Note: This requires the claude wrapper to be configured
    local analysis
    if command -v claude &> /dev/null; then
        analysis=$(ANTHROPIC_MODEL=glm-4.7 \
                   ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL:-"http://38.146.29.81:8000"} \
                   claude --print 2>/dev/null << EOF
Analyze the following tmux output from crew member "${crew_name}" and determine:

1. What task is the crew currently working on?
2. What is their current status? (working, idle, waiting, error, stuck)
3. What is their estimated progress percentage? (0-100%)
4. Are they stuck or making progress?
5. Are there any errors or issues?

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
  "task": "brief description of current task",
  "status": "working|idle|waiting|error|stuck",
  "progress": "0-100",
  "stuck": true|false,
  "errors": ["error1", "error2"],
  "summary": "brief one-line summary"
}

Tmux output:
${tmux_output}
EOF
                   )
    else
        # Fallback: basic pattern matching without LLM
        analysis=$(cat <<EOF
{
  "task": "$(echo "$tmux_output" | grep -E '^\$|Running' | tail -1 | sed 's/^[>$#] //' | head -c 50)",
  "status": "unknown",
  "progress": "unknown",
  "stuck": false,
  "errors": [],
  "summary": "LLM analysis unavailable - claude command not found"
}
EOF
                   )
    fi

    # Parse and write patrol report
    # Extract JSON from the response (handle potential extra text)
    local json_analysis
    json_analysis=$(echo "$analysis" | grep -A 20 '{' | grep -B 20 '}' | head -21)

    cat > "$patrol_file" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "crew": "${crew_name}",
  "session": "${session}",
  "pane": "${pane}",
  $(echo "$json_analysis" | tail -n +2 | head -n -1)
}
EOF

    echo "Patrol analysis completed for ${crew_name}"
}

# Read heartbeat data and analyze each crew
heartbeat_data=$(cat "$HEARTBEAT_FILE")

# Extract crew entries and analyze each
echo "Starting L2 patrol analysis..."

# Use jq if available, otherwise fall back to grep
if command -v jq &> /dev/null; then
    crew_count=$(echo "$heartbeat_data" | jq '.crews | length')
    for i in $(seq 0 $((crew_count - 1))); do
        crew_name=$(echo "$heartbeat_data" | jq -r ".crews[$i].name")
        session=$(echo "$heartbeat_data" | jq -r ".crews[$i].session")
        pane=$(echo "$heartbeat_data" | jq -r ".crews[$i].pane")

        echo "Analyzing ${crew_name}..."
        analyze_crew "$crew_name" "$session" "$pane"
    done
else
    # Fallback: parse manually
    echo "Warning: jq not found, using basic parsing"
    grep -o '"name": "[^"]*"' "$HEARTBEAT_FILE" | cut -d'"' -f4 | while read -r crew_name; do
        session="ar-crew-${crew_name}"
        pane=$(tmux list-panes -s -t "$session" -F "#{pane_id}" 2>/dev/null | head -1 || echo "")
        echo "Analyzing ${crew_name}..."
        analyze_crew "$crew_name" "$session" "$pane"
    done
fi

echo "L2 patrol analysis completed"
echo "Reports saved to $PATROL_DIR/"
