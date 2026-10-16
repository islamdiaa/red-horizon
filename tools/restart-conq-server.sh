#!/bin/bash
# Restart the CONQ agent's stable (no-HMR) test dev server on port 5214.
cd "$(dirname "$0")/.."
PID=$(ss -ltnp 2>/dev/null | awk '/:5214 /{print $NF}' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
[ -n "$PID" ] && kill "$PID" 2>/dev/null
sleep 1
nohup npx vite --config tools/vite.conq.config.ts > /tmp/vite5214.log 2>&1 &
for i in $(seq 1 30); do sleep 0.5; grep -q "Local" /tmp/vite5214.log && break; done
echo "conq server ready"
