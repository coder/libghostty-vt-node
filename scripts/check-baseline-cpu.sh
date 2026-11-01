#!/usr/bin/env bash
set -euo pipefail

# Runs examples/smoke.ts in one Node process under qemu-user with a generic
# x86-64 CPU, so an addon that executes instructions newer than the x86-64
# baseline (such as AVX-512) fails here instead of on users' machines.
# Set PREBUILDS_ONLY=1 to check prebuilds/ instead of build/Release.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QEMU_CPU="${QEMU_CPU:-qemu64}"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "error: check-baseline-cpu needs Linux on x86_64, found $(uname -s) $(uname -m)" >&2
  exit 2
fi

qemu="$(command -v qemu-x86_64-static || command -v qemu-x86_64 || true)"
if [[ -z "$qemu" ]]; then
  echo "error: missing qemu-x86_64-static or qemu-x86_64" >&2
  echo "Install it first, for example: sudo apt-get install qemu-user" >&2
  exit 2
fi

# qemu-user emulates only the binary it starts. A version-manager shim (mise,
# nvm, volta) would exec the real node natively and the check would pass on
# any addon, so start the real binary.
node_bin="$(node -p process.execPath)"

cd "$ROOT"
echo "Running examples/smoke.ts with $node_bin under $qemu -cpu $QEMU_CPU"
if ! "$qemu" -cpu "$QEMU_CPU" "$node_bin" --import tsx examples/smoke.ts; then
  echo "error: the addon failed on a $QEMU_CPU CPU; it likely uses instructions newer than the x86-64 baseline" >&2
  echo "Build libghostty-vt with LIBGHOSTTY_VT_CPU=baseline (the default) and rebuild the addon." >&2
  exit 1
fi
