#!/usr/bin/env bash
# check-api-coverage.sh
#
# Narrow pre-commit heuristic for staged UI API calls.
# It scans changed web files for simple fetch/axios /api calls and checks that a
# similarly-shaped Express route appears to exist. It is not a repo-wide API
# coverage, OpenAPI, or route consistency gate.
#
# Usage:
#   ./scripts/check-api-coverage.sh [--staged]
#
# Options:
#   --staged  Only check staged files (default for pre-commit)
#
# Exit codes:
#   0 - No missing staged UI API call heuristics detected
#   1 - Missing API coverage detected

set -e

STAGED_ONLY=false
if [ "$1" = "--staged" ]; then
  STAGED_ONLY=true
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Checking staged UI API call route heuristic..."

# Get files to check
if [ "$STAGED_ONLY" = true ]; then
  FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(tsx?|jsx?)$' || true)
else
  FILES=$(git diff --name-only HEAD~1 | grep -E '\.(tsx?|jsx?)$' || true)
fi

if [ -z "$FILES" ]; then
  echo -e "${GREEN}No changed JavaScript/TypeScript files to scan${NC}"
  exit 0
fi

# Known API endpoints (extracted from routes with mount points)
# First, extract mount points from app.ts: app.use('/api/xxx', xxxRoutes)
# Then combine with routes from each route file
API_ENDPOINTS=""

# Get mount points from app.ts (simple list)
# e.g., "sprints" from app.use('/api/sprints', sprintsRoutes)
# Also handle xxxRouter naming convention (e.g., searchRouter)
MOUNT_POINTS=$(grep -E "app\.use.*Route[rs]" api/src/app.ts 2>/dev/null | \
  sed -n "s/.*app\.use(['\"]\/api\/\([^'\"]*\)['\"].*/\1/p" | sort -u)

# Now extract routes from each file and prepend mount point
TEMP_FILE="/tmp/api_endpoints_$$"
rm -f "$TEMP_FILE"
touch "$TEMP_FILE"

for route_file in api/src/routes/*.ts; do
  [ -f "$route_file" ] || continue

  # Skip test files
  case "$route_file" in
    *".test.ts") continue ;;
  esac

  # Get base name without .ts extension
  basename_file=$(basename "$route_file" .ts)

  # Find mount point for this file
  # Check if this file's basename matches a mount point
  mount_prefix=""
  if echo "$MOUNT_POINTS" | grep -qx "$basename_file"; then
    mount_prefix="$basename_file/"
  fi

  # Extract routes from this file and prepend mount prefix.
  # Supports same-line (.get('/path')) and multiline (.get(\n  '/path')) defineRoute patterns.
  awk '
    function extract_quoted_path(line,    start, rest, end) {
      start = index(line, "'\''")
      if (start == 0) return 0
      rest = substr(line, start + 1)
      end = index(rest, "'\''")
      if (end == 0) return 0
      print substr(rest, 1, end - 1)
      return 1
    }
    /\.(get|post|put|patch|delete)\(/ {
      if (!extract_quoted_path($0)) {
        want_path = 1
      }
      next
    }
    want_path {
      if (extract_quoted_path($0)) {
        want_path = 0
      } else if ($0 ~ /\)/) {
        want_path = 0
      }
      next
    }
  ' "$route_file" | sed 's/^\///' | while read -r route; do
    if [ -z "$route" ]; then
      # Base route '/' becomes just the mount prefix (without trailing slash)
      echo "${mount_prefix%/}"
    else
      echo "${mount_prefix}${route}"
    fi
  done | grep -v '^$' >> "$TEMP_FILE" || true
done

# Also add direct app routes (app.get, app.post, etc.)
{
  grep -h "app\.get" api/src/app.ts 2>/dev/null | sed -n "s/.*app\.get('\/api\/\([^']*\)'.*/\1/p"
  grep -h "app\.post" api/src/app.ts 2>/dev/null | sed -n "s/.*app\.post('\/api\/\([^']*\)'.*/\1/p"
  grep -h "app\.put" api/src/app.ts 2>/dev/null | sed -n "s/.*app\.put('\/api\/\([^']*\)'.*/\1/p"
  grep -h "app\.patch" api/src/app.ts 2>/dev/null | sed -n "s/.*app\.patch('\/api\/\([^']*\)'.*/\1/p"
  grep -h "app\.delete" api/src/app.ts 2>/dev/null | sed -n "s/.*app\.delete('\/api\/\([^']*\)'.*/\1/p"
} | sed 's/^\///' | grep -v '^$' >> "$TEMP_FILE" || true

