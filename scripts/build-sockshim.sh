#!/usr/bin/env bash
# Build the socketcall shim (docker/sockshim.c, see #119/#126) into resources/backend/shim/.
# Docker >= 29's default seccomp profile blocks the i386 socketcall(2) that the 32-bit
# simulator uses; the shim, loaded with LD_PRELOAD, uses the direct socket syscalls instead.
# Skips with a warning when gcc -m32 is unavailable, unless REQUIRE_SOCKSHIM=1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/resources}"
SHIM_DIR="$OUT_DIR/backend/shim"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

skip() {
  echo "build-sockshim: $1" >&2
  [[ "${REQUIRE_SOCKSHIM:-0}" == 1 ]] && exit 1
  echo "build-sockshim: WARNING: skipping the shim (needed only inside containers on Docker >= 29)" >&2
  exit 0
}

[[ -d "$OUT_DIR/backend" ]] || skip "$OUT_DIR/backend not found"
command -v gcc >/dev/null 2>&1 || skip "gcc not found"
if ! gcc -m32 -shared -fPIC -O2 -Wall -Werror -o "$WORK/libsockshim32.so" "$ROOT/docker/sockshim.c" 2>"$WORK/err"; then
  cat "$WORK/err" >&2
  skip "gcc -m32 failed (install gcc-multilib)"
fi
echo > "$WORK/empty.c"
gcc -shared -fPIC -o "$WORK/libsockshim64.so" "$WORK/empty.c" || skip "could not build the 64-bit stub"

rm -rf "$SHIM_DIR"
mkdir -p "$SHIM_DIR/i686" "$SHIM_DIR/i386" "$SHIM_DIR/x86_64"
cp "$WORK/libsockshim32.so" "$SHIM_DIR/i686/libsockshim.so"
cp "$WORK/libsockshim32.so" "$SHIM_DIR/i386/libsockshim.so"
cp "$WORK/libsockshim64.so" "$SHIM_DIR/x86_64/libsockshim.so"
echo "build-sockshim: done -> $SHIM_DIR"
