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
outside_checkout() {
  case "$1/" in
    "$ROOT"/*) echo "error: RUN_ROOT must be outside the checkout ($ROOT)." >&2; exit 2 ;;
  esac
}
RUN_ROOT="${1:-}"
if [[ -z "$RUN_ROOT" ]]; then
  RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/verify-libghostty-vt-node.XXXXXX")"
elif [[ ! -e "$RUN_ROOT" && ! -L "$RUN_ROOT" ]]; then
  parent="$(dirname -- "$RUN_ROOT")"
  if [[ -d "$parent" ]]; then outside_checkout "$(cd "$parent" && pwd -P)/$(basename -- "$RUN_ROOT")"; fi
  mkdir -p -- "$parent"
  mkdir -m 700 -- "$RUN_ROOT"
fi
# The build installs the tarball from RUN_ROOT with npm, which runs package
# scripts. Refuse a RUN_ROOT that another account can change or move: a
# symlink, a directory owned by someone else or writable by group or others,
# or one below any directory that another account owns (root excepted) or
# that group or others can write without the sticky bit.
node -e '
  const fs = require("node:fs"), path = require("node:path");
  const dir = process.argv[1], uid = process.getuid();
  const fail = (why) => { console.error(`error: RUN_ROOT ${dir} ${why}`); process.exit(2); };
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink()) fail("is a symlink: pass the real path");
  if (!st.isDirectory()) fail("is not a directory");
  if (st.uid !== uid) fail("is not owned by you");
  if (st.mode & 0o022) fail("is writable by group or others: chmod 700 it, or use a new path");
  for (let up = path.dirname(fs.realpathSync(dir)); ; up = path.dirname(up)) {
    const a = fs.statSync(up);
    if (a.uid !== uid && a.uid !== 0) fail(`is below ${up}, which another account owns`);
    if ((a.mode & 0o022) && !(a.mode & 0o1000)) fail(`is below ${up}, which group or others can write`);
    if (up === path.dirname(up)) break;
  }
' "$RUN_ROOT"
RUN_ROOT="$(cd "$RUN_ROOT" && pwd -P)"
outside_checkout "$RUN_ROOT"
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
lib_dir="${LIBGHOSTTY_VT_PREFIX:-$ROOT/vendor/libghostty-vt}"
lib_stamp="$lib_dir/.verify-libghostty-vt-node.sha256"
lib_inputs="$( { cat scripts/build-libghostty-vt.sh; env | grep -E '^(GHOSTTY_|LIBGHOSTTY_VT_)' | sort || true; } | sha_stdin)"
if [[ ! -f "$lib_dir/lib/libghostty-vt.a" || "$(cat "$lib_stamp" 2>/dev/null)" != "$lib_inputs" ]]; then
  step "npm run build:libghostty (missing, or built from other inputs: needs zig 0.15.2 and the network)"
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
INSTANCE="$INSTANCE" TARBALL="$tarball" TARBALL_SHA="$(sha "$INSTANCE/$tarball")" \
COMMIT="${state_before% *}" DIFF_SHA="${state_before#* }" CHECKOUT="$ROOT" \
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
