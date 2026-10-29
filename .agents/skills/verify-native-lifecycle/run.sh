#!/usr/bin/env bash
# Model-check model/AddonEnvLifecycle.tla with TLC, one run per rule and config,
# and compare each result with EXPECT below.
#
# Usage: .agents/skills/verify-native-lifecycle/run.sh [OUT_DIR]
#   OUT_DIR keeps every TLC log (default: a new mktemp dir, printed at the end).
# Env:   TLA2TOOLS_JAR=/path/to/tla2tools.jar  use this jar (must be v1.7.4)
#        JAVA=/path/to/java                    Java 11 or later (default: java on PATH)
# Exit:  0 = every result matches EXPECT, 1 = a result differs, 2 = tool or model error.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
MODEL_DIR="$SKILL_DIR/model"
SPEC=AddonEnvLifecycle
TLA_VERSION=1.7.4
TLA_SHA256=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
JAVA="${JAVA:-java}"

RULES=(CreateUsesOwnClass LoadDeletesOnlyOwnRef HandleFreedOnce NoCallOnDeadHandle)

# EXPECT: the rules that each config must break. Every other rule must hold.
# Each mutant is the current code with one break, and must break its rule.
# (A function, not an associative array: macOS ships bash 3.2.)
expect_breaks() {
  case "$1" in
    current) echo "" ;;
    mutant-process-static) echo "CreateUsesOwnClass LoadDeletesOnlyOwnRef" ;;
    mutant-dispose-keeps-pointer) echo "HandleFreedOnce" ;;
    mutant-no-use-guards) echo "NoCallOnDeadHandle" ;;
    *) echo "error: no EXPECT entry for config $1" >&2; exit 2 ;;
  esac
}
CONFIGS=(current mutant-process-static mutant-dispose-keeps-pointer mutant-no-use-guards)
for cfg in "${CONFIGS[@]}"; do expect_breaks "$cfg" >/dev/null; done

command -v "$JAVA" >/dev/null || { echo "error: java not found; set JAVA or install Java 11+" >&2; exit 2; }

jar="${TLA2TOOLS_JAR:-$ROOT/vendor/tla2tools/tla2tools-$TLA_VERSION.jar}"
if [[ ! -f "$jar" ]]; then
  mkdir -p "$(dirname "$jar")"
  echo "Downloading tla2tools v$TLA_VERSION to $jar"
  curl -fsSL -o "$jar.part" "https://github.com/tlaplus/tlaplus/releases/download/v$TLA_VERSION/tla2tools.jar"
  mv "$jar.part" "$jar"
fi
if command -v sha256sum >/dev/null; then
  actual_sha="$(sha256sum "$jar" | cut -d' ' -f1)"
else
  actual_sha="$(shasum -a 256 "$jar" | cut -d' ' -f1)"
fi
if [[ "$actual_sha" != "$TLA_SHA256" ]]; then
  echo "error: $jar has sha256 $actual_sha, expected $TLA_SHA256 (tla2tools v$TLA_VERSION)" >&2
  exit 2
fi

out="${1:-$(mktemp -d "${TMPDIR:-/tmp}/verify-native-lifecycle.XXXXXX")}"
mkdir -p "$out"
cp "$MODEL_DIR/$SPEC.tla" "$out/"

status=0
printf '%-30s %-24s %-7s %-7s %s\n' CONFIG RULE RESULT EXPECT LOG
for cfg in "${CONFIGS[@]}"; do
  [[ -f "$MODEL_DIR/$cfg.cfg" ]] || { echo "error: missing $MODEL_DIR/$cfg.cfg" >&2; exit 2; }
  for rule in "${RULES[@]}"; do
    name="$cfg.$rule"
    # Same constants as the config; check TypeOK and this one rule only.
    sed '/^INVARIANTS/,$d' "$MODEL_DIR/$cfg.cfg" > "$out/$name.cfg"
    printf 'INVARIANTS\n    TypeOK\n    %s\n' "$rule" >> "$out/$name.cfg"
    log="$out/$name.out"
    (cd "$out" && "$JAVA" -XX:+UseParallelGC -cp "$jar" tlc2.TLC -workers 1 \
        -metadir "$out/.states/$name" -config "$name.cfg" "$SPEC.tla") > "$log" 2>&1 || true

    if grep -q "Invariant TypeOK is violated" "$log"; then
      echo "error: TypeOK breaks in $cfg: the model is wrong, not the code. See $log" >&2
      exit 2
    elif grep -q "Invariant $rule is violated" "$log"; then
      result=breaks
    elif grep -q "Model checking completed. No error has been found." "$log"; then
      result=holds
    else
      echo "error: TLC did not finish $name. See $log" >&2
      tail -20 "$log" >&2
      exit 2
    fi

    expect=holds
    [[ " $(expect_breaks "$cfg") " == *" $rule "* ]] && expect=breaks
    mark=""
    if [[ "$result" != "$expect" ]]; then mark="  <-- DIFFERS"; status=1; fi
    printf '%-30s %-24s %-7s %-7s %s%s\n' "$cfg" "$rule" "$result" "$expect" "$log" "$mark"
  done
done

echo
echo "TLC logs and counterexamples: $out"
if [[ $status -eq 0 ]]; then
  echo "OK: every result matches EXPECT."
else
  echo "DIFFERS: read each marked log. See 'Read the result' in SKILL.md."
fi
exit $status
