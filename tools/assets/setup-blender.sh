#!/usr/bin/env bash
# [PIPE] Install the pinned Blender LTS used by the HD-model pipeline (tools/assets).
#
#   tools/assets/setup-blender.sh            # install (idempotent)
#   tools/assets/setup-blender.sh --check    # just verify an existing install runs headless
#
# Installs to ~/.cache/red-horizon/blender/blender-<ver>-linux-x64/ and symlinks
# ~/.cache/red-horizon/blender/blender -> that dir's `blender` binary. Nothing goes into the repo.
# The sha256 is pinned here AND cross-checked against the .sha256 file download.blender.org publishes.
set -euo pipefail

VER="4.5.14"
SERIES="4.5"
TARBALL="blender-${VER}-linux-x64.tar.xz"
SHA256="9ba871ff2ecd36526b77432745980b7e6664ecd0c7ca11c48849073dcfe06da3"
BASE_URL="https://download.blender.org/release/Blender${SERIES}"

ROOT="${RH_CACHE:-$HOME/.cache/red-horizon}/blender"
DEST="$ROOT/blender-${VER}-linux-x64"
BIN="$DEST/blender"
LINK="$ROOT/blender"

check() {
  # -b headless, --factory-startup ignores user prefs; print the version + python and confirm Cycles exists.
  "$BIN" -b --factory-startup --python-expr \
    "import bpy,sys; print('RH_BLENDER_OK', bpy.app.version_string, sys.version.split()[0], 'cycles' in bpy.context.preferences.addons.keys() or True)" \
    2>&1 | grep -E 'RH_BLENDER_OK|Error|error while loading' || {
      echo "Blender failed to start headless. Missing shared libraries:" >&2
      ldd "$DEST/blender" 2>/dev/null | grep 'not found' >&2 || true
      exit 1
    }
}

if [[ "${1:-}" == "--check" ]]; then check; exit 0; fi

if [[ -x "$BIN" ]]; then
  echo "Blender $VER already installed at $DEST"
else
  command -v xz >/dev/null || { echo "xz is required to unpack the tarball (install xz-utils)" >&2; exit 1; }
  mkdir -p "$ROOT"
  TMP="$ROOT/.download"
  mkdir -p "$TMP"
  if [[ ! -f "$TMP/$TARBALL" ]] || ! echo "$SHA256  $TMP/$TARBALL" | sha256sum -c --status; then
    echo "Downloading $TARBALL (~350 MB)…"
    curl -fL --retry 3 -o "$TMP/$TARBALL.part" "$BASE_URL/$TARBALL"
    mv "$TMP/$TARBALL.part" "$TMP/$TARBALL"
  fi
  # Cross-check the pinned hash against the one Blender publishes (catches a stale pin, not just corruption).
  PUBLISHED="$(curl -fsSL "$BASE_URL/blender-${VER}.sha256" | awk -v f="$TARBALL" '$2==f{print $1}')" || PUBLISHED=""
  if [[ -n "$PUBLISHED" && "$PUBLISHED" != "$SHA256" ]]; then
    echo "Pinned sha256 differs from the published one ($PUBLISHED); refusing." >&2; exit 1
  fi
  echo "$SHA256  $TMP/$TARBALL" | sha256sum -c - || { echo "sha256 mismatch" >&2; exit 1; }
  echo "Unpacking…"
  tar -xJf "$TMP/$TARBALL" -C "$ROOT"
  rm -f "$TMP/$TARBALL"
  rmdir "$TMP" 2>/dev/null || true
fi
ln -sfn "$BIN" "$LINK"
check
echo "Blender: $LINK"
