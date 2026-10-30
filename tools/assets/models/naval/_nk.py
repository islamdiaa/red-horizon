"""Shared helpers for the ship HD models (tools/assets/models/naval/*.py). Not a model (build.mjs skips files
starting with '_'). Model scripts load it with

    import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from _nk import *

It re-exports the aircraft / ground-vehicle helpers (../aircraft/_ak.py, ../vehicles/_vk.py).

Art rules for ships (seen from above at ~40 degrees over animated water, 70-160 px long at the default zoom):
  * the deck is the picture: dark non-skid (or teak) decks against light-grey superstructure, with crisp bright
    deck-edge lines, white deck markings, the faction emblem on the forecastle and team colour on turret roofs,
    funnel bands and the sheer strake;
  * hull sides haze grey over a black boot-topping band at the waterline (y = 0 is the water surface; the hull
    reaches ~0.05-0.1 below it and the water hides the antifouling red), white hull numbers on the bows;
  * running lights: red port / green starboard on the bridge wings, a white stern lamp, the masthead strobe as
    the animated 'glow:strobe' slot, lit bridge windows (baked emissive, they glow at night);
  * every bit of geometry hangs under the 'hull' part (the game bobs, rolls and sinks it).
Ships face +X; +Z is starboard.
"""
import math
import os
import sys

import bmesh

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'aircraft'))
from _ak import *  # noqa: E402,F401,F403
from _ak import lamp, HEAD, RED, AMBER, GREEN, WHITE_L, PI, ROT_X, ROT_Z, D, Mt, T, _emit  # noqa: E402,F401


# ---------------------------------------------------------------------------------------------------------
# palette

class NavPal:
    """Ship paint set: light haze-grey hull and superstructure, mid-grey decks, team trims. Tuned for the RTS camera:
    at the default zoom the ships must read as clearly as the procedural ones, so the hull and decks are
    as light as naval.ts and the weathering stays subtle (grime and streaks darken a 100-px ship to a silhouette)."""

    def __init__(self, fac='allies', hull=0x99a1a8, sup=0xc2c7cb, deck=0x686d71):
        self.fac = fac
        self.hull = painted(hull, panels=(0.14, 0.05), rivets=False, wear=0.35, rust=0.08, grime=0.26, streaks=0.45, rough=0.52, metal=0.22, var=0.06)
        self.hull_flat = painted(hull, panels=None, wear=0.35, rust=0.07, grime=0.26, streaks=0.4, rough=0.52, metal=0.22, var=0.06)
        self.sup = painted(sup, panels=None, wear=0.35, rust=0.05, grime=0.22, streaks=0.4, rough=0.5, metal=0.18, var=0.05)
        self.sup_dk = painted(0x9ba2a7, panels=None, wear=0.35, rust=0.05, grime=0.25, streaks=0.35, rough=0.5, metal=0.22, var=0.05)
        self.deck = painted(deck, panels=None, wear=0.2, rust=0.0, grime=0.25, streaks=0.05, rough=0.85, metal=0.05, var=0.1)
        self.teak = painted(0x8c6c4a, panels=None, wear=0.1, rust=0.0, grime=0.45, streaks=0.05, rough=0.85, metal=0.0, var=0.22)
        self.team = team(wear=0.4, grime=0.3, rust=0.08, panels=None, rough=0.48)
        self.dark = painted(0x3c4146, panels=None, wear=0.5, rust=0.12, grime=0.4, streaks=0.3, rough=0.55, metal=0.35, var=0.08)
        self.gun = metal(0x3a3e44, rough=0.4, rust=0.2, wear=0.45)
        self.black = metal(0x1b1c1f, rough=0.55, rust=0.15, wear=0.25, metal=0.6)
        self.boot = painted(0x1b1c1e, panels=None, wear=0.2, rust=0.2, grime=0.3, streaks=0.2, rough=0.6, metal=0.1, var=0.05)
        self.antifoul = painted(0x7a2a22, panels=None, wear=0.2, rust=0.3, grime=0.5, streaks=0.2, rough=0.75, metal=0.05, var=0.1)
        self.white = painted(0xdcdad2, panels=None, wear=0.35, rust=0.1, grime=0.3, rough=0.5, var=0.05)
        self.red = painted(0xa8261c, panels=None, wear=0.35, rust=0.0, grime=0.25, rough=0.45, var=0.05)
        self.orange = painted(0xd8601c, panels=None, wear=0.3, rust=0.0, grime=0.3, rough=0.55, var=0.05)
        self.olive = painted(0x4b5235, panels=None, wear=0.5, rust=0.08, grime=0.35, rough=0.55, var=0.1)
        self.yellow = painted(0xd8a418, panels=None, wear=0.5, rust=0.1, grime=0.35, rough=0.5, var=0.06)
        self.steel = metal(0x8e949a, rough=0.35, rust=0.1, wear=0.3)
        self.glass = glass(0x14273a)
        self.lit = glass(lit=0xffd49a, strength=1.3)
        self.soot = Mt.flat(0x0a0a0a, 0.95)
        self.canvas = cloth(0x6b6844, grime=0.45)
        self.brass = metal(0xb08a40, rough=0.35, rust=0.05, wear=0.2, metal=0.9)


