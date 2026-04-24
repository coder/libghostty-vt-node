#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GHOSTTY_REPO="${GHOSTTY_REPO:-https://github.com/ghostty-org/ghostty.git}"
GHOSTTY_COMMIT="${GHOSTTY_COMMIT:-48ccec182a932c2ec04c344d45a5fc553861cb13}"
GHOSTTY_SOURCE_DIR="${GHOSTTY_SOURCE_DIR:-$ROOT/vendor/ghostty}"
PREFIX="${LIBGHOSTTY_VT_PREFIX:-$ROOT/vendor/libghostty-vt}"
SIMD="${LIBGHOSTTY_VT_SIMD:-false}"
OPTIMIZE="${LIBGHOSTTY_VT_OPTIMIZE:-ReleaseFast}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: missing required command '$1'" >&2
    echo "Install it first, then rerun npm run build:libghostty." >&2
    if [[ "$1" == "zig" ]]; then
      echo "This Ghostty commit requires Zig 0.15.2. With mise: mise install" >&2
    fi
    exit 1
  fi
}

need git
need zig

mkdir -p "$(dirname "$GHOSTTY_SOURCE_DIR")" "$PREFIX"

if [[ ! -d "$GHOSTTY_SOURCE_DIR/.git" ]]; then
  echo "Cloning Ghostty $GHOSTTY_COMMIT into $GHOSTTY_SOURCE_DIR"
  git clone "$GHOSTTY_REPO" "$GHOSTTY_SOURCE_DIR"
fi

git -C "$GHOSTTY_SOURCE_DIR" fetch --depth 1 origin "$GHOSTTY_COMMIT"
git -C "$GHOSTTY_SOURCE_DIR" checkout --detach "$GHOSTTY_COMMIT"

zig_version="$(zig version)"
required_zig="$(sed -n 's/.*minimum_zig_version = "\(.*\)".*/\1/p' "$GHOSTTY_SOURCE_DIR/build.zig.zon" | head -n 1)"
if [[ -n "$required_zig" && "$zig_version" != "$required_zig" ]]; then
  echo "error: Ghostty $GHOSTTY_COMMIT requires Zig $required_zig, but PATH has $zig_version" >&2
  echo "Use mise install, or put the matching zig on PATH." >&2
  exit 1
fi

zig_args=(
  build
  -Demit-lib-vt=true
  "-Dsimd=$SIMD"
  "-Doptimize=$OPTIMIZE"
  --prefix "$PREFIX"
  install
)

if [[ "$(uname -s)" == "Darwin" ]] && command -v xcrun >/dev/null 2>&1; then
  sdkroot="$(xcrun --show-sdk-path 2>/dev/null || true)"
  if [[ -n "$sdkroot" ]]; then
    zig_args=(build --sysroot "$sdkroot" "${zig_args[@]:1}")
  fi
fi

echo "Building libghostty-vt at Ghostty commit $GHOSTTY_COMMIT"
if ! (
  cd "$GHOSTTY_SOURCE_DIR"
  zig "${zig_args[@]}"
); then
  echo "error: failed to build libghostty-vt from Ghostty $GHOSTTY_COMMIT" >&2
  echo "Verify that Zig $required_zig can build a simple project on this machine and that the platform SDK is discoverable." >&2
  if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "On macOS, check \`xcrun --show-sdk-path\` and the Xcode command line tools selected by \`xcode-select -p\`." >&2
  fi
  exit 1
fi

header="$PREFIX/include/ghostty/vt.h"
lib="$PREFIX/lib/libghostty-vt.a"
if [[ ! -f "$header" || ! -f "$lib" ]]; then
  echo "error: libghostty-vt build finished, but expected outputs are missing" >&2
  echo "header: $header" >&2
  echo "library: $lib" >&2
  exit 1
fi

cat > "$PREFIX/ghostty-source.json" <<JSON
{
  "repository": "$GHOSTTY_REPO",
  "commit": "$GHOSTTY_COMMIT",
  "zigVersion": "$zig_version",
  "simd": "$SIMD",
  "optimize": "$OPTIMIZE"
}
JSON

echo "Installed libghostty-vt into $PREFIX"
