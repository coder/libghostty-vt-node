#!/usr/bin/env bash
# Build @coder/libghostty-vt-node from this checkout (with uncommitted changes),
# pack it with a prebuild for this platform, and install the tarball into a new
# consumer project, the way a user installs the package from npm.
#
# Usage: .agents/skills/verify-libghostty-vt-node/scripts/launch.sh
#   Makes a new RUN_ROOT with mktemp in ${TMPDIR:-/tmp}. The last line is `READY RUN_ROOT=<dir>`.
# Makes:  RUN_ROOT/instance/  (tarball, consumer project, instance.json, launch.log)
#         RUN_ROOT/evidence/  (empty; drive.sh writes here, cleanup.sh keeps it)
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../../.." && pwd -P)"
if [[ $# -gt 0 ]]; then
  echo "error: launch.sh takes no arguments. It makes a new RUN_ROOT with mktemp: set TMPDIR to choose its parent." >&2
  exit 2
fi
# instance.json records vendor/libghostty-vt, so the build must link that copy.
supplied=""
for v in LIBGHOSTTY_VT_PREFIX LIBGHOSTTY_VT_INCLUDE_DIR LIBGHOSTTY_VT_STATIC_LIB LIBGHOSTTY_VT_LIB; do
  [[ -z "${!v+set}" ]] || supplied+=" $v"
done
if [[ -n "$supplied" ]]; then
  echo "error: launch.sh builds and links its own libghostty-vt in $ROOT/vendor/libghostty-vt. Unset${supplied} and launch again." >&2
  exit 2
fi
tmp="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
case "$tmp/" in
  "$ROOT"/*) echo "error: TMPDIR ($tmp) is inside the checkout ($ROOT): set it to a directory outside." >&2; exit 2 ;;
esac
# npm install runs package scripts from RUN_ROOT, and the compiler writes temp
# files to TMPDIR. Refuse a TMPDIR that another account can change: it, or a
# directory above it, is owned by another account (root excepted) or writable
# by group or others without the sticky bit. Children use the checked path.
node -e '
  const fs = require("node:fs"), path = require("node:path");
  for (let dir = process.argv[1]; ; dir = path.dirname(dir)) {
    const st = fs.statSync(dir);
    const why = st.uid !== process.getuid() && st.uid !== 0 ? "another account owns"
      : (st.mode & 0o022) && !(st.mode & 0o1000) ? "group or others can write" : "";
    if (why) { console.error(`error: TMPDIR ${process.argv[1]} is unsafe: ${why} ${dir}`); process.exit(2); }
    if (dir === path.dirname(dir)) break;
  }
' "$tmp"
export TMPDIR="$tmp"
RUN_ROOT="$(mktemp -d "$TMPDIR/verify-libghostty-vt-node.XXXXXX")"
INSTANCE="$RUN_ROOT/instance"
EVIDENCE="$RUN_ROOT/evidence"

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
sha_stdin() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi | cut -d' ' -f1; }
sha() { sha_stdin < "$1"; }
# The checkout state that this launch builds. It must not change until the end.
checkout_state() { echo "$(git -C "$ROOT" rev-parse HEAD) $(git -C "$ROOT" diff HEAD | sha_stdin)"; }
state_before="$(checkout_state)"

cd "$ROOT"
# Reuse node_modules and libghostty-vt only when they were built from the
# current inputs. Each stamp holds the hash of those inputs.
deps_stamp="node_modules/.verify-libghostty-vt-node.sha256"
deps_inputs="$(sha package-lock.json)"
if [[ "$(cat "$deps_stamp" 2>/dev/null)" != "$deps_inputs" ]]; then
  step "npm ci (node_modules is missing or older than package-lock.json)"
  run npm ci
  echo "$deps_inputs" > "$deps_stamp"
fi
lib_dir="$ROOT/vendor/libghostty-vt"
lib_stamp="$lib_dir/.verify-libghostty-vt-node.sha256"
lib_inputs="$( { cat scripts/build-libghostty-vt.sh; env | grep -E '^(GHOSTTY_|LIBGHOSTTY_VT_)' | sort || true; } | sha_stdin)"
if [[ ! -f "$lib_dir/lib/libghostty-vt.a" || "$(cat "$lib_stamp" 2>/dev/null)" != "$lib_inputs" ]]; then
  step "npm run build:libghostty (missing, or built from other inputs: needs zig 0.17.0 and the network)"
  run npm run build:libghostty
  echo "$lib_inputs" > "$lib_stamp"
fi
# tsc never deletes output whose source is gone, and npm pack ships all of dist/.
step "npm run build (from an empty dist/)"; rm -rf dist; run npm run build
step "npm run build:prebuild"; run npm run build:prebuild
step "npm pack"
tarball="$(npm pack --silent --pack-destination "$INSTANCE" 2>>"$log" | tail -n 1)"
[[ -f "$INSTANCE/$tarball" ]] || { echo "error: npm pack did not write $INSTANCE/$tarball" >&2; exit 1; }

step "install $tarball into $INSTANCE/consumer"
cat > "$INSTANCE/consumer/package.json" <<'JSON'
{ "name": "verify-libghostty-vt-node-consumer", "private": true, "type": "module" }
JSON
(cd "$INSTANCE/consumer" && run npm install --no-audit --no-fund "$INSTANCE/$tarball")

if [[ "$(checkout_state)" != "$state_before" ]]; then
  echo "error: the checkout changed during the launch (HEAD or tracked diff). Run cleanup.sh, then launch again." >&2
  exit 1
fi
static_lib="$lib_dir/lib/libghostty-vt.a"
addon="$(cd "$INSTANCE/consumer" && node -e 'process.stdout.write(require("node-gyp-build").path(process.argv[1]))' "$INSTANCE/consumer/node_modules/@coder/libghostty-vt-node")"
INSTANCE="$INSTANCE" TARBALL="$tarball" TARBALL_SHA="$(sha "$INSTANCE/$tarball")" \
LIB_INPUTS="$lib_inputs" STATIC_LIB="$static_lib" STATIC_LIB_SHA="$(sha "$static_lib")" \
ADDON="${addon#"$INSTANCE/consumer/"}" ADDON_SHA="$(sha "$addon")" \
COMMIT="${state_before% *}" DIFF_SHA="${state_before#* }" CHECKOUT="$ROOT" \
node -e '
  const fs = require("node:fs");
  const e = process.env;
  const info = {
    marker: "verify-libghostty-vt-node",
    checkout: e.CHECKOUT, commit: e.COMMIT, trackedDiffSha256: e.DIFF_SHA,
    tarball: e.TARBALL, tarballSha256: e.TARBALL_SHA,
    addon: e.ADDON, addonSha256: e.ADDON_SHA,
    libghosttyVt: { staticLib: e.STATIC_LIB, staticLibSha256: e.STATIC_LIB_SHA, buildInputsSha256: e.LIB_INPUTS },
    node: process.version, platform: process.platform, arch: process.arch,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(e.INSTANCE + "/instance.json", JSON.stringify(info, null, 2) + "\n");
'
cp "$INSTANCE/instance.json" "$EVIDENCE/instance.json"
echo "READY RUN_ROOT=$RUN_ROOT"
