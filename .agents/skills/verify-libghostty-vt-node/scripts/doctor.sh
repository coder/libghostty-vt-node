#!/usr/bin/env bash
# Read-only check: is the instance in RUN_ROOT worth driving?
# Usage: .agents/skills/verify-libghostty-vt-node/scripts/doctor.sh RUN_ROOT
# Exit:  0 = every check passed (WARN lines allowed), 1 = a check failed.
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../../.." && pwd -P)"
RUN_ROOT="${1:?usage: doctor.sh RUN_ROOT}"
INSTANCE="$RUN_ROOT/instance"
fail=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; fail=1; }
warn() { echo "WARN  $*"; }
sha_stdin() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi | cut -d' ' -f1; }

if [[ ! -f "$INSTANCE/instance.json" ]]; then
  bad "no $INSTANCE/instance.json: run launch.sh first"
  exit 1
fi
ok "instance.json: $INSTANCE/instance.json"
# Physical path: node reports real paths, and RUN_ROOT can sit behind a symlink.
CONSUMER="$(cd "$INSTANCE/consumer" && pwd -P)"

field() { node -e 'const i=require(process.argv[1]); process.stdout.write(String(i[process.argv[2]]))' "$INSTANCE/instance.json" "$1"; }
[[ "$(field marker)" == "verify-libghostty-vt-node" ]] && ok "made by launch.sh" || bad "instance.json was not made by launch.sh"
[[ "$(field checkout)" == "$ROOT" ]] && ok "built from this checkout" || bad "built from $(field checkout), not $ROOT"

head_now="$(git -C "$ROOT" rev-parse HEAD)"
diff_now="$(git -C "$ROOT" diff HEAD | sha_stdin)"
if [[ "$(field commit)" == "$head_now" && "$(field trackedDiffSha256)" == "$diff_now" ]]; then
  ok "current: built from HEAD $head_now and the same uncommitted diff"
else
  bad "STALE: the checkout changed after launch (HEAD or tracked diff). Run cleanup.sh, then launch.sh again"
fi

[[ "$(field node)" == "$(node --version)" ]] && ok "node $(node --version) matches launch" \
  || bad "node on PATH is $(node --version), launch used $(field node)"
pinned="$(sed -n 's/^node = "\(.*\)"/v\1/p' "$ROOT/mise.toml")"
[[ "$(node --version)" == "$pinned" ]] || warn "node $(node --version) is not the mise.toml pin $pinned"

pkg_dir="$CONSUMER/node_modules/@coder/libghostty-vt-node"
[[ -d "$pkg_dir" && ! -L "$pkg_dir" ]] && ok "package installed as a copy in the consumer" \
  || bad "missing or symlinked $pkg_dir"

addon="$(cd "$CONSUMER" && node -e 'process.stdout.write(require("node-gyp-build").path(process.argv[1]))' "$pkg_dir" 2>&1)"
case "$addon" in
  "$pkg_dir"/prebuilds/*.node) ok "addon loads from the packed prebuild: ${addon#"$CONSUMER"/}" ;;
  *) bad "node-gyp-build does not pick a packed prebuild: $addon" ;;
esac
addon_sha=""
[[ -f "$addon" ]] && addon_sha="$(sha_stdin < "$addon")"
want_sha="$(field addonSha256)"
[[ "$addon_sha" == "$want_sha" ]] && ok "addon sha256 $addon_sha matches instance.json" \
  || bad "addon sha256 is ${addon_sha:-unreadable}, instance.json has addonSha256 $want_sha: the installed addon changed after launch. Run cleanup.sh, then launch.sh again"

info="$(cd "$CONSUMER" && node --input-type=module -e '
  const { fileURLToPath } = await import("node:url");
  const url = import.meta.resolve("@coder/libghostty-vt-node");
  const { getNativeInfo } = await import(url);
  console.log(JSON.stringify({ path: fileURLToPath(url), ...getNativeInfo() }));
' 2>&1)"
if [[ "$info" == "{"* ]]; then
  ok "getNativeInfo: $info"
  resolved="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).path)' "$info")"
  case "$resolved" in
    "$CONSUMER/node_modules/"*) ok "the bare import resolves inside the consumer" ;;
    *) bad "the bare import resolves outside the consumer: $resolved" ;;
  esac
  version="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).packageVersion)' "$info")"
  want="$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")"
  [[ "$version" == "$want" ]] && ok "packageVersion $version matches package.json" \
    || bad "packageVersion $version, package.json has $want"
else
  bad "the package does not load in the consumer: $info"
fi

exit $fail
