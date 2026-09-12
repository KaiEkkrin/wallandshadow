#!/usr/bin/env bash
# =============================================================================
# Fail if an OpenTofu plan would delete or replace any resource.
# =============================================================================
# Usage: plan-guard.sh <plan.json>    (JSON from `tofu show -json tfplan`)
#
# Exit codes: 0 nothing is deleted or replaced; 1 something is (listed on
# stderr); 2 bad usage or unreadable plan.
#
# Rebuilding the server is survivable (docs/SERVER_OPERATIONS.md), but it is
# still downtime plus manual follow-up, so it must never happen as a side
# effect. The provision workflow runs this after every plan; its
# allow_replace and replace_server inputs skip it for a deliberate change.
# =============================================================================
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <plan.json>" >&2
  exit 2
fi

if ! destructive=$(jq -r '
    .resource_changes[]?
    | select(.change.actions | index("delete"))
    | "\(.address) (\(.change.actions | join(", ")))"
  ' "$1"); then
  echo "Could not read plan JSON from $1" >&2
  exit 2
fi

if [ -n "$destructive" ]; then
  echo "This plan deletes or replaces resources:" >&2
  while IFS= read -r line; do
    echo "  $line" >&2
  done <<< "$destructive"
  exit 1
fi

echo "No resources are deleted or replaced."
