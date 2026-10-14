#!/bin/bash
# Restart the stable (no-HMR) test dev server on port 5181.
cd "$(dirname "$0")/.."
PID=$(ss -ltnp 2>/dev/null | awk '/:5181 /{print $NF}' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
[ -n "$PID" ] && kill "$PID" 2>/dev/null
sleep 1
nohup npx vite --config tools/vite.test.config.ts > /tmp/vite5181.log 2>&1 &
for i in $(seq 1 20); do sleep 0.5; grep -q "Local" /tmp/vite5181.log && break; done
echo "test server ready"
