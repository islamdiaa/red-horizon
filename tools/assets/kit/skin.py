"""Skinned geometry for rigged models (infantry, dogs): bone weights on a part's mesh, smooth tubes for limbs and
torsos, rigid pieces from the ordinary kit shapes.

    sk = Skin(m, HUMAN)                    # adds a 'skin' part (cull=False) whose geometry is skinned
    sk.tube(cloth_mat, [ring(p0, 0.02, 0.02, {'thigh_l': 1}), ring(p1, ...)], seg=8)
    sk.rigid(box(sk.part, metal(), (0.02, 0.03, 0.1), at), 'weapon')   # any kit shape, rigid on one bone
    sk.blend(verts, lambda co: {'hips': 0.5, 'thigh_l': 0.5})           # custom weights

Weights live in the part's bmesh deform layer (group index = bone index); kit.vat.write_skinned exports them as
JOINTS_0 / WEIGHTS_0 (at most 2 influences per vertex: the game's crowd shader reads two).
"""
import math

import bmesh
from mathutils import Vector

from . import materials as Mt
from .core import vec


class Ring:
    """A tube cross-section: centre, half widths (a = across / side, b = front-back), bone weights, optional
    `side` direction (default: the tube's lateral axis from the front hint)."""

    def __init__(self, at, a, b=None, w=None, side=None, front_bias=0.0):
        self.at = vec(at)
        self.a = float(a)
        self.b = float(a if b is None else b)
        self.w = dict(w or {})
        self.side = vec(side) if side is not None else None
        self.front_bias = float(front_bias)  # >0 pushes the front half out (chests, calves: + back)


def ring(at, a, b=None, w=None, side=None, front_bias=0.0):
    return Ring(at, a, b, w, side, front_bias)


def mix(*pairs):
    """mix(('hips', 0.6), ('spine', 0.4)) -> {'hips': 0.6, 'spine': 0.4} (normalised)."""
    d = {}
    for n, w in pairs:
        if w > 1e-4:
            d[n] = d.get(n, 0.0) + float(w)
    s = sum(d.values()) or 1.0
    return {n: w / s for n, w in d.items()}


def blend_w(a, b, k):
    """Weights a -> b by k (0..1)."""
    out = {}
    for n, w in a.items():
        out[n] = out.get(n, 0.0) + w * (1 - k)
    for n, w in b.items():
        out[n] = out.get(n, 0.0) + w * k
    return {n: w for n, w in out.items() if w > 1e-4}


