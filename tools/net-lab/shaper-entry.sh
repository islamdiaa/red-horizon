#!/bin/sh
# Router container for pktem.py: the kernel forwards nothing itself (packets arriving on the two interfaces go to a
# silent blackhole table; local deliveries are resolved first by the local table), pktem forwards them instead.
set -e
ip route add blackhole default table 100
for dev in $(ls /sys/class/net | grep -v '^lo$'); do ip rule add iif "$dev" lookup 100 priority 100; done
exec python3 -u /net-lab/pktem.py
