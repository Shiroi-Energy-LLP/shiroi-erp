#!/usr/bin/env bash
# Advisory guardrail (NEVER fails the build — always exits 0).
# Warns when a docs/CHANGELOG.md entry exceeds the one-line cap. The changelog is the
# grep-able "when did we ship X" index; paragraphs of detail belong in docs/reviews/ or
# the spec, linked by basename. Added 2026-06-19 with the docs lean-reset
# (spec: docs/superpowers/specs/2026-06-19-docs-lean-reset-design.md) because the file had
# silently re-bloated from ~one line to ~1,650 chars per entry across many sessions.
set -uo pipefail

CAP=400
FILE="docs/CHANGELOG.md"
[ -f "$FILE" ] || { echo "changelog-length: $FILE not found (skip)"; exit 0; }

# Accurate Unicode code-point counting via node (₹, —, etc. would over-count as bytes in awk).
node -e '
const fs = require("fs");
const cap = +process.argv[1];
const file = process.argv[2];
const lines = fs.readFileSync(file, "utf8").split("\n");
const over = [];
lines.forEach((l, i) => {
  if (l.startsWith("- **[") && [...l].length > cap) {
    over.push("  L" + (i + 1) + "  " + [...l].length + " chars: " + l.slice(0, 80));
  }
});
if (over.length) {
  console.log("⚠ changelog-length (advisory): " + over.length + " entr" + (over.length > 1 ? "ies" : "y") +
    " over " + cap + " chars — move the detail into docs/reviews/<date>-<topic>.md (or the spec) and link the basename:");
  console.log(over.join("\n"));
  console.log("  (warning only — this check never fails the build)");
} else {
  console.log("changelog-length: all entries within " + cap + " chars ✓");
}
' "$CAP" "$FILE"

exit 0
