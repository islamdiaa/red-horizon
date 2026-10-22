#!/bin/bash
# Net lab control (compose project rh-lab-net). See tools/net-lab/README.md.
#   netlab.sh build            copy-build the game into $NETLAB_DIST and build the images
#   netlab.sh up               start relay, game and routers, and set the routes
#   netlab.sh peers-up|peers-down   the two browser containers (heavy: run under memguard + the heavy lock)
#   netlab.sh routes           (re)apply the routes through the routers
#   netlab.sh shape <a|b|both> '<json>'   set a link profile, e.g. '{"both":{"delay_ms":40}}'
#   netlab.sh status | down
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
export NETLAB_DIST="${NETLAB_DIST:-/tmp/rh-lab/net/dist}"
dc() { docker compose -p rh-lab-net -f "$here/compose.yml" "$@"; }
route() { # <container> <dest subnet> <via>
  docker run --rm --network "container:$1" --cap-add NET_ADMIN rh-lab-net-tools ip route replace "$2" via "$3"
}
case "${1:-status}" in
  build)
    mkdir -p "$(dirname "$NETLAB_DIST")"
    (cd "$repo" && npx vite build --outDir "$NETLAB_DIST" --emptyOutDir --logLevel warn)
    docker build -q -t rh-lab-net-tools -f "$here/Dockerfile.tools" "$here"
    dc build -q relay ;;
  up)
    # the game's host ports must be free (or already ours): fail clearly rather than collide with another service
    for p in "${NETLAB_PORT:-8811}" "${NETLAB_VM_PORT:-8812}"; do
      if ss -ltnH "( sport = :$p )" 2>/dev/null | grep -q . && ! docker port rh-lab-net-game-1 2>/dev/null | grep -q ":$p\$"; then
        echo "netlab: port $p is in use by another service; set NETLAB_PORT / NETLAB_VM_PORT to free ports" >&2; exit 1
      fi
    done
    dc up -d relay game shaper-a shaper-b
    "$0" routes ;;
  routes)
    route rh-lab-net-game-1 10.231.101.0/24 10.231.0.11
    route rh-lab-net-game-1 10.231.102.0/24 10.231.0.12
    for p in a b; do
      if docker inspect -f '{{.State.Running}}' "rh-lab-net-peer-$p-1" 2>/dev/null | grep -q true; then
        n=$([ $p = a ] && echo 1 || echo 2)
        route "rh-lab-net-peer-$p-1" 10.231.200.0/24 "10.231.$n.2"
      fi
    done ;;
  peers-up)
    dc --profile peers up -d peer-a peer-b
    "$0" routes ;;
  peers-down)
    dc --profile peers stop -t 5 peer-a peer-b
    dc --profile peers rm -f peer-a peer-b ;;
  shape)
    for s in $([ "$2" = both ] && echo a b || echo "$2"); do
      ip=$([ $s = a ] && echo 10.231.1.2 || echo 10.231.2.2)
      curl -s -X POST --data "$3" "http://$ip:9000/" | head -c 400; echo
    done ;;
  status)
    dc --profile peers ps --format 'table {{.Name}}\t{{.Status}}'
    for ip in 10.231.1.2 10.231.2.2; do curl -s -m 2 "http://$ip:9000/" | head -c 300; echo; done ;;
  down)
    dc --profile peers down -v --remove-orphans ;;
  *) echo "usage: $0 build|up|routes|peers-up|peers-down|shape|status|down" >&2; exit 2 ;;
esac
