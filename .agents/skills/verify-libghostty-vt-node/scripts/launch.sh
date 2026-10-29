#!/usr/bin/env bash
# Build @coder/libghostty-vt-node from this checkout (with uncommitted changes),
# pack it with a prebuild for this platform, and install the tarball into a new
# consumer project, the way a user installs the package from npm.
#
# Usage: .agents/skills/verify-libghostty-vt-node/scripts/launch.sh [RUN_ROOT]
#   RUN_ROOT default: a new mktemp dir. The last line is `READY RUN_ROOT=<dir>`.
# Makes:  RUN_ROOT/instance/  (tarball, consumer project, instance.json, launch.log)
#         RUN_ROOT/evidence/  (empty; drive.sh writes here, cleanup.sh keeps it)
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../../.." && pwd -P)"
RUN_ROOT="${1:-$(mktemp -d "${TMPDIR:-/tmp}/verify-libghostty-vt-node.XXXXXX")}"
# Resolve the physical path before creating anything, so the checks below see it.
RUN_ROOT="$(mkdir -p "$(dirname "$RUN_ROOT")" && cd "$(dirname "$RUN_ROOT")" && pwd -P)/$(basename "$RUN_ROOT")"
case "$RUN_ROOT/" in
  "$ROOT"/*) echo "error: RUN_ROOT must be outside the checkout ($ROOT)." >&2; exit 2 ;;
esac
INSTANCE="$RUN_ROOT/instance"
EVIDENCE="$RUN_ROOT/evidence"

if [[ -e "$INSTANCE" ]]; then
  echo "error: $INSTANCE exists. Run cleanup.sh $RUN_ROOT first, or use a new RUN_ROOT." >&2
  exit 2
fi

# One launch at a time per checkout: launch writes build/, dist/, and prebuilds/.
mkdir -p "$ROOT/vendor"
lock="$ROOT/vendor/.verify-launch.lock"
if ! mkdir "$lock" 2>/dev/null; then
  echo "error: another launch is building in this checkout ($lock)." >&2
  echo "Wait for it. Remove the directory only if no launch.sh process runs." >&2
  exit 2
fi
trap 'rmdir "$lock"' EXIT

mkdir -p "$INSTANCE/consumer" "$EVIDENCE"
# cleanup.sh removes only an instance with this marker, also after a failed launch.
echo "made by launch.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$INSTANCE/.verify-libghostty-vt-node"
log="$INSTANCE/launch.log"
step() { echo "== $*" | tee -a "$log"; }
run() { "$@" >>"$log" 2>&1 || { echo "error: '$*' failed. Last lines of $log:" >&2; tail -30 "$log" >&2; exit 1; }; }

cd "$ROOT"
if [[ ! -d node_modules ]]; then step "npm ci"; run npm ci; fi
if [[ ! -f vendor/libghostty-vt/lib/libghostty-vt.a ]]; then
  step "npm run build:libghostty (first build: needs zig 0.15.2 and the network)"
  run npm run build:libghostty
fi
step "npm run build"; run npm run build
step "npm run build:prebuild"; run npm run build:prebuild
step "npm pack"
tarball="$(npm pack --silent --pack-destination "$INSTANCE" 2>>"$log" | tail -n 1)"
[[ -f "$INSTANCE/$tarball" ]] || { echo "error: npm pack did not write $INSTANCE/$tarball" >&2; exit 1; }

step "install $tarball into $INSTANCE/consumer"
cat > "$INSTANCE/consumer/package.json" <<'JSON'
{ "name": "verify-libghostty-vt-node-consumer", "private": true, "type": "module" }
JSON
(cd "$INSTANCE/consumer" && run npm install --no-audit --no-fund "$INSTANCE/$tarball")

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
diff_sha="$(git -C "$ROOT" diff HEAD | { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi; } | cut -d' ' -f1)"
INSTANCE="$INSTANCE" TARBALL="$tarball" TARBALL_SHA="$(sha "$INSTANCE/$tarball")" \
COMMIT="$(git -C "$ROOT" rev-parse HEAD)" DIFF_SHA="$diff_sha" CHECKOUT="$ROOT" \
node -e '
  const fs = require("node:fs");
  const e = process.env;
  const info = {
    marker: "verify-libghostty-vt-node",
    checkout: e.CHECKOUT, commit: e.COMMIT, trackedDiffSha256: e.DIFF_SHA,
    tarball: e.TARBALL, tarballSha256: e.TARBALL_SHA,
    node: process.version, platform: process.platform, arch: process.arch,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(e.INSTANCE + "/instance.json", JSON.stringify(info, null, 2) + "\n");
'
cp "$INSTANCE/instance.json" "$EVIDENCE/instance.json"
echo "READY RUN_ROOT=$RUN_ROOT"