# ---------------------------------------------------------------------------------------------------------
# hull (stations as the procedural naval.ts hullStations)

def _smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def stations(L, B, free, sheer, draft, bow, stern, rake, flare=1.06, n=16, round_=False):
    """Hull sections like the procedural naval.ts: [(x, [(z, y) deck edge -> keel]), ...] stern to bow."""
    out = []
    for i in range(n):
        u = i / (n - 1)
        t = -1 + 2 * (1 - math.pow(1 - u, 1.25))
        w = 1.0
        if t >= bow:
            k = (t - bow) / (1 - bow)
            w = math.pow(max(0.0, 1 - math.pow(k, 1.8)), 0.62)
        elif t < -0.55:
            k = (t + 1) / 0.45
            w = stern + (1 - stern) * (1 - (1 - k) * (1 - k))
        deck = free + sheer * _smoothstep(0.1, 1, t)
        keel = -draft
        if t > 0.5:
            keel *= 1 - 0.8 * math.pow((t - 0.5) / 0.5, 1.4)
        if t < -0.8:
            keel *= 1 - 0.45 * ((-0.8 - t) / 0.2)
        half = (B / 2) * w
        if round_:
            sec = [(half * 0.55, deck), (half * 0.92, deck * 0.55), (half, 0.012), (half * 0.99, -0.008), (half * 0.82, keel * 0.6), (0.0, keel)]
        else:
            sec = [(half * flare, deck), (half * (1 + (flare - 1) * 0.45), deck * 0.45), (half, 0.016), (half * 0.99, -0.012),
                   (half * 0.76, keel * 0.62), (0.0, keel)]
        pts = []
        for (z, y) in sec:
            frac = (deck - y) / max(1e-4, deck - keel)
            rk = rake * frac * math.pow(max(0.0, (t - 0.55) / 0.45), 2)
            pts.append(((t * L) / 2 - rk, z, y))
        out.append(pts)
    return out


