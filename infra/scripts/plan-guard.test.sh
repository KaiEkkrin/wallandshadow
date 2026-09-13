#!/usr/bin/env bash
# =============================================================================
# Tests for plan-guard.sh, run against the fixture plans in testdata/.
# Usage: infra/scripts/plan-guard.test.sh   (CI runs it in the infra job)
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

failures=0

# expect <exit code> <fixture>
expect() {
  local want=$1 fixture=$2 got=0
  ./plan-guard.sh "testdata/$fixture" > /dev/null 2>&1 || got=$?
  if [ "$got" -eq "$want" ]; then
    echo "ok    $fixture (exit $got)"
  else
    echo "FAIL  $fixture: exit $got, expected $want"
    failures=$((failures + 1))
  fi
}

expect 0 plan-no-changes.json
expect 0 plan-update-in-place.json
expect 0 plan-import.json
expect 1 plan-replace-server.json
expect 1 plan-create-before-destroy.json
expect 1 plan-destroy-volume.json
expect 2 not-json.txt
expect 2 empty.json
expect 2 not-a-plan.json

# The listing names every offending resource, not just the first.
listing=$(./plan-guard.sh testdata/plan-replace-server.json 2>&1 || true)
for address in hcloud_server.main hcloud_volume_attachment.pgdata; do
  if grep -qF "$address" <<< "$listing"; then
    echo "ok    listing names $address"
  else
    echo "FAIL  listing does not name $address"
    failures=$((failures + 1))
  fi
done

[ "$failures" -eq 0 ]
