#!/bin/bash
#
# Regenerate all AI summaries
# This script finds all cached summaries and regenerates them with the updated prompt
#

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Regenerating All AI Summaries ===${NC}"
echo

# Configuration
SUMMARY_DIR="server/data/cache/application/summary"
API_URL="http://localhost:3000/api/applicants"

# Check if server is running
if ! curl -s "$API_URL" > /dev/null; then
  echo -e "${RED}Error: Server is not running on localhost:3000${NC}"
  echo "Please start the server with: npm run dev"
  exit 1
fi

# Check if summary directory exists
if [ ! -d "$SUMMARY_DIR" ]; then
  echo -e "${YELLOW}No summaries found at $SUMMARY_DIR${NC}"
  exit 0
fi

# Count summaries
SUMMARY_COUNT=$(find "$SUMMARY_DIR" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
echo -e "Found ${GREEN}$SUMMARY_COUNT${NC} cached summaries to regenerate"
echo

PROCESSED=0
SUCCESS=0
FAILED=0

# Process each summary file
for SUMMARY_FILE in "$SUMMARY_DIR"/*.json; do
  if [ -f "$SUMMARY_FILE" ]; then
    # Extract application ID from filename (remove .json extension)
    FILENAME=$(basename "$SUMMARY_FILE")
    APP_ID="${FILENAME%.json}"
    
    echo -e "${BLUE}Processing application $APP_ID...${NC}"
    
    # Call API to regenerate summary (with force=true to clear cache)
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/$APP_ID/generate-summary?force=true")
    
    if [ "$HTTP_CODE" -eq 200 ]; then
      SUCCESS=$((SUCCESS + 1))
      echo -e "  ${GREEN}✓${NC} Successfully regenerated (HTTP $HTTP_CODE)"
    else
      FAILED=$((FAILED + 1))
      echo -e "  ${RED}✗${NC} Failed to regenerate (HTTP $HTTP_CODE)"
    fi
    
    PROCESSED=$((PROCESSED + 1))
    
    # Progress indicator
    echo -e "  Progress: $PROCESSED / $SUMMARY_COUNT"
    echo
    
    # Small delay to avoid overwhelming the API
    sleep 1
  fi
done

echo
echo -e "${GREEN}=== Regeneration Complete ===${NC}"
echo -e "Total: ${BLUE}$PROCESSED${NC}"
echo -e "Success: ${GREEN}$SUCCESS${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo

if [ $SUCCESS -gt 0 ]; then
  echo -e "${BLUE}Running backfill to update scores database...${NC}"
  ./scripts/backfill-scores.sh
fi

echo
echo -e "${BLUE}Done!${NC}"