class Skin:
    def __init__(self, m, skeleton, part='skin'):
        self.m = m
        self.sk = skeleton
        self.part = m.part(part, cull=False) if part not in m.parts else m.parts[part]
        self.part.cull = False
        self.part.skin = self
        m.skin = self
        m.meta['rig'] = skeleton.name
        self.bm = self.part.bm
        self.dl = self.bm.verts.layers.deform.verify()

    # ---- weights
    def set_w(self, v, w):
        d = v[self.dl]
        d.clear()
        for n, x in w.items():
            d[self.sk.index[n]] = x

    def rigid(self, res, bone):
        """res = (verts, faces) returned by a kit shape (box, cyl, lathe, sphere...) added to self.part."""
        verts = res[0] if isinstance(res, tuple) else res
        for v in verts:
            if v.is_valid:
                self.set_w(v, {bone: 1.0})
        return res

    def blend(self, res, fn):
        """fn(co: Vector, game frame) -> weights dict."""
        verts = res[0] if isinstance(res, tuple) else res
        for v in verts:
            if v.is_valid:
                self.set_w(v, fn(v.co))
        return res

    # ---- tubes
    def tube(self, mats, rings, seg=8, front=(1, 0, 0), cap0=False, cap1=False, uv_scale=1.0):
        """A smooth tube through `rings` (Ring list, bottom/start to top/end). mats: one material, or one per segment
        (len(rings) - 1). front: the direction the ring's 'b' half-width faces (the body's front). The ring's
        vertex 0 faces front; vertices go front -> side(+) -> back -> side(-)."""
        bm = self.bm
        n = len(rings)
        if isinstance(mats, (list, tuple)):
            mlist = list(mats)
        else:
            mlist = [mats] * (n - 1)
        uvl = bm.loops.layers.uv.get(Mt.ATLAS_UV) or bm.loops.layers.uv.new(Mt.ATLAS_UV)
        pre = bm.faces.layers.float.get('rh_preuv') or bm.faces.layers.float.new('rh_preuv')
        sm = bm.faces.layers.float.get('rh_smooth') or bm.faces.layers.float.new('rh_smooth')
        F = vec(front)
        # tangents along the path
        tans = []
        for i in range(n):
            a = rings[max(0, i - 1)].at
            b = rings[min(n - 1, i + 1)].at
            t = b - a
            tans.append(t.normalized() if t.length > 1e-7 else Vector((0, 1, 0)))
        V = []
        arcs = []
        for i, r in enumerate(rings):
            t = tans[i]
            fr = F - t * F.dot(t)
            if fr.length < 1e-5:
                fr = Vector((0, 0, 1)) - t * t.z
            fr.normalize()
            sd = r.side.normalized() if r.side is not None else t.cross(fr).normalized()
            if r.side is not None:
                fr = sd.cross(t).normalized()
            row = []
            for k in range(seg):
                ang = 2 * math.pi * k / seg
                ca, sa = math.cos(ang), math.sin(ang)
                bb = r.b * (1 + (r.front_bias if ca > 0 else -r.front_bias * 0.5) * abs(ca))
                p = r.at + fr * (ca * bb) + sd * (sa * r.a)
                v = bm.verts.new(p)
                self.set_w(v, r.w)
                row.append(v)
            V.append(row)
            # ring circumference (ellipse, Ramanujan) for the u scale
            h = ((r.a - r.b) ** 2) / max(1e-9, (r.a + r.b) ** 2)
            arcs.append(math.pi * (r.a + r.b) * (1 + 3 * h / (10 + math.sqrt(4 - 3 * h))))
        # v coordinate: cumulative length
        vs = [0.0]
        for i in range(1, n):
            vs.append(vs[-1] + (rings[i].at - rings[i - 1].at).length)
        faces = []
        for i in range(n - 1):
            mat = mlist[min(i, len(mlist) - 1)]
            mi = self.part.mat_index(mat)
            for k in range(seg):
                k2 = (k + 1) % seg
                f = bm.faces.new((V[i][k], V[i][k2], V[i + 1][k2], V[i + 1][k]))
                f.material_index = mi
                f[sm] = 1.0
                f[pre] = 1.0
                # quarter-turn islands (pack tightly), u = arc length
                q = (k * 4) // seg
                k0 = q * seg // 4
                for lp, (ri, kk) in zip(f.loops, ((i, k), (i, k2 if k2 else seg), (i + 1, k2 if k2 else seg), (i + 1, k))):
                    u = (kk - k0) / seg * (arcs[ri]) * uv_scale
                    lp[uvl].uv = (u, vs[ri] * uv_scale)
                faces.append(f)
        caps = []
        capdir = []
        for (cap, i) in ((cap0, 0), (cap1, n - 1)):
            if not cap:
                continue
            row = V[i] if i == n - 1 else list(reversed(V[i]))
            c = bm.verts.new(rings[i].at + tans[i] * (rings[i].a * 0.35 * (1 if i == n - 1 else -1)) * (1 if cap == 'dome' else 0))
            self.set_w(c, rings[i].w)
            mat = mlist[min(max(i - 1, 0), len(mlist) - 1)]
            mi = self.part.mat_index(mat)
            for k in range(seg):
                k2 = (k + 1) % seg
                f = bm.faces.new((row[k], row[k2], c))
                f.material_index = mi
                f[sm] = 1.0
                caps.append(f)
                capdir.append(tans[i] * (1 if i == n - 1 else -1))
        for f in faces + caps:
            f.normal_update()
        # outward normals: compare with the ring centre
        for i in range(n - 1):
            for k in range(seg):
                f = faces[i * seg + k]
                c = f.calc_center_median()
                ax = (rings[i].at + rings[i + 1].at) * 0.5
                if f.normal.dot(c - ax) < 0:
                    f.normal_flip()
        for f, d in zip(caps, capdir):
            if f.normal.dot(d) < 0:
                f.normal_flip()
        allv = [v for row in V for v in row]
        return allv, faces + caps


def cap_normals_out(faces, centre):
    """Flip faces whose normal points towards `centre` (closed blobs: heads, hands, boots)."""
    for f in faces:
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - vec(centre)) < 0:
            f.normal_flip()