API_ENDPOINTS=$(cat "$TEMP_FILE" 2>/dev/null | sort -u | grep -v '^$' || true)
rm -f "$TEMP_FILE"

# Track missing coverage
MISSING=()

# Check each changed file for API calls
for file in $FILES; do
  if [ ! -f "$file" ]; then
    continue
  fi

  # Skip non-web files
  if [[ ! "$file" =~ ^web/ ]]; then
    continue
  fi

  # Extract API calls from the file
  # Look for patterns like: fetch('/api/..., fetch(`${API_URL}/api/..., axios.get('/api/...
  # Strip query strings (?...) from the extracted paths
  API_CALLS=$(grep -oE "(fetch|axios\.[a-z]+)\(['\"\`][^'\"]*\/api\/[^'\"]*" "$file" 2>/dev/null | \
    sed -n 's/.*\/api\/\([^'\"'\`]*\).*/\1/p' | \
    sed 's/\?.*$//' | \
    sort -u || true)

  # Also check for API_URL + path patterns
  # Strip query strings (?...) and template expressions after the path
  API_CALLS2=$(grep -oE '\$\{API_URL\}\/api\/[^`"'\'']*' "$file" 2>/dev/null | \
    sed 's/.*\/api\///' | \
    sed 's/[`"'\''].*//' | \
    sed 's/\?.*$//' | \
    sort -u || true)

  ALL_CALLS=$(echo -e "$API_CALLS\n$API_CALLS2" | sort -u | grep -v '^$' || true)

  if [ -z "$ALL_CALLS" ]; then
    continue
  fi

  # Check each API call has a corresponding endpoint
  while IFS= read -r call; do
    # Normalize the call (remove dynamic segments like :id)
    NORMALIZED=$(echo "$call" | sed 's/\${[^}]*}/[^\/]*/g' | sed 's/:[a-zA-Z_]*/[^\/]*/g')

    # Check if any endpoint matches
    FOUND=false
    while IFS= read -r endpoint; do
      if echo "$endpoint" | grep -qE "^${NORMALIZED}$" 2>/dev/null; then
        FOUND=true
        break
      fi
      # Also check with wildcards for dynamic routes
      ENDPOINT_PATTERN=$(echo "$endpoint" | sed 's/:[a-zA-Z_]*/[^\/]*/g')
      if echo "$call" | grep -qE "^${ENDPOINT_PATTERN}$" 2>/dev/null; then
        FOUND=true
        break
      fi
    done <<< "$API_ENDPOINTS"

    if [ "$FOUND" = false ]; then
      # Skip common false positives
      # - auth/ and health are common utility endpoints
      # - documents/.*/backlinks: backlinks.ts is mounted under /api/documents (not /api/backlinks)
      # - team/grid.*: template literal with params causes false positive (endpoint exists in team.ts)
      # - admin/audit-logs/export: template literal with params causes false positive (endpoint exists in admin.ts)
      if [[ "$call" =~ ^auth/ ]] || [[ "$call" =~ ^health$ ]] || \
         [[ "$call" =~ ^documents/.*backlinks ]] || [[ "$call" =~ ^team/grid ]] || \
         [[ "$call" =~ ^team/accountability-grid-v3 ]] || \
         [[ "$call" =~ ^admin/audit-logs/export ]] || \
         [[ "$call" =~ ^weekly-retros ]] || [[ "$call" =~ ^weekly-plans ]]; then
        continue
      fi
      MISSING+=("$file: /api/$call")
    fi
  done <<< "$ALL_CALLS"
done

# Report results
if [ ${#MISSING[@]} -eq 0 ]; then
  echo -e "${GREEN}✓ No missing staged UI API call heuristics detected${NC}"
  exit 0
else
  echo -e "${RED}✗ Missing API coverage detected:${NC}"
  echo ""
  for item in "${MISSING[@]}"; do
    echo -e "  ${YELLOW}$item${NC}"
  done
  echo ""
  echo -e "${RED}Please ensure API endpoints exist for these UI calls.${NC}"
  echo "If this is a false positive, the endpoint may use a different URL pattern."
  exit 1
fi