class Hull:
    """A lofted hull: closed solid (deck, topsides, boot topping, bottom, transom). deck_at(x) / half_at(x)
    interpolate the deck line; add() builds it into a part."""

    def __init__(self, sts):
        self.st = sts

    def _interp(self, x, f):
        st = self.st
        if x <= st[0][0][0]:
            return f(st[0])
        for i in range(len(st) - 1):
            a, b = st[i][0][0], st[i + 1][0][0]
            if x <= b:
                return f(st[i]) + (f(st[i + 1]) - f(st[i])) * ((x - a) / max(1e-6, b - a))
        return f(st[-1])

    def deck_at(self, x):
        return self._interp(x, lambda s: s[0][2])

    def half_at(self, x):
        return self._interp(x, lambda s: s[0][1])

    @property
    def x0(self):
        return self.st[0][0][0]

    @property
    def x1(self):
        return max(p[0] for p in self.st[-1])

    def add(self, p, P, top=None, deck=None, boot=None, bottom=None):
        """Build into part p: rows 0-2 topsides (`top`), 2-3 boot topping, 3-5 bottom; deck across row 0."""
        top = top or P.hull
        deck = deck or P.deck
        boot = boot or P.boot
        bottom = bottom or P.antifoul
        uvname = Mt.ATLAS_UV
        mats = {'top': p.target(top)[1], 'deck': p.target(deck)[1], 'boot': p.target(boot)[1], 'bottom': p.target(bottom)[1]}
        sts = self.st

        def build(bm):
            uvl = bm.loops.layers.uv.get(uvname) or bm.loops.layers.uv.new(uvname)
            pre = bm.faces.layers.float.get('rh_preuv') or bm.faces.layers.float.new('rh_preuv')
            sm = bm.faces.layers.float.get('rh_smooth') or bm.faces.layers.float.new('rh_smooth')
            rows = len(sts[0])
            rings = []
            for st in sts:
                # ring: starboard deck edge -> keel -> port deck edge (keel shared)
                star = [bm.verts.new((x, y, z)) for (x, z, y) in st]
                port = []
                for j, (x, z, y) in enumerate(st):
                    if j == rows - 1 or z < 1e-5:
                        port.append(star[j])
                    else:
                        port.append(bm.verts.new((x, y, -z)))
                rings.append((star, port))
            faces = []
            arc = []
            for st in sts:
                acc = [0.0]
                for j in range(1, rows):
                    (xa, za, ya), (xb, zb, yb) = st[j - 1], st[j]
                    acc.append(acc[-1] + math.hypot(za - zb, ya - yb))
                arc.append(acc)

            def quad(vs, kind, uvs, smooth):
                uniq = []
                for v, uv in zip(vs, uvs):
                    if not uniq or uniq[-1][0] is not v:
                        uniq.append((v, uv))
                if len(uniq) > 1 and uniq[0][0] is uniq[-1][0]:
                    uniq.pop()
                if len(uniq) < 3:
                    return None
                try:
                    f = bm.faces.new([v for v, _ in uniq])
                except ValueError:
                    return None
                for lp, (_, uv) in zip(f.loops, uniq):
                    lp[uvl].uv = uv
                f.material_index = mats[kind]
                f[pre] = 1.0
                f[sm] = 1.0 if smooth else 0.0
                faces.append(f)
                return f
            for k in range(len(sts) - 1):
                (sa, pa), (sb, pb) = rings[k], rings[k + 1]
                xa, xb = sts[k][0][0], sts[k + 1][0][0]
                for j in range(rows - 1):
                    kind = 'top' if j < 2 else 'boot' if j < 3 else 'bottom'
                    va, vb = arc[k][j], arc[k + 1][j]
                    va1, vb1 = arc[k][j + 1], arc[k + 1][j + 1]
                    xs = (sa[j].co.x, sb[j].co.x, sb[j + 1].co.x, sa[j + 1].co.x)
                    quad([sa[j], sb[j], sb[j + 1], sa[j + 1]], kind, [(xs[0], -va), (xs[1], -vb), (xs[2], -vb1), (xs[3], -va1)], True)
                    quad([pa[j + 1], pb[j + 1], pb[j], pa[j]], kind,
                         [(xs[3], 0.6 + va1), (xs[2], 0.6 + vb1), (xs[1], 0.6 + vb), (xs[0], 0.6 + va)], True)
                # deck strip
                quad([pa[0], pb[0], sb[0], sa[0]], 'deck',
                     [(pa[0].co.x, pa[0].co.z), (pb[0].co.x, pb[0].co.z), (sb[0].co.x, sb[0].co.z), (sa[0].co.x, sa[0].co.z)], False)
            # transom
            s0, p0 = rings[0]
            loop = list(s0) + [v for v in reversed(p0[:-1])]
            uniq = []
            for v in loop:
                if v not in uniq:
                    uniq.append(v)
            try:
                f = bm.faces.new(uniq)
                f.material_index = mats['top']
                for lp in f.loops:
                    lp[uvl].uv = (lp.vert.co.z, lp.vert.co.y)
                f[pre] = 1.0
                faces.append(f)
            except ValueError:
                pass
            bmesh.ops.recalc_face_normals(bm, faces=faces)
            # outward check (signed volume): recalc can pick the inward orientation on thin open-ended rings
            vol = 0.0
            for f in faces:
                vs = [v.co for v in f.verts]
                for i in range(1, len(vs) - 1):
                    vol += vs[0].dot(vs[i].cross(vs[i + 1]))
            if vol < 0:
                bmesh.ops.reverse_faces(bm, faces=faces)
            for f in faces:
                kinds[f] = f.material_index
            return list({v for f in faces for v in f.verts})
        kinds = {}
        verts, faces = _emit(p, top, build, T((0, 0, 0)))
        for f, mi in kinds.items():
            if f.is_valid:
                f.material_index = mi
        return verts, faces


