#!/usr/bin/env bash
# Enforce specific anti-patterns from CLAUDE.md NEVER-DO rules 11, 13, 15.
# Uses a baseline file: existing violations are grandfathered, only NEW
# violations block CI.
#
# Update baseline after a refactor that reduces violations:
#   bash scripts/ci/check-forbidden-patterns.sh --update-baseline
#
# Local check:
#   bash scripts/ci/check-forbidden-patterns.sh
#
# The baseline count should monotonically decrease. Never increase it
# without a written justification in the commit message.

set -eo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

BASELINE_FILE="scripts/ci/.forbidden-patterns-baseline"
MODE="${1:-check}"

# ------------------------------------------------------------
# Pattern scanner — appends lines in format "RULE|FILE:LINE:MATCH"
# ------------------------------------------------------------
scan_pattern() {
  local rule="$1"
  local pattern="$2"
  shift 2
  local paths=("$@")

  if command -v rg >/dev/null 2>&1; then
    rg -n "$pattern" "${paths[@]}" 2>/dev/null | while IFS= read -r line; do
      printf "R%s|%s\n" "$rule" "$line"
    done
  else
    grep -rnE "$pattern" "${paths[@]}" 2>/dev/null | while IFS= read -r line; do
      printf "R%s|%s\n" "$rule" "$line"
    done
  fi
}

scan_all() {
  # Rule 11 — Supabase table name cast as any: `from('table_name' as any)`
  scan_pattern 11 "from\(['\"][a-z_]+['\"] as any" apps/erp/src

  # Rule 11 — Supabase column cast as any: `.select('...' as any)`
  scan_pattern 11 "\.select\(['\"][^'\"]+['\"] as any" apps/erp/src

  # Rule 13 — count: 'exact' in the three known-large dashboard query files
  # (small-table queries in data-flag-actions.ts etc. are exempt — they're
  # counting filtered subsets and the tables are small).
  scan_pattern 13 "count:[[:space:]]*['\"]exact['\"]" \
    apps/erp/src/lib/dashboard-queries.ts \
    apps/erp/src/lib/pm-queries.ts \
    apps/erp/src/lib/finance-queries.ts

  # Rule 15 — Inline Supabase client imports in pages/components
  scan_pattern 15 "from ['\"]@repo/supabase/(server|client)['\"]" apps/erp/src/app
  scan_pattern 15 "from ['\"]@repo/supabase/(server|client)['\"]" apps/erp/src/components
}

scan_sorted() {
  scan_all | sort -u
}

if [[ "$MODE" == "--update-baseline" ]]; then
  scan_sorted > "$BASELINE_FILE"
  COUNT=$(wc -l < "$BASELINE_FILE" | tr -d ' ')
  echo "✓ Baseline updated: $COUNT violations grandfathered"
  echo "  Commit $BASELINE_FILE alongside this change."
  exit 0
fi

if [[ ! -f "$BASELINE_FILE" ]]; then
  echo "ERROR: baseline file missing: $BASELINE_FILE"
  echo "Run: bash $0 --update-baseline"
  exit 1
fi

CURRENT=$(mktemp)
trap 'rm -f "$CURRENT"' EXIT
scan_sorted > "$CURRENT"

BASELINE_COUNT=$(wc -l < "$BASELINE_FILE" | tr -d ' ')

# New violations = present now but not in baseline
NEW_VIOLATIONS=$(comm -23 "$CURRENT" "$BASELINE_FILE" || true)

if [[ -n "$NEW_VIOLATIONS" ]]; then
  echo ""
  echo "=================================================================="
  echo "NEW forbidden-pattern violations (not in baseline):"
  echo "=================================================================="
  printf "%s\n" "$NEW_VIOLATIONS"
  echo ""
  echo "=================================================================="
  echo "These violate CLAUDE.md NEVER-DO rules 11, 13, or 15."
  echo "See CLAUDE.md 'NEVER DO — ABSOLUTE RULES' for rationale + fix patterns."
  echo ""
  echo "If you are INTENTIONALLY reducing violations, regenerate baseline:"
  echo "  bash $0 --update-baseline"
  echo "=================================================================="
  exit 1
fi

# Reverse: things fixed since baseline was last updated
REMOVED_VIOLATIONS=$(comm -13 "$CURRENT" "$BASELINE_FILE" || true)
if [[ -n "$REMOVED_VIOLATIONS" ]]; then
  REMOVED_COUNT=$(printf "%s\n" "$REMOVED_VIOLATIONS" | grep -c . || true)
  echo "✓ Forbidden-pattern check passed (no new violations)"
  echo "ℹ $REMOVED_COUNT violation(s) were fixed since baseline was last updated!"
  echo "  Update baseline to lock in progress:"
  echo "  bash $0 --update-baseline"
else
  echo "✓ Forbidden-pattern check passed (baseline: $BASELINE_COUNT violations grandfathered)"
fi

exit 0
