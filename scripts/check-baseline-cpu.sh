#!/usr/bin/env bash
set -euo pipefail

# Runs examples/smoke.ts in one Node process under qemu-user with a generic
# x86-64 CPU, so an addon that executes instructions newer than the x86-64
# baseline (such as AVX-512) fails here instead of on users' machines.
# Set PREBUILDS_ONLY=1 to check prebuilds/ instead of build/Release.
# Set BASELINE_CPU_IMAGE (for example ubuntu:24.04) to run the check inside
# that Docker image, for hosts whose own libraries need a newer CPU.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QEMU_CPU="${QEMU_CPU:-qemu64}"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "error: check-baseline-cpu needs Linux on x86_64, found $(uname -s) $(uname -m)" >&2
  exit 2
fi

# qemu-user emulates only the binary it starts. A version-manager shim (mise,
# nvm, volta) would exec the real node natively and the check would pass on
# any addon, so start the real binary.
node_bin="$(node -p process.execPath)"

# Ubuntu's amd64v3 variant (ubuntu-latest since 26.04) builds the system
# libraries for x86-64-v3, so there Node itself dies on qemu64. The image
# brings x86-64 baseline libraries. Node needs libatomic1, which the Ubuntu
# base image lacks. The repository is mounted read-only, so the image cannot
# change the addon or prebuilds/ that later steps ship.
if [[ -n "${BASELINE_CPU_IMAGE:-}" ]]; then
  exec docker run --rm --ulimit core=0 \
    -v "$ROOT:$ROOT:ro" -v "$node_bin:$node_bin:ro" -w "$ROOT" \
    -e QEMU_CPU -e PREBUILDS_ONLY -e PATH="$(dirname "$node_bin"):/usr/sbin:/usr/bin:/sbin:/bin" \
    "$BASELINE_CPU_IMAGE" sh -c '
      { apt-get update -qq &&
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends libatomic1 qemu-user >/dev/null; } ||
        { echo "error: could not install libatomic1 and qemu-user in the image" >&2; exit 2; }
      exec scripts/check-baseline-cpu.sh'
fi

qemu="$(command -v qemu-x86_64-static || command -v qemu-x86_64 || true)"
if [[ -z "$qemu" ]]; then
  echo "error: missing qemu-x86_64-static or qemu-x86_64" >&2
  echo "Install it first, for example: sudo apt-get install qemu-user" >&2
  exit 2
fi

# Control: if Node or the system libraries alone need a newer CPU (Ubuntu's
# amd64v3 variant builds them for x86-64-v3), the host cannot emulate
# QEMU_CPU and a failure says nothing about the addon.
if ! "$qemu" -cpu "$QEMU_CPU" "$node_bin" -e 0; then
  echo "error: node without the addon fails on an emulated $QEMU_CPU CPU, so this host cannot run the check with that CPU" >&2
  echo "Run it in an image with baseline libraries, for example BASELINE_CPU_IMAGE=ubuntu:24.04" >&2
  exit 2
fi

cd "$ROOT"
echo "Running examples/smoke.ts with $node_bin under $qemu -cpu $QEMU_CPU"
if ! "$qemu" -cpu "$QEMU_CPU" "$node_bin" --import tsx examples/smoke.ts; then
  echo "error: the addon failed on a $QEMU_CPU CPU; it likely uses instructions newer than the x86-64 baseline" >&2
  echo "Build libghostty-vt with LIBGHOSTTY_VT_CPU=baseline (the default), and rebuild the addon with no -march newer than x86-64 (binding.gyp sets -march=x86-64)." >&2
  exit 1
fi
