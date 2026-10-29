#!/usr/bin/env bash
# Remove the instance that launch.sh made in RUN_ROOT. Keep RUN_ROOT/evidence.
# Usage: .agents/skills/verify-libghostty-vt-node/scripts/cleanup.sh RUN_ROOT
set -euo pipefail

RUN_ROOT="${1:?usage: cleanup.sh RUN_ROOT}"
INSTANCE="$RUN_ROOT/instance"
if [[ ! -e "$INSTANCE" ]]; then
  echo "nothing to remove: no $INSTANCE"
else
  [[ -f "$INSTANCE/.verify-libghostty-vt-node" ]] || {
    echo "error: $INSTANCE has no .verify-libghostty-vt-node marker from launch.sh; not removing it" >&2
    exit 2
  }
  rm -rf "$INSTANCE"
  echo "removed $INSTANCE"
fi
if [[ -d "$RUN_ROOT/evidence" ]]; then
  echo "evidence kept in $RUN_ROOT/evidence:"
  ls -1 "$RUN_ROOT/evidence"
fi
