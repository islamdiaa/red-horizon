#!/bin/bash
# Run net-lab matches under the lab's memory guard and heavy lock, starting the browser containers for the run
# and stopping them after it (the lock is held only while browsers run).
#   tools/net-lab/run.sh "<match.mjs args>" ["<match.mjs args>" ...]
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(cd "$here/../.." && pwd)"
mkdir -p /tmp/rh-lab
rc=0
for args in "$@"; do
  "$repo/tools/assets/memguard.sh" 6000
  flock /tmp/rh-lab/heavy.lock bash -c "
    '$here/netlab.sh' peers-up >/dev/null 2>&1 && sleep 4 &&
    node '$here/match.mjs' $args; r=\$?;
    '$here/netlab.sh' peers-down >/dev/null 2>&1; exit \$r" || rc=1
done
exit $rc
