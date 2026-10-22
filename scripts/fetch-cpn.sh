#!/usr/bin/env bash
# Download the official CPN IDE Windows installer (v1.24.1031) and unpack the
# Java backend and static Angular UI into resources/backend and resources/ui.
# Idempotent: re-running with an up-to-date OUT_DIR is a no-op.
set -euo pipefail

CPN_INSTALLER_URL="${CPN_INSTALLER_URL:-https://cpnide.org/downloads/cpn-ide-1.24.1031.setup.exe}"
CPN_INSTALLER_SHA256="${CPN_INSTALLER_SHA256:-19084e923258681b809e80b5a5c1944da6b7f072397d1194a26689b46a9b879a}"
ASAR_VERSION="${ASAR_VERSION:-3.2.18}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/resources}"
CACHE_DIR="${CACHE_DIR:-$ROOT/.cache}"
INSTALLER="$CACHE_DIR/$(basename "$CPN_INSTALLER_URL")"
STAMP="$OUT_DIR/.installer-sha256"
# Bump PATCH_ID when scripts/patch-cpnmld.mjs or patch-ui.mjs change so stale resources are rebuilt.
PATCH_ID="loopback1+ui1+shim1"
STAMP_VALUE="$CPN_INSTALLER_SHA256+$PATCH_ID"

DOWNLOAD_ONLY=0
[[ "${1:-}" == "--download-only" ]] && DOWNLOAD_ONLY=1

mkdir -p "$CACHE_DIR" "$OUT_DIR"

if [[ $DOWNLOAD_ONLY == 0 && -f "$STAMP" && "$(cat "$STAMP")" == "$STAMP_VALUE" \
      && -d "$OUT_DIR/backend" && -f "$OUT_DIR/ui/index.html" ]]; then
  echo "fetch-cpn: $OUT_DIR already up to date"
  exit 0
fi

check_sha() { echo "$CPN_INSTALLER_SHA256  $1" | sha256sum -c --status; }

if [[ ! -f "$INSTALLER" ]] || ! check_sha "$INSTALLER"; then
  echo "fetch-cpn: downloading $CPN_INSTALLER_URL"
  # cpnide.org sometimes resets long transfers: retry and resume the partial file.
  for attempt in 1 2 3 4 5; do
    curl -fsSL --connect-timeout 30 --retry 5 --retry-all-errors --retry-delay 10 \
      -C - -o "$INSTALLER.part" "$CPN_INSTALLER_URL" && break
    [[ $attempt == 5 ]] && { echo "fetch-cpn: download failed" >&2; exit 1; }
    echo "fetch-cpn: download interrupted (attempt $attempt), resuming in 15s" >&2
    sleep 15
  done
  mv "$INSTALLER.part" "$INSTALLER"
fi
if ! check_sha "$INSTALLER"; then
  echo "fetch-cpn: SHA-256 mismatch for $INSTALLER" >&2
  echo "  expected $CPN_INSTALLER_SHA256" >&2
  echo "  actual   $(sha256sum "$INSTALLER" | cut -d' ' -f1)" >&2
  exit 1
fi
if [[ $DOWNLOAD_ONLY == 1 ]]; then
  echo "fetch-cpn: installer ready at $INSTALLER"
  exit 0
fi

WORK="$(mktemp -d "$CACHE_DIR/extract.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

if command -v innoextract >/dev/null 2>&1; then
  innoextract --silent -d "$WORK/x" "$INSTALLER"
else
  RT="$(command -v docker || command -v podman || true)"
  [[ -n "$RT" ]] || { echo "fetch-cpn: need innoextract, docker or podman" >&2; exit 1; }
  echo "fetch-cpn: innoextract not on PATH, using $RT (debian:bookworm-slim)"
  "$RT" run --rm -v "$CACHE_DIR:/cache:z" -w /cache debian:bookworm-slim bash -c \
    "apt-get update -qq && apt-get install -y -qq innoextract >/dev/null && \
     innoextract --silent -d /cache/$(basename "$WORK")/x /cache/$(basename "$INSTALLER")"
fi

RES="$WORK/x/app/resources"
[[ -d "$RES/backend" && -f "$RES/app.asar" ]] || { echo "fetch-cpn: unexpected installer layout" >&2; exit 1; }

npx --yes "@electron/asar@$ASAR_VERSION" extract "$RES/app.asar" "$WORK/asar"
[[ -f "$WORK/asar/dist/cpn-ide/index.html" ]] || { echo "fetch-cpn: dist/cpn-ide missing in app.asar" >&2; exit 1; }

rm -rf "$OUT_DIR/backend" "$OUT_DIR/ui"
cp -r "$RES/backend" "$OUT_DIR/backend"
cp -r "$WORK/asar/dist/cpn-ide" "$OUT_DIR/ui"
node "$ROOT/scripts/patch-cpnmld.mjs" "$OUT_DIR/backend/cpn-ide-back-1.28-SNAPSHOT.jar"
node "$ROOT/scripts/patch-ui.mjs" "$OUT_DIR/ui"
echo "$STAMP_VALUE" > "$STAMP"
"$ROOT/scripts/build-sockshim.sh"
echo "fetch-cpn: done -> $OUT_DIR/backend, $OUT_DIR/ui"
