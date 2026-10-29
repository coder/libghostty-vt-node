#!/usr/bin/env bash
# Run one journey: an ES module read from stdin, run with node inside the
# consumer project, so `import ... from "@coder/libghostty-vt-node"` loads the
# installed package. Saves the script, stdout, stderr, and exit code as evidence.
#
# Usage: .agents/skills/verify-libghostty-vt-node/scripts/drive.sh RUN_ROOT NAME [node flags...] <<'JS'
#          import { createTerminal } from "@coder/libghostty-vt-node";
#          ...
#        JS
# Writes: RUN_ROOT/evidence/NAME/{journey.mjs,command.txt,stdout.txt,stderr.txt,exit-code.txt}
# Exit:   the journey's exit code. A signal gives 128 + the signal number.
set -uo pipefail

RUN_ROOT="${1:?usage: drive.sh RUN_ROOT NAME [node flags...] < journey.mjs}"
NAME="${2:?usage: drive.sh RUN_ROOT NAME [node flags...] < journey.mjs}"
shift 2
CONSUMER="$RUN_ROOT/instance/consumer"
OUT="$RUN_ROOT/evidence/$NAME"
[[ -f "$RUN_ROOT/instance/instance.json" ]] || { echo "error: no instance in $RUN_ROOT: run launch.sh" >&2; exit 2; }
[[ "$NAME" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || { echo "error: NAME must match [a-z0-9][a-z0-9._-]*" >&2; exit 2; }
[[ -e "$OUT" ]] && { echo "error: $OUT exists: pick a new NAME, evidence is never overwritten" >&2; exit 2; }

mkdir -p "$OUT" "$CONSUMER/journeys"
cat > "$CONSUMER/journeys/$NAME.mjs"
cp "$CONSUMER/journeys/$NAME.mjs" "$OUT/journey.mjs"
echo "cd $CONSUMER && node $* journeys/$NAME.mjs   # $(date -u +%Y-%m-%dT%H:%M:%SZ) $(node --version)" > "$OUT/command.txt"

(cd "$CONSUMER" && node "$@" "journeys/$NAME.mjs") > "$OUT/stdout.txt" 2> "$OUT/stderr.txt"
code=$?
echo "$code" > "$OUT/exit-code.txt"
cat "$OUT/stdout.txt"
[[ -s "$OUT/stderr.txt" ]] && { echo "--- stderr" >&2; head -20 "$OUT/stderr.txt" >&2; }
echo "--- exit $code, evidence in $OUT" >&2
exit $code
