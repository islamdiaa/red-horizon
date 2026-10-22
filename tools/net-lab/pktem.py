#!/usr/bin/env python3
"""
pktem: a userspace stand-in for `tc qdisc ... netem` on kernels built without sch_netem.

It runs inside a small router container with two interfaces: the "side" network (one player's machine) and
the "core" network (the game server). Every IPv4 packet routed through it is captured with an AF_PACKET socket,
put through a per-direction link model, and sent on with a raw IP socket, so real TCP (retransmissions,
congestion control, head-of-line blocking) runs end to end between the browser and the server:

  delay_ms   one-way delay
  jitter_ms  +/- uniform jitter (like netem, packets may reorder unless reorder is false)
  loss       independent random loss, 0..1
  rate_kbit  serialisation rate (0 = unlimited), with a tail-drop queue of queue_ms
  down       drop everything (a pulled cable or a dead Wi-Fi link: no RST, no FIN, just silence)

Docker drops packets for a container's address that arrive on another bridge, so the router also does a
stateless 1:1 subnet NAT (/24 prefixes): players dial the server's virtual address in VIRT_NET (10.231.200.x for
core host 10.231.0.x), and the server sees each player at its alias in ALIAS_NET (10.231.101.y for side host
10.231.1.y). Every TCP/UDP checksum is recomputed anyway (see fix_l4_checksum).

The kernel must not forward the packets itself: ip_forward=1 plus a policy rule that sends everything arriving on
the two interfaces to a blackhole table (silent, no ICMP), while local deliveries (the control API) and the raw
socket's own output use the normal tables. shaper-entry.sh sets that up.

Control API (HTTP on CTL_PORT, reached only from the docker bridge):
  GET  /           current profile and counters
  POST /           {"up": {...}, "down": {...}} or {"both": {...}}; missing fields keep their values
"""
import array
import heapq
import json
import os
import random
import select
import socket
import struct
import sys
import time

ETH_P_IP = 0x0800
PACKET_HOST = 0
FIELDS = {'delay_ms': 0.0, 'jitter_ms': 0.0, 'loss': 0.0, 'rate_kbit': 0.0, 'queue_ms': 500.0, 'down': False, 'reorder': True}


def iface_addr(name):
    import fcntl
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        return socket.inet_ntoa(fcntl.ioctl(s.fileno(), 0x8915, struct.pack('256s', name[:15].encode()))[20:24])
    finally:
        s.close()


def in_subnet(ip, cidr):
    net, bits = cidr.split('/')
    mask = (0xffffffff << (32 - int(bits))) & 0xffffffff
    a = struct.unpack('!I', socket.inet_aton(ip))[0]
    b = struct.unpack('!I', socket.inet_aton(net))[0]
    return (a & mask) == (b & mask)


def csum16(data):
    if len(data) & 1:
        data += b'\0'
    s = sum(array.array('H', data))
    while s >> 16:
        s = (s & 0xffff) + (s >> 16)
    return (~s) & 0xffff


def fix_l4_checksum(pkt):
    """Recompute the TCP/UDP checksum (packets captured off a veth may carry a partial, offloaded one)."""
    ihl = (pkt[0] & 15) * 4
    proto = pkt[9]
    if proto not in (6, 17):
        return bytes(pkt)
    b = bytearray(pkt)
    l4 = len(b) - ihl
    off = ihl + (16 if proto == 6 else 6)
    if len(b) < off + 2:
        return bytes(b)
    b[off:off + 2] = b'\0\0'
    pseudo = bytes(b[12:20]) + struct.pack('!BBH', 0, proto, l4)
    c = csum16(pseudo + bytes(b[ihl:]))
    if proto == 17 and c == 0:
        c = 0xffff
    struct.pack_into('=H', b, off, c)
    return bytes(b)


