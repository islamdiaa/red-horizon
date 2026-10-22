#!/usr/bin/env python3
"""Write a tiny ISO 9660 + Joliet image holding a few files in its root directory.

Used for the Windows answer media (autounattend.xml + first-logon script), so the lab needs no
mkisofs/xorriso. Usage: mkiso.py <out.iso> <VOLUME_LABEL> <file>... (stored by basename)
"""
import os
import struct
import sys
import time

SECTOR = 2048


def both16(n):
    return struct.pack('<H', n) + struct.pack('>H', n)


def both32(n):
    return struct.pack('<I', n) + struct.pack('>I', n)


def dir_date(t):
    return bytes([t.tm_year - 1900, t.tm_mon, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec, 0])


def vd_date(t):
    return time.strftime('%Y%m%d%H%M%S', t).encode() + b'00' + b'\x00'


def dir_record(ident, extent, size, is_dir, t):
    n = len(ident)
    rec = struct.pack('<BB', 0, 0) + both32(extent) + both32(size) + dir_date(t)
    rec += bytes([2 if is_dir else 0, 0, 0]) + both16(1) + bytes([n]) + ident
    if n % 2 == 0:
        rec += b'\x00'
    return bytes([len(rec)]) + rec[1:]


def pad_text(s, n, joliet=False):
    if joliet:
        b = s.encode('utf-16-be')[: n - (n % 2)]
        while len(b) < n:
            b += b'\x00 ' if n - len(b) >= 2 else b' '
        return b
    return s.encode('ascii')[:n].ljust(n, b' ')


def primary_name(name, used):
    stem, _, ext = name.upper().rpartition('.') if '.' in name else (name.upper(), '', '')
    ok = lambda s: ''.join(c if c.isalnum() or c == '_' else '_' for c in s)
    stem, ext = ok(stem)[:8] or 'F', ok(ext)[:3]
    cand, i = stem, 1
    while (cand, ext) in used:
        cand = (stem[:6] + '_' + str(i))[:8]
        i += 1
    used.add((cand, ext))
    return f'{cand}.{ext};1'.encode()


def main():
    out, label, paths = sys.argv[1], sys.argv[2], sys.argv[3:]
    t = time.gmtime()
    files = []
    used = set()
    for p in sorted(paths, key=lambda p: os.path.basename(p).lower()):
        data = open(p, 'rb').read()
        files.append((os.path.basename(p), primary_name(os.path.basename(p), used), data))

    # Layout: 16 system sectors, PVD, SVD (Joliet), terminator, 4 path tables, 2 root dirs, files.
    pvd_lba, svd_lba, term_lba = 16, 17, 18
    lpt_p, mpt_p, lpt_j, mpt_j = 19, 20, 21, 22
    root_p, root_j = 23, 24
    lba = 25
    extents = []
    for _, _, data in files:
        extents.append(lba)
        lba += max(1, (len(data) + SECTOR - 1) // SECTOR)
    total = lba

    def root_dir(joliet, root_lba):
        recs = dir_record(b'\x00', root_lba, SECTOR, True, t) + dir_record(b'\x01', root_lba, SECTOR, True, t)
        entries = []
        for (name, pname, data), ext in zip(files, extents):
            ident = name.encode('utf-16-be') if joliet else pname
            entries.append((ident, dir_record(ident, ext, len(data), False, t)))
        for _, r in sorted(entries):
            recs += r
        assert len(recs) <= SECTOR, 'too many files for one directory sector'
        return recs.ljust(SECTOR, b'\x00')

    def path_table(root_lba, big_endian):
        fmt = '>I' if big_endian else '<I'
        pfmt = '>H' if big_endian else '<H'
        return (bytes([1, 0]) + struct.pack(fmt, root_lba) + struct.pack(pfmt, 1) + b'\x00\x00').ljust(SECTOR, b'\x00')

    def vd(joliet):
        root_lba = root_j if joliet else root_p
        d = bytearray(SECTOR)
        d[0] = 2 if joliet else 1
        d[1:6] = b'CD001'
        d[6] = 1
        d[8:40] = pad_text('', 32, joliet)
        d[40:72] = pad_text(label, 32, joliet)
        d[80:88] = both32(total)
        if joliet:
            d[88:91] = b'%/E'  # UCS-2 level 3
        d[120:124] = both16(1)
        d[124:128] = both16(1)
        d[128:132] = both16(SECTOR)
        d[132:140] = both32(10)
        d[140:144] = struct.pack('<I', lpt_j if joliet else lpt_p)
        d[148:152] = struct.pack('>I', mpt_j if joliet else mpt_p)
        d[156:190] = dir_record(b'\x00', root_lba, SECTOR, True, t)
        for a, b in ((190, 318), (318, 446), (446, 574), (574, 702)):
            d[a:b] = pad_text('', b - a, joliet)
        for a, b in ((702, 739), (739, 776), (776, 813)):
            d[a:b] = pad_text('', b - a, joliet)
        d[813:830] = vd_date(t)
        d[830:847] = vd_date(t)
        d[847:864] = b'0' * 16 + b'\x00'
        d[864:881] = b'0' * 16 + b'\x00'
        d[881] = 1
        return bytes(d)

    term = bytearray(SECTOR)
    term[0] = 255
    term[1:6] = b'CD001'
    term[6] = 1

    with open(out, 'wb') as f:
        f.write(b'\x00' * SECTOR * 16)
        f.write(vd(False))
        f.write(vd(True))
        f.write(bytes(term))
        f.write(path_table(root_p, False))
        f.write(path_table(root_p, True))
        f.write(path_table(root_j, False))
        f.write(path_table(root_j, True))
        f.write(root_dir(False, root_p))
        f.write(root_dir(True, root_j))
        for (_, _, data), ext in zip(files, extents):
            assert f.tell() == ext * SECTOR
            n = max(1, (len(data) + SECTOR - 1) // SECTOR)
            f.write(data.ljust(n * SECTOR, b'\x00'))


if __name__ == '__main__':
    main()
