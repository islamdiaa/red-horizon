#!/bin/bash
# (Re)start a no-HMR vite test server for HD-model checks: tools/assets/restart-view-server.sh [port=5231]
# Needs tools/vite.<name>.config.ts with that port (copy tools/vite.test.config.ts). Restart after building a NEW
# model: vite's public-file list is frozen when file watching is off, so new .glb files 404 (index.html) until then.
cd "$(dirname "$0")/../.."
PORT=${1:-5231}
CFG=$(grep -l "port: $PORT" tools/vite.*.config.ts | head -1)
[ -z "$CFG" ] && { echo "no tools/vite.*.config.ts with port $PORT"; exit 1; }
PID=$(ss -ltnp 2>/dev/null | awk "/:$PORT /{print \$NF}" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
[ -n "$PID" ] && kill "$PID" 2>/dev/null
sleep 1
nohup npx vite --config "$CFG" > "/tmp/vite$PORT.log" 2>&1 &
for i in $(seq 1 30); do sleep 0.5; grep -q "Local" "/tmp/vite$PORT.log" && break; done
echo "view server ready on :$PORT ($CFG)"
