#!/bin/bash
# [PIPE] Memory guard for the shared box (Plex, Immich... run here too): wait until /proc/meminfo MemAvailable
# is at least <MB> (default 3072), polling every 30 s. Run it before starting a headless browser or Blender:
#   tools/assets/memguard.sh 3072 && node tools/assets/view.mjs ...
NEED=${1:-3072}
while true; do
  AVAIL=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)
  [ -z "$AVAIL" ] && exit 0
  [ "$AVAIL" -ge "$NEED" ] && exit 0
  echo "memguard: ${AVAIL} MB available, waiting for ${NEED} MB (checking every 30 s)"
  sleep 30
done
