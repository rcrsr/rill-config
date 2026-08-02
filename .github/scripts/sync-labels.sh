#!/usr/bin/env bash
# Creates or updates the rill-config label taxonomy (the label axes only).
# Types (Bug/Feature/Chore/Security/Idea) and Priority are native org-level
# GitHub fields, not labels, and are configured in org settings, not here.
# See REPO-STANDARDS.md STD-PROC-7.
#
# One signal per axis; label text is the load-bearing distinction (WCAG 1.4.1).
# area:* uniform blue; on-hold gray (parked); needs-triage yellow (pending).
#
# The area list here must stay in step with .github/labeler.yml, which is the
# one-stop taxonomy doc.
#
# Usage: .github/scripts/sync-labels.sh            (defaults to rcrsr/rill-config)
#        REPO=owner/name .github/scripts/sync-labels.sh
#
# Idempotent: `gh label create --force` upserts, so re-running only updates
# color/description drift. Requires: gh, authenticated with repo scope.
set -euo pipefail

REPO="${REPO:-rcrsr/rill-config}"

AREA_COLOR="1d76db"   # blue, uniform across every area
HOLD_COLOR="d2dae1"   # gray, parked/inactive
TRIAGE_COLOR="fbca04" # yellow, pending/triage

declare -a AREAS=(
  "area:config|rill-config.json parsing, schema validation, version check"
  "area:vars|variable interpolation and the VariableProvider seam"
  "area:loader|specifier resolution, dynamic import, manifests, the value tree"
  "area:bindings|generated bindings, resolvers, and the handler surface"
  "area:project|loadProject() orchestration, step ordering, the public barrel"
  "area:errors|the ConfigError hierarchy and its codes"
  "area:docs|README, CHANGELOG, and repository documentation"
  "area:dx|CI, toolchain, scripts, test harness, root config"
)

for entry in "${AREAS[@]}"; do
  name="${entry%%|*}"
  desc="${entry#*|}"
  gh label create "$name" --repo "$REPO" --color "$AREA_COLOR" --description "$desc" --force
done

gh label create "on-hold" --repo "$REPO" --color "$HOLD_COLOR" \
  --description "Shaped work deliberately parked; not low priority, not blocked-by a specific issue" --force

gh label create "needs-triage" --repo "$REPO" --color "$TRIAGE_COLOR" \
  --description "Enforcer-managed: missing an area label or an Issue Type. Never hand-apply." --force

echo "Label taxonomy synced to $REPO."
