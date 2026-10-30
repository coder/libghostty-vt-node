#!/usr/bin/env bash
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
D=dogfood/bootstrap
run() { local out="$1"; shift; { echo "\$ $*"; "$@"; echo "exit=$?"; } > "$D/.step" 2>&1; cat "$D/.step" >> "$D/session.log"; [ -n "$out" ] && cp "$D/.step" "$D/$out"; rm -f "$D/.step"; }
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
  echo "node=$(node --version)"
  echo "npm=$(npm --version)"
  echo "zig=$(npm exec -c 'zig version')"
  echo "platform=$(uname -srm)"
  echo "ghostty_commit=$(sed -n 's/^GHOSTTY_COMMIT="${GHOSTTY_COMMIT:-\(.*\)}"$/\1/p' scripts/build-libghostty-vt.sh)"
  echo "git_head=$(git rev-parse HEAD)"
} > "$D/environment.txt"