def segment(pkt, mtu):
    """Split a TSO/GSO super-packet (larger than the MTU) into MTU-sized TCP segments."""
    ihl = (pkt[0] & 15) * 4
    if len(pkt) <= mtu or pkt[9] != 6:
        return [pkt]
    thl = (pkt[ihl + 12] >> 4) * 4
    payload = pkt[ihl + thl:]
    mss = mtu - ihl - thl
    seq = struct.unpack('!I', pkt[ihl + 4:ihl + 8])[0]
    ipid = struct.unpack('!H', pkt[4:6])[0]
    flags = pkt[ihl + 13]
    out = []
    n = 0
    for off in range(0, len(payload), mss):
        chunk = payload[off:off + mss]
        last = off + mss >= len(payload)
        ip = bytearray(pkt[:ihl])
        tcp = bytearray(pkt[ihl:ihl + thl])
        struct.pack_into('!H', ip, 2, ihl + thl + len(chunk))
        struct.pack_into('!H', ip, 4, (ipid + n) & 0xffff)
        struct.pack_into('!I', tcp, 4, (seq + off) & 0xffffffff)
        f = flags
        if not last:
            f &= ~0x09  # FIN, PSH only on the last segment
        if n:
            f &= ~0x80  # CWR only on the first
        tcp[13] = f
        out.append(bytes(ip + tcp + chunk))
        n += 1
    return out


class Link:
    def __init__(self, name):
        self.name = name
        self.p = dict(FIELDS)
        self.free_at = 0.0
        self.last_out = 0.0
        self.c = {'in': 0, 'out': 0, 'lost': 0, 'queue_drop': 0, 'down_drop': 0, 'bytes': 0, 'err': 0}

    def set(self, d):
        for k, v in d.items():
            if k in FIELDS:
                self.p[k] = type(FIELDS[k])(v)

    def schedule(self, now, size):
        """Departure time of a packet, or None when it is dropped."""
        p = self.p
        self.c['in'] += 1
        if p['down']:
            self.c['down_drop'] += 1
            return None
        if p['loss'] > 0 and random.random() < p['loss']:
            self.c['lost'] += 1
            return None
        t = now
        if p['rate_kbit'] > 0:
            start = max(now, self.free_at)
            if start - now > p['queue_ms'] / 1000.0:
                self.c['queue_drop'] += 1
                return None
            self.free_at = start + size * 8 / (p['rate_kbit'] * 1000.0)
            t = self.free_at
        d = p['delay_ms']
        if p['jitter_ms'] > 0:
            d += random.uniform(-p['jitter_ms'], p['jitter_ms'])
        t += max(0.0, d) / 1000.0
        if not p['reorder']:
            t = max(t, self.last_out)
        self.last_out = max(self.last_out, t)
        return t


