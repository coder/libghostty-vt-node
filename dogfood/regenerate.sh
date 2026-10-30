#!/usr/bin/env bash
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
D=dogfood/bootstrap
want_node="v$(sed -n 's/^node = "\(.*\)"$/\1/p' mise.toml)"
got_node="$(npm exec -c 'node --version')"
if [ "$got_node" != "$want_node" ]; then
  echo "error: npm scripts run node $got_node, but mise.toml pins $want_node" >&2
  exit 1
fi
failed=0
run() {
  local out="$1"; shift
  local status=0
  { echo "\$ $*"; "$@"; } > "$D/.step" 2>&1 || status=$?
  echo "exit=$status" >> "$D/.step"
  cat "$D/.step" >> "$D/session.log"
  if [ -n "$out" ]; then cp "$D/.step" "$D/$out"; fi
  rm -f "$D/.step"
  if [ "$status" -ne 0 ]; then echo "error: '$*' exited $status" >&2; failed=1; fi
}
: > "$D/session.log"
run "" npm install
run "" npm run build
run build-libghostty-output.txt npm run build:libghostty
run build-native-output.txt npm run build:native
run test-output.txt npm test
run smoke-output.txt npm run smoke
run npm-pack-output.txt npm pack --dry-run
node -e "import('./dist/index.js').then((m)=>console.log(JSON.stringify(m.getNativeInfo(), null, 2))).catch((err)=>{ console.log(JSON.stringify({ ok: false, error: err.message, cause: err.cause ? String(err.cause.message || err.cause) : undefined }, null, 2)); process.exitCode = 0; })" > "$D/native-info.json"
{
  echo "date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node=$got_node"
  echo "npm=$(npm --version)"
  echo "zig=$(npm exec -c 'zig version')"
  echo "platform=$(uname -srm)"
  echo "ghostty_commit=$(sed -n 's/^GHOSTTY_COMMIT="${GHOSTTY_COMMIT:-\(.*\)}"$/\1/p' scripts/build-libghostty-vt.sh)"
  echo "git_head=$(git rev-parse HEAD)"
} > "$D/environment.txt"
exit "$failed"