STRAKE_SCALE = 2.5  # the team sheer strake / hull band, relative to the widths the ship scripts pass (for readability)


def hull_dress(m, p, H, P, x0=None, x1=None, edge=0.008, strake=True, strake_w=0.016, inset=0.005, rail=None, segs=4):
    """Crisp bright deck edges: a light toe rail (geometry, worn by the bake) along both deck edges, station to
    station; and a broad team hull band (the sheer strake) just under the deck edge on the hull sides, the ship's
    strongest team-colour read from the RTS camera (a few decals: many decals on one material overflow the bake shader)."""
    strake_w *= STRAKE_SCALE
    rail = rail or P.sup
    x0 = H.x0 + 0.02 if x0 is None else x0
    x1 = H.x1 - 0.05 if x1 is None else x1
    xs = [st[0][0] for st in H.st if x0 <= st[0][0] <= x1]
    xs = sorted(set([x0] + xs + [x1]))
    for s in (-1, 1):
        for xa, xb in zip(xs, xs[1:]):
            a = (xa, H.deck_at(xa) + edge * 0.5, (H.half_at(xa) - inset) * s)
            b = (xb, H.deck_at(xb) + edge * 0.5, (H.half_at(xb) - inset) * s)
            bar(p, rail, a, b, edge)
        if strake:
            for i in range(segs):
                xa = x0 + (x1 - x0) * i / segs
                xb = x0 + (x1 - x0) * (i + 1) / segs
                ya = H.deck_at(xa) - strake_w * 0.62
                yb = H.deck_at(xb) - strake_w * 0.62
                za, zb = H.half_at(xa) * s, H.half_at(xb) * s
                nrm = (-(zb - za) * s, 0.0, (xb - xa) * s)
                m.decal(D.solid(TEAM_NEUTRAL), at=((xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2), size=(math.hypot(xb - xa, zb - za) + 0.01, strake_w),
                        normal=nrm, part=p, depth=0.04, team=1, rough=0.5)


def hull_number(m, p, H, x, text, h=0.04, color=0xe8e4da):
    """White hull number on both bows, just under the deck edge."""
    for s in (-1, 1):
        y = H.deck_at(x) - h * 0.85
        z = H.half_at(x) * s
        stencil(m, p, text, (x, y, z), h, facing='+z' if s > 0 else '-z', color=color, depth=0.03)


# ---------------------------------------------------------------------------------------------------------
# superstructure and fittings

def house(p, mat, x, y, w, h, d, roof=None, bevel=0.008, roof_t=0.012):
    """Deckhouse block (x centre, y = its base) with an optional roof cap overhanging a little."""
    box(p, mat, (w, h, d), (x, y + h / 2, 0), bevel=bevel)
    if roof is not None:
        box(p, roof, (w + 0.012, roof_t, d + 0.012), (x, y + h + roof_t / 2, 0), bevel=0.004)


def window_band(p, P, x0, x1, y, z, h=0.016, side=1):
    """Lit window band on a deckhouse side (z = the wall) from x0 to x1."""
    box(p, P.lit, (x1 - x0, h, 0.004), ((x0 + x1) / 2, y, (z + 0.001) * side))


def bridge(m, p, P, x, y, w, h, d, roof=None, wings=True):
    """Navigation bridge: block with a raked, lit window band on the front, side windows, bridge wings with the
    red (port) / green (starboard) running lights."""
    prism(p, P.sup, [(-w / 2, 0), (w / 2, 0), (w / 2 + h * 0.18, h * 0.62), (w / 2 + h * 0.06, h), (-w / 2, h)], d, (x, y, 0), bevel=0.006)
    # raked windows (front) + side windows
    box(p, P.lit, (0.006, h * 0.26, d * 0.84), (x + w / 2 + h * 0.13, y + h * 0.8, 0), (0, 0, 0.33))
    for s in (-1, 1):
        box(p, P.lit, (w * 0.6, h * 0.18, 0.004), (x + 0.01, y + h * 0.8, (d / 2 + 0.001) * s))
    if roof is not None:
        box(p, roof, (w + h * 0.1, 0.012, d + 0.012), (x + h * 0.03, y + h + 0.006, 0), bevel=0.003)
    if wings:
        box(p, P.sup, (w * 0.36, 0.01, d + 0.09), (x + w * 0.24, y + h * 0.62, 0), bevel=0.003)
        for s in (-1, 1):
            lamp(p, (x + w * 0.24, y + h * 0.62 + 0.012, (d / 2 + 0.045) * s), 0.008, GREEN if s > 0 else RED, 'steady', 3.6,
                 '+z' if s > 0 else '-z')


def funnel(m, p, P, name, x, y, r, h, rake=0.18):
    """Raked funnel: grey stack with a team band, sooty black cap; adds the smoke point `name` at the top."""
    c, s = math.cos(rake), math.sin(rake)
    rot = (0, 0, rake)
    top_x, top_y = x - s * h, y + c * h

    def at(k):
        return (x - s * h * k, y + c * h * k, 0)
    cyl(p, P.sup, r, h, at(0.5), rot, r2=r * 0.92, seg=12, bevel=0.004)
    cyl(p, P.team, r * 0.96, h * 0.16, at(0.72), rot, seg=12)
    cyl(p, P.black, r * 0.93, h * 0.1, at(0.95), rot, seg=12)
    cyl(p, P.soot, r * 0.78, 0.004, at(1.0), rot, seg=12)
    m.smoke(name, (top_x - s * 0.02, top_y + 0.02, 0), part=p)


def mast(p, P, x, y, h, yard=0.16, platform=True):
    """Tapered pole mast with a yard and a small platform; returns the top y."""
    cyl(p, P.dark, 0.011, h, (x, y + h / 2, 0), r2=0.007, seg=8)
    box(p, P.dark, (0.01, 0.008, yard), (x, y + h * 0.72, 0))
    if platform:
        box(p, P.dark, (0.05, 0.008, 0.06), (x, y + h * 0.55, 0), bevel=0.002)
    return y + h


def radar_part(m, parent, P, name, at, w=0.09):
    """Rotating radar antenna part (pivot on its post)."""
    r = m.part(name, parent=parent, at=at)
    cyl(r, P.dark, 0.007, 0.02, (0, 0.01, 0), seg=6)
    box(r, P.sup, (0.014, 0.024, w), (0, 0.03, 0), bevel=0.003)
    box(r, P.dark, (0.018, 0.006, w * 1.04), (0, 0.019, 0))
    return r


def raft(p, P, x, y, z, length=0.07, axis='x'):
    rot = ROT_X if axis == 'x' else ROT_Z
    cyl(p, P.white, 0.013, length, (x, y + 0.013, z), rot, seg=8, bevel=0.002)
    if axis == 'x':
        box(p, P.orange, (0.008, 0.028, 0.028), (x, y + 0.013, z))
    else:
        box(p, P.orange, (0.028, 0.028, 0.008), (x, y + 0.013, z))


def bollards(p, P, x, y, z, n=2, gap=0.024):
    for i in range(n):
        cyl(p, P.black, 0.007, 0.014, (x + i * gap, y + 0.007, z), seg=8)


def ciws(p, P, x, y, z):
    cyl(p, P.dark, 0.02, 0.022, (x, y + 0.011, z), r2=0.018, seg=10)
    cyl(p, P.white, 0.018, 0.03, (x - 0.004, y + 0.037, z), r2=0.016, seg=10)
    dome(p, P.white, 0.016, (x - 0.004, y + 0.052, z), seg=10, rings=3)
    cyl(p, P.black, 0.004, 0.05, (x + 0.03, y + 0.032, z), ROT_X, seg=6)


def boat(p, P, x, y, z, length=0.1):
    """Ship's boat on chocks: white hull with an orange canopy."""
    xloft(p, P.white, [(-length / 2, y + 0.018, 0.0, 0.0, 0.0), (-length * 0.42, y + 0.018, 0.016, 0.01, 0.016),
                       (length * 0.3, y + 0.018, 0.02, 0.01, 0.018), (length / 2, y + 0.02, 0.0, 0.0, 0.0)], seg=8, at=(x, 0, z))
    box(p, P.orange, (length * 0.5, 0.012, 0.028), (x - 0.005, y + 0.032, z), bevel=0.004)


def deck_hatch(m, p, at, size, facing='+y'):
    """Flush hatch / panel (decal outline)."""
    return m.decal(D.panel_outline(aspect=size[0] / size[1]), at=at, size=size, facing=facing, part=p, depth=0.015)


def deck_emblem(m, p, P, at, d, depth=0.03):
    """The faction emblem painted big on a deck: Allied white star in a white ring; Soviet gold star on a team disc."""
    if P.fac == 'soviet':
        m.decal(disc_image(ring=0xe8e4da, ring_w=0.08), at=at, size=(d * 1.06, d * 1.06), facing='+y', part=p, depth=depth, team=0,
                tint=D.lin(0x2b2e31), rough=0.7)
        team_disc(m, p, at, d * 0.86, '+y', depth=depth)
        emblem(m, p, 'soviet', at, d * 0.78, facing='+y', depth=depth)
    else:
        m.decal(disc_image(ring=0xe8e4da, ring_w=0.07), at=at, size=(d * 1.08, d * 1.08), facing='+y', part=p, depth=depth, team=0,
                tint=D.lin(0x2b2e31), rough=0.7)
        emblem(m, p, 'allied_star', at, d * 0.9, facing='+y', depth=depth)


def deck_line(m, p, a, b, width=0.008, color=0xe8e4da):
    """White / yellow painted deck line (decal on a '+y' surface)."""
    return strip(m, p, a, b, '+y', width, color=color, depth=0.015)


def nav_ship(p, P, stern, mast_top=None):
    """White stern lamp (and the masthead strobe as 'glow:strobe')."""
    lamp(p, stern, 0.008, WHITE_L, 'steady', 3.2, '-x')
    if mast_top is not None:
        strobe(p, mast_top, 0.009, WHITE_L)


def gunhouse(p, P, size, roof=True):
    """Naval gunhouse (sloped front and roof) in a turret part's frame, faces +X, sits on y = 0."""
    s = size
    prism(p, P.sup, [(-0.5 * s, 0), (0.5 * s, 0), (0.56 * s, 0.22 * s), (0.36 * s, 0.44 * s), (-0.46 * s, 0.44 * s), (-0.52 * s, 0.36 * s)],
          0.82 * s, (0, 0, 0), bevel=0.008)
    if roof:
        box(p, P.team, (0.8 * s, 0.012, 0.74 * s), (-0.05 * s, 0.446 * s, 0), bevel=0.004)
    cyl(p, P.dark, 0.44 * s, 0.05 * s, (0, -0.012 * s, 0), r2=0.42 * s, seg=12)


# ---------------------------------------------------------------------------------------------------------
# submarines

class SubPal(NavPal):
    """Submarine paint: near-black hull, a lighter casing, red-brown below the waterline (hidden by the water)."""

    def __init__(self, fac='soviet'):
        super().__init__(fac)
        self.hull = painted(0x41464b, panels=(0.16, 0.06), rivets=False, wear=0.35, rust=0.1, grime=0.24, streaks=0.45, rough=0.6, metal=0.2, var=0.06)
        self.hull_flat = painted(0x41464b, panels=None, wear=0.35, rust=0.08, grime=0.24, streaks=0.4, rough=0.6, metal=0.2, var=0.06)
        self.casing = painted(0x646b71, panels=None, wear=0.4, rust=0.08, grime=0.26, streaks=0.25, rough=0.72, metal=0.15, var=0.08)
        self.sail = painted(0x4a5056, panels=(0.06, 0.04), rivets=False, wear=0.4, rust=0.08, grime=0.24, streaks=0.4, rough=0.58, metal=0.2, var=0.06)


def sub_sail(m, p, P, sx, dy, number):
    """Conning tower (sail) at x = sx on the deck at dy: streamlined block, team band and cap, dark bridge cockpit,
    fairwater planes, the number and the star on both sides."""
    outline = [(0.11, 0.0), (0.07, 0.036), (-0.08, 0.036), (-0.12, 0.02), (-0.12, -0.02), (-0.08, -0.036), (0.07, -0.036)]
    loft(p, P.sail, [(dy + 0.0, [(sx + x, z) for (x, z) in outline]),
                     (dy + 0.14, [(sx + x * 0.94 - 0.006, z * 0.92) for (x, z) in outline])], bevel=0.006)
    loft(p, P.team, [(dy + 0.098, [(sx + x * 0.955 - 0.004, z * 0.955 + (0.0025 if z > 0 else -0.0025 if z < 0 else 0)) for (x, z) in outline]),
                     (dy + 0.118, [(sx + x * 0.95 - 0.005, z * 0.95 + (0.0025 if z > 0 else -0.0025 if z < 0 else 0)) for (x, z) in outline])])
    box(p, P.black, (0.1, 0.006, 0.046), (sx - 0.02, dy + 0.142, 0))
    for s in (-1, 1):
        box(p, P.sail, (0.05, 0.007, 0.06), (sx + 0.03, dy + 0.08, 0.062 * s), bevel=0.002)
        stencil(m, p, number, (sx - 0.035, dy + 0.045, 0.0352 * s), 0.024, facing='+z' if s > 0 else '-z', color=0xe8e4da)
        m.decal(D.soviet_star(color=0xc81e16, border=0xf0ece4), at=(sx + 0.035, dy + 0.06, 0.0345 * s), size=(0.03, 0.03),
                facing='+z' if s > 0 else '-z', part=p, depth=0.02, team=0)


def sub_masts(m, parent, P, at):
    """Periscopes, snorkel and the strobe (part 'masts': they stay above the water at periscope depth)."""
    ms = m.part('masts', parent=parent, at=at)
    cyl(ms, P.dark, 0.006, 0.14, (0.02, 0.07, 0), r2=0.005, seg=8)
    cyl(ms, P.dark, 0.005, 0.12, (-0.01, 0.06, 0.012), r2=0.004, seg=8)
    box(ms, P.dark, (0.018, 0.012, 0.012), (0.026, 0.14, 0), bevel=0.002)
    cyl(ms, P.dark, 0.009, 0.1, (-0.05, 0.05, 0), r2=0.008, seg=8)
    box(ms, P.dark, (0.02, 0.012, 0.016), (-0.05, 0.104, 0), bevel=0.002)
    sphere(ms, glow_material('glow:strobe', 0xff2414), 0.007, (-0.01, 0.125, 0.012), seg=8, rings=5)
    return ms


def sub_stern(m, p, P, x, prop_x, n_blades, span=0.07):
    """Cruciform stern planes + rudder, and the brass propeller part 'prop' (spins about X)."""
    for s in (-1, 1):
        box(p, P.hull_flat, (0.07, 0.007, span + 0.01), (x, -0.03, (span / 2 + 0.02) * s), bevel=0.002)
    box(p, P.hull_flat, (0.07, 0.12, 0.007), (x - 0.01, -0.02, 0), bevel=0.002)
    pr = m.part('prop', parent='hull', at=(prop_x, -0.035, 0))
    cyl(pr, P.brass, 0.012, 0.024, (0, 0, 0), ROT_X, r2=0.008, seg=8)
    for i in range(n_blades):
        a = 2 * PI * i / n_blades
        box(pr, P.brass, (0.008, 0.034, 0.018), (0, math.cos(a) * 0.022, math.sin(a) * 0.022), (a, 0.45, 0))
