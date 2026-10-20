#!/bin/bash
#
# Backfill confidence scores from cached AI summaries
# This script reads all cached summaries and extracts confidence scores into data/scores.json
#

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Backfilling Confidence Scores ===${NC}"
echo

# Directories
SUMMARY_DIR="server/data/cache/application/summary"
SCORES_FILE="server/data/scores.json"

# Check if summary directory exists
if [ ! -d "$SUMMARY_DIR" ]; then
  echo -e "${YELLOW}No summaries found at $SUMMARY_DIR${NC}"
  echo "Creating empty scores.json..."
  mkdir -p "$(dirname "$SCORES_FILE")"
  echo "{}" > "$SCORES_FILE"
  exit 0
fi

# Count summaries
SUMMARY_COUNT=$(find "$SUMMARY_DIR" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
echo -e "Found ${GREEN}$SUMMARY_COUNT${NC} cached summaries"
echo

# Start with empty scores object
echo "{" > "$SCORES_FILE.tmp"

FIRST=true
PROCESSED=0

# Process each summary file
for SUMMARY_FILE in "$SUMMARY_DIR"/*.json; do
  if [ -f "$SUMMARY_FILE" ]; then
    # Extract application ID from filename (remove .json extension)
    FILENAME=$(basename "$SUMMARY_FILE")
    APP_ID="${FILENAME%.json}"
    
    # Extract confidence score from summary JSON
    CONFIDENCE=$(jq -r '.confidence // empty' "$SUMMARY_FILE" 2>/dev/null)
    
    if [ ! -z "$CONFIDENCE" ]; then
      # Add comma if not first entry
      if [ "$FIRST" = false ]; then
        echo "," >> "$SCORES_FILE.tmp"
      fi
      FIRST=false
      
      # Write entry (no trailing comma yet)
      echo -n "  \"$APP_ID\": $CONFIDENCE" >> "$SCORES_FILE.tmp"
      
      PROCESSED=$((PROCESSED + 1))
      echo -e "  ${GREEN}✓${NC} Application $APP_ID: confidence ${CONFIDENCE}%"
    else
      echo -e "  ${YELLOW}⚠${NC} Application $APP_ID: no confidence score found"
    fi
  fi
done

# Close JSON object
echo "" >> "$SCORES_FILE.tmp"
echo "}" >> "$SCORES_FILE.tmp"

# Move temp file to final location
mv "$SCORES_FILE.tmp" "$SCORES_FILE"

echo
echo -e "${GREEN}=== Backfill Complete ===${NC}"
echo -e "Processed: ${GREEN}$PROCESSED${NC} / $SUMMARY_COUNT summaries"
echo -e "Output: ${BLUE}$SCORES_FILE${NC}"
echo

# Show summary of scores
if [ $PROCESSED -gt 0 ]; then
  echo "Score distribution:"
  jq -r 'to_entries[] | "\(.key): \(.value)%"' "$SCORES_FILE" | sort -t: -k2 -rn | head -10
  
  if [ $PROCESSED -gt 10 ]; then
    echo "  ... (showing top 10)"
  fi
fi

echo
echo -e "${BLUE}Done!${NC}"