def main():
    side_net = os.environ['SIDE_SUBNET']
    core_net = os.environ['CORE_SUBNET']
    ctl_port = int(os.environ.get('CTL_PORT', '9000'))
    pfx = lambda cidr: socket.inet_aton(cidr.split('/')[0])[:3]
    side_p, core_p, virt_p, alias_p = pfx(side_net), pfx(core_net), pfx(os.environ['VIRT_NET']), pfx(os.environ['ALIAS_NET'])
    names = [n for _, n in socket.if_nameindex() if n != 'lo']
    side_if = core_if = None
    for n in names:
        try:
            ip = iface_addr(n)
        except OSError:
            continue
        if in_subnet(ip, side_net):
            side_if, side_ip = n, ip
        elif in_subnet(ip, core_net):
            core_if, core_ip = n, ip
    if not side_if or not core_if:
        print('pktem: interfaces not found', names, file=sys.stderr)
        sys.exit(2)
    mtu = {n: int(open(f'/sys/class/net/{n}/mtu').read()) for n in (side_if, core_if)}

    caps = {}
    for n in (side_if, core_if):
        s = socket.socket(socket.AF_PACKET, socket.SOCK_DGRAM, socket.htons(ETH_P_IP))
        s.bind((n, ETH_P_IP))
        try:
            s.setsockopt(socket.SOL_SOCKET, 33, 16 << 20)  # SO_RCVBUFFORCE
        except OSError:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 16 << 20)
        s.setblocking(False)
        caps[s.fileno()] = (s, n)
    out = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_RAW)
    try:
        out.setsockopt(socket.SOL_SOCKET, 32, 16 << 20)  # SO_SNDBUFFORCE
    except OSError:
        pass
    ctl = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    ctl.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    ctl.bind(('0.0.0.0', ctl_port))
    ctl.listen(8)
    ctl.setblocking(False)

    links = {'up': Link('up'), 'down': Link('down')}
    q = []
    seq = 0
    log = []
    print(f'pktem: side {side_if} {side_ip} ({side_net}) <-> core {core_if} {core_ip} ({core_net}); virtual server {os.environ["VIRT_NET"]}, side aliases {os.environ["ALIAS_NET"]}; control :{ctl_port}', flush=True)

    def state():
        return {'side': side_ip, 'core': core_ip, 'queued': len(q),
                'up': {**links['up'].p, **links['up'].c}, 'down': {**links['down'].p, **links['down'].c}, 'log': log[-20:]}

    def control(conn):
        conn.settimeout(2)
        try:
            data = b''
            while b'\r\n\r\n' not in data and len(data) < 65536:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                data += chunk
            head, _, body = data.partition(b'\r\n\r\n')
            lines = head.decode('latin1').split('\r\n')
            method = lines[0].split(' ')[0] if lines else ''
            clen = 0
            for ln in lines[1:]:
                if ln.lower().startswith('content-length:'):
                    clen = min(65536, int(ln.split(':', 1)[1].strip() or 0))
            while len(body) < clen:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                body += chunk
            if method == 'POST':
                d = json.loads(body or b'{}')
                if 'both' in d:
                    links['up'].set(d['both'])
                    links['down'].set(d['both'])
                for k in ('up', 'down'):
                    if k in d:
                        links[k].set(d[k])
                if d.get('reset'):
                    for l in links.values():
                        l.c = {k: 0 for k in l.c}
                log.append([round(time.time(), 3), d.get('label', ''), dict(links['up'].p)])
            resp = json.dumps(state()).encode()
            conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: '
                         + str(len(resp)).encode() + b'\r\n\r\n' + resp)
        except Exception as e:  # a broken control request must never stop the router
            try:
                msg = str(e).encode()
                conn.sendall(b'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: ' + str(len(msg)).encode() + b'\r\n\r\n' + msg)
            except Exception:
                pass
        finally:
            conn.close()

    rlist = [s for s, _ in caps.values()] + [ctl]
    while True:
        now = time.monotonic()
        while q and q[0][0] <= now:
            _, _, link, dst, pkt = heapq.heappop(q)
            try:
                out.sendto(pkt, (dst, 0))
                link.c['out'] += 1
                link.c['bytes'] += len(pkt)
            except OSError:
                link.c['err'] += 1
        timeout = max(0.0, q[0][0] - time.monotonic()) if q else 1.0
        ready, _, _ = select.select(rlist, [], [], timeout)
        for s in ready:
            if s is ctl:
                try:
                    conn, _ = ctl.accept()
                    control(conn)
                except OSError:
                    pass
                continue
            sock, ifname = caps[s.fileno()]
            for _ in range(256):
                try:
                    pkt, addr = sock.recvfrom(70000)
                except BlockingIOError:
                    break
                if addr[2] != PACKET_HOST or len(pkt) < 20 or (pkt[0] >> 4) != 4:
                    continue
                up = ifname == side_if
                # up: side host -> its alias, virtual server -> real server; down: the reverse
                if up and pkt[16:19] == virt_p and pkt[12:15] == side_p:
                    pkt = bytearray(pkt)
                    pkt[16:19] = core_p
                    pkt[12:15] = alias_p
                elif not up and pkt[16:19] == alias_p and pkt[12:15] == core_p:
                    pkt = bytearray(pkt)
                    pkt[16:19] = side_p
                    pkt[12:15] = virt_p
                else:
                    continue  # not ours to route (or for the router itself: the kernel delivers it)
                dst = socket.inet_ntoa(bytes(pkt[16:20]))
                link = links['up'] if up else links['down']
                out_if = core_if if up else side_if
                t = link.schedule(time.monotonic(), len(pkt))
                if t is None:
                    continue
                for seg in segment(pkt, mtu[out_if]):
                    seq += 1
                    heapq.heappush(q, (t, seq, link, dst, fix_l4_checksum(seg)))


if __name__ == '__main__':
    main()
