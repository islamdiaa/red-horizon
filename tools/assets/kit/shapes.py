"""Modelling helpers. All take a Part (geometry goes into the part's local GAME frame: x east, y up, z
south / front) and a material from kit.materials; sizes in game units (1 = one map cell). Rotations are
three.js-style XYZ Euler radians. Helpers that add decals take the Model (`m`) as well.

Triangle budget reminders (see README): structures ~3k-8k, vehicles ~2k-5k. Small detail (rivets, seams,
vents, grilles, text) should be decals (free) rather than geometry; use geometry for silhouettes.
"""
import math
import random

import bmesh
from mathutils import Matrix, Vector

from . import decals as D
from . import materials as Mt
from .core import T, euler3, facing_rot, vec


# ---------------------------------------------------------------------------------------------------------
# plumbing

def _emit(part, mat, build, M):
    """Run build(bm) -> new verts in a fresh area of the part's bmesh, assign material, transform by M."""
    bm, mi = part.target(mat)
    before = set(bm.faces)
    verts = build(bm)
    faces = set()
    for v in verts:
        faces.update(v.link_faces)
    faces -= before
    for f in faces:
        f.material_index = mi
    bmesh.ops.transform(bm, matrix=M, verts=list(verts))
    return verts, faces


def _mark_edges(bm, faces):
    """Flag chamfer faces (face attribute 'rh_edge'): the bake treats them as worn edges."""
    lay = bm.faces.layers.float.get('rh_edge') or bm.faces.layers.float.new('rh_edge')
    for f in faces:
        if f.is_valid:
            f[lay] = 1.0


def _round_uv(bm, verts):
    """Preset atlas UVs for round primitives (local frame, axis = Y): cylindrical strips on the sides (one
    seam), planar discs on the caps. Smart UV project shatters many-sided cylinders into single-face islands;
    these faces skip it (face attribute 'rh_preuv') and are only scaled / packed."""
    from .materials import ATLAS_UV
    uvl = bm.loops.layers.uv.get(ATLAS_UV) or bm.loops.layers.uv.new(ATLAS_UV)
    pre = bm.faces.layers.float.get('rh_preuv') or bm.faces.layers.float.new('rh_preuv')
    vs = [v for v in verts if v.is_valid]
    if not vs:
        return
    rr = max(1e-4, sum(math.hypot(v.co.x, v.co.z) for v in vs) / len(vs))
    for f in {f for v in vs for f in v.link_faces}:
        f.normal_update()  # (bmesh.ops.rotate leaves the cached normals stale)
        n = f.normal
        if abs(n.y) > 0.75:
            for lp in f.loops:
                lp[uvl].uv = (lp.vert.co.x, lp.vert.co.z)
        else:
            angs = [math.atan2(-lp.vert.co.z, lp.vert.co.x) for lp in f.loops]
            if max(angs) - min(angs) > math.pi:
                angs = [a + 2 * math.pi if a < 0 else a for a in angs]
            for lp, a in zip(f.loops, angs):
                lp[uvl].uv = (a * rr, lp.vert.co.y)
        f[pre] = 1.0


def _bevel_edges(bm, verts, b, seg=1):
    if b <= 0:
        return verts
    edges = list({e for v in verts for e in v.link_edges})
    res = bmesh.ops.bevel(bm, geom=edges, offset=b, offset_type='OFFSET', segments=seg, profile=0.5,
                          affect='EDGES', clamp_overlap=True)
    _mark_edges(bm, res.get('faces', []))
    vs = set(verts) | set(res.get('verts', []))
    return [v for v in vs if v.is_valid]


def _verts_of(geom):
    return [g for g in geom if isinstance(g, bmesh.types.BMVert)]


# ---------------------------------------------------------------------------------------------------------
# primitives

def box(p, mat, size, at=(0, 0, 0), rot=None, bevel=0.0, seg=1):
    """Box of size (w, h, d) centred at `at`. bevel = chamfer size (geometry; keep it for big silhouettes,
    small edges get the shader bevel anyway)."""
    w, h, d = size
    b = min(bevel, w * 0.3, h * 0.3, d * 0.3)

    def build(bm):
        vs = bmesh.ops.create_cube(bm, size=1.0)['verts']
        bmesh.ops.scale(bm, vec=(w, h, d), verts=vs)
        return _bevel_edges(bm, vs, b, seg) if b > 0.0005 else vs
    return _emit(p, mat, build, T(at, rot))


def slab(p, mat, x0, x1, y0, y1, z0, z1, bevel=0.0):
    """Box from min/max extents."""
    return box(p, mat, (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), bevel=bevel)


def cyl(p, mat, r, h, at=(0, 0, 0), rot=None, r2=None, seg=12, caps=True, bevel=0.0):
    """Cylinder / cone along local Y, centred at `at`: bottom radius r, top radius r2 (default r)."""
    rt = r if r2 is None else r2

    def build(bm):
        vs = bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r, radius2=rt, depth=h)['verts']
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, 'X'))
        if bevel > 0 and caps:
            # chamfer only the rims
            rims = [e for v in vs for e in v.link_edges if len(e.link_faces) == 2 and
                    abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.3]
            res = bmesh.ops.bevel(bm, geom=list(set(rims)), offset=min(bevel, h * 0.3, min(r, rt) * 0.3), offset_type='OFFSET',
                                  segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
            _mark_edges(bm, res.get('faces', []))
            vs = [v for v in set(vs) | set(res.get('verts', [])) if v.is_valid]
        _round_uv(bm, vs)
        return vs
    return _emit(p, mat, build, T(at, rot))


def _orient(a, b):
    """Matrix placing local +Y along a->b, origin at the midpoint; returns (M, length)."""
    a, b = vec(a), vec(b)
    d = b - a
    L = d.length
    q = Vector((0, 1, 0)).rotation_difference(d.normalized() if L > 1e-9 else Vector((0, 1, 0)))
    M = q.to_matrix().to_4x4()
    M.translation = (a + b) / 2
    return M, L


def cyl_between(p, mat, a, b, r, seg=8, caps=True, r2=None):
    M, L = _orient(a, b)
    rt = r if r2 is None else r2

    def build(bm):
        vs = bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r, radius2=rt, depth=L)['verts']
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, 'X'))
        _round_uv(bm, vs)
        return vs
    return _emit(p, mat, build, M)


def bar(p, mat, a, b, w, h=None, roll=0.0):
    """Square (w x w) or rectangular (w x h) bar from a to b (rails, rungs, struts, frames)."""
    M, L = _orient(a, b)
    h = w if h is None else h

    def build(bm):
        vs = bmesh.ops.create_cube(bm, size=1.0)['verts']
        bmesh.ops.scale(bm, vec=(w, L, h), verts=vs)
        if roll:
            bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(roll, 3, 'Y'))
        return vs
    return _emit(p, mat, build, M)


def sphere(p, mat, r, at=(0, 0, 0), seg=12, rings=8, scale=None, rot=None):
    def build(bm):
        vs = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)['verts']
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, 'X'))
        _round_uv(bm, vs)
        return vs
    return _emit(p, mat, build, T(at, rot, scale))


def lathe(p, mat, profile, at=(0, 0, 0), seg=16, rot=None, scale=None, cap_top=True, cap_bottom=True):
    """Surface of revolution around local Y: profile = [(radius, y), ...] bottom to top."""
    def build(bm):
        rings = []
        for (r, y) in profile:
            ring = []
            for i in range(seg):
                a = 2 * math.pi * i / seg
                ring.append(bm.verts.new((math.cos(a) * r, y, -math.sin(a) * r)))
            rings.append(ring)
        vs = [v for ring in rings for v in ring]
        for k in range(len(rings) - 1):
            A, B = rings[k], rings[k + 1]
            for i in range(seg):
                j = (i + 1) % seg
                bm.faces.new((A[i], A[j], B[j], B[i]))
        if cap_bottom and profile[0][0] > 1e-5:
            bm.faces.new(list(reversed(rings[0])))
        if cap_top and profile[-1][0] > 1e-5:
            bm.faces.new(rings[-1])
        bmesh.ops.remove_doubles(bm, verts=vs, dist=1e-6)
        vs = [v for v in vs if v.is_valid]
        bmesh.ops.recalc_face_normals(bm, faces=list({f for v in vs for f in v.link_faces}))
        _round_uv(bm, vs)
        return vs
    return _emit(p, mat, build, T(at, rot, scale))


def dome(p, mat, r, at=(0, 0, 0), seg=16, rings=5, h=None):
    """Hemisphere (or a squashed dome of height h) sitting on y = at.y."""
    h = r if h is None else h
    prof = [(r * math.cos(0.5 * math.pi * i / rings), h * math.sin(0.5 * math.pi * i / rings)) for i in range(rings)] + [(0.0, h)]
    return lathe(p, mat, prof, at, seg)


def prism(p, mat, pts, depth, at=(0, 0, 0), rot=None, bevel=0.0):
    """Extrude an XY outline [(x, y), ...] (counter-clockwise) along local Z by `depth`, centred."""
    def build(bm):
        vs = [bm.verts.new((x, y, -depth / 2)) for (x, y) in pts]
        f = bm.faces.new(vs)
        bmesh.ops.recalc_face_normals(bm, faces=[f])
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        nv = _verts_of(ext['geom'])
        bmesh.ops.translate(bm, vec=(0, 0, depth), verts=nv)
        allv = vs + nv
        bmesh.ops.recalc_face_normals(bm, faces=list({fc for v in allv for fc in v.link_faces}))
        return _bevel_edges(bm, allv, bevel) if bevel > 0 else allv
    return _emit(p, mat, build, T(at, rot))


def quad(p, mat, size, at=(0, 0, 0), facing='+z', rot=None):
    """Single-sided rectangle facing `facing` (signs, banner cloth)."""
    w, h = size

    def build(bm):
        vs = [bm.verts.new(c) for c in ((-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0))]
        bm.faces.new(vs)
        return vs
    return _emit(p, mat, build, T(at, rot if rot is not None else facing_rot(facing)))


# ---------------------------------------------------------------------------------------------------------
# frames for facing-relative helpers: local x = right along the wall, y = up, z = out of the wall

def _frame(at, facing):
    return T(at, facing_rot(facing))


def _xf(F, p):
    return tuple(F @ vec(p))


# ---------------------------------------------------------------------------------------------------------
# hard-surface detail

def panel(p, mat, size, at, facing='+z', thick=0.01, bevel=0.003):
    """A raised plate (armour panel, access hatch) on a wall: size (w, h), protruding `thick`."""
    F = _frame(at, facing)
    w, h = size
    return box(p, mat, (w, h, thick), _xf(F, (0, 0, thick / 2)), facing_rot(facing), bevel=bevel)


def rivet_row(m, part, a, b, facing='+z', spacing=0.028, size=0.012, depth=0.02):
    """Rivet heads (height decal) between a and b on a surface facing `facing`."""
    a, b = vec(a), vec(b)
    d = b - a
    n = max(2, int(round(d.length / spacing)))
    img = D.rivets(n)
    F = euler3(facing_rot(facing))
    # roll so the strip's local x follows a->b (in the decal plane)
    lx = F.inverted() @ d
    roll = math.atan2(lx.y, lx.x)
    return m.decal(img, at=tuple((a + b) / 2), size=(d.length + spacing, size * 1.6), facing=facing, part=part,
                   depth=depth, roll=roll, color=False, height=1.0)


def vent(m, p, at, size, facing='+z', frame=None, slats=7, thick=0.012):
    """Louvred vent: a frame plate + slatted decal."""
    frame = frame or Mt.metal(0x34373c)
    F = _frame(at, facing)
    w, h = size
    box(p, frame, (w, h, thick), _xf(F, (0, 0, thick / 2)), facing_rot(facing), bevel=0.002)
    img = D.vent(slats, aspect=w / h)
    return m.decal(img, at=_xf(F, (0, 0, thick)), size=(w * 0.98, h * 0.98), facing=facing, part=p, depth=thick * 0.8, rough=0.7)


def grille(m, p, at, size, facing='+z', frame=None, n=8, thick=0.01):
    frame = frame or Mt.metal(0x2e3034)
    F = _frame(at, facing)
    w, h = size
    box(p, frame, (w, h, thick), _xf(F, (0, 0, thick / 2)), facing_rot(facing), bevel=0.002)
    img = D.grille(aspect=w / h, n=n)
    return m.decal(img, at=_xf(F, (0, 0, thick)), size=(w * 0.98, h * 0.98), facing=facing, part=p, depth=thick * 0.8)


def light(p, at, r=0.016, color=0xff2a1a, mode='blink', strength=2.4, housing=None, facing='+y'):
    """Warning lamp: housing + emissive lens (baked; the game animates it by mode)."""
    housing = housing or Mt.metal(0x26282c)
    F = _frame(at, facing)
    cyl(p, housing, r * 1.25, r * 0.7, _xf(F, (0, 0, r * 0.35)), _face_axis(facing), seg=8)
    return sphere(p, Mt.light(color, strength, mode), r, _xf(F, (0, 0, r * 0.75)), seg=8, rings=5)


def _face_axis(facing):
    """Rotation turning local +Y (cylinder axis) to point along the facing normal."""
    r = facing_rot(facing)
    M = euler3(r) @ euler3((math.pi / 2, 0, 0))
    return M.to_euler('ZYX')[:]


def window(p, at, size, facing='+z', lit=0xffc27a, frame=None, sill=True, bars=1, depth=0.012, strength=1.0):
    """Window: frame, recessed glass (lit = None for dark glass) and an optional sill. bars = mullions."""
    frame = frame or Mt.metal(0x2a2c30)
    F = _frame(at, facing)
    rot = facing_rot(facing)
    w, h = size
    t = min(w, h) * 0.12
    gl = Mt.glass(lit=lit, strength=strength) if lit is not None else Mt.glass()
    box(p, gl, (w - t, h - t, 0.004), _xf(F, (0, 0, 0.001)), rot)
    for (x, y, ww, hh) in [(0, h / 2 - t / 4, w, t / 2), (0, -h / 2 + t / 4, w, t / 2), (-w / 2 + t / 4, 0, t / 2, h), (w / 2 - t / 4, 0, t / 2, h)]:
        box(p, frame, (ww, hh, depth), _xf(F, (x, y, depth / 2)), rot)
    for i in range(bars):
        x = -w / 2 + w * (i + 1) / (bars + 1)
        box(p, frame, (t * 0.35, h, depth * 0.6), _xf(F, (x, 0, depth * 0.3)), rot)
    if sill:
        box(p, frame, (w * 1.15, t * 0.6, depth * 2.2), _xf(F, (0, -h / 2 - t * 0.3, depth * 1.1)), rot)


def window_row(p, at, n, size, gap, facing='+z', lit=0xffc27a, dark=(), **kw):
    """n windows centred at `at` along the wall; indices in `dark` are unlit."""
    F = _frame(at, facing)
    w = size[0]
    total = n * w + (n - 1) * gap
    for i in range(n):
        x = -total / 2 + w / 2 + i * (w + gap)
        window(p, _xf(F, (x, 0, 0)), size, facing, None if i in dark else lit, **kw)


def door(m, p, at, size, facing='+z', kind='roller', mat=None, frame=None, hazard_frame=False):
    """Door at ground level: at = bottom centre on the wall. kind: 'roller' (ribbed shutter), 'double',
    'hatch'. A dark recess + frame + door leaf (decal-detailed)."""
    mat = mat or Mt.painted(0x50545a, rough=0.6, panels=None)
    frame = frame or Mt.metal(0x2c2e32)
    F = _frame(at, facing)
    rot = facing_rot(facing)
    w, h = size
    t = 0.022
    box(p, Mt.flat(0x0e0e10, 0.9), (w, h, 0.006), _xf(F, (0, h / 2, 0.001)), rot)
    leaf = box(p, mat if kind != 'roller' else Mt.corrugated(0x5a5e63, along='x', pitch=0.022, rust=0.4), (w - t, h - t * 0.5, 0.01), _xf(F, (0, h / 2 - t * 0.25, 0.004)), rot)
    for (x, y, ww, hh) in [(0, h + t / 2 - 0.002, w + 2 * t, t), (-w / 2 - t / 2, h / 2, t, h), (w / 2 + t / 2, h / 2, t, h)]:
        box(p, frame, (ww, hh, 0.026), _xf(F, (x, y, 0.013)), rot, bevel=0.003)
    if kind == 'double':
        box(p, frame, (t * 0.3, h - t, 0.014), _xf(F, (0, h / 2, 0.01)), rot)
    if hazard_frame:
        m.decal(D.hazard(aspect=(w + 2 * t) / (t * 1.4)), at=_xf(F, (0, h + t / 2, 0.026)), size=(w + 2 * t, t * 1.0), facing=facing, part=p, depth=0.02)
    return leaf


def pipe(p, mat, a, b, r, flanges=True, seg=10):
    cyl_between(p, mat, a, b, r, seg)
    if flanges:
        a, b = vec(a), vec(b)
        d = (b - a).normalized()
        for c in (a + d * r * 1.2, b - d * r * 1.2):
            cyl_between(p, mat, tuple(c - d * r * 0.25), tuple(c + d * r * 0.25), r * 1.35, seg)


def pipe_run(p, mat, pts, r, flanges=True, seg=10, joints=True):
    """Pipe along a polyline with joint collars (and flanges at the ends)."""
    for i in range(len(pts) - 1):
        cyl_between(p, mat, pts[i], pts[i + 1], r, seg)
    if joints:
        for c in pts[1:-1]:
            sphere(p, mat, r * 1.18, c, seg=seg, rings=6)
    if flanges:
        for (a, b) in ((pts[0], pts[1]), (pts[-1], pts[-2])):
            a, b = vec(a), vec(b)
            d = (b - a).normalized()
            c = a + d * r * 0.6
            cyl_between(p, mat, tuple(c - d * r * 0.3), tuple(c + d * r * 0.3), r * 1.4, seg)


def ladder(p, mat, at, h, facing='+z', w=0.07, rung=0.045, bar_w=0.007, standoff=0.012, cage=False):
    """Wall ladder: at = bottom centre on the wall."""
    F = _frame(at, facing)
    for s in (-1, 1):
        bar(p, mat, _xf(F, (s * w / 2, 0, standoff)), _xf(F, (s * w / 2, h, standoff)), bar_w)
    n = max(2, int(h / rung))
    for i in range(1, n):
        y = i * h / n
        bar(p, mat, _xf(F, (-w / 2, y, standoff)), _xf(F, (w / 2, y, standoff)), bar_w * 0.7)
    if cage:
        for k in range(3):
            y0 = h * 0.35
            for y in (y0, y0 + (h - y0) * 0.5, h - 0.01):
                for (x0, z0, x1, z1) in ((-w / 2, standoff, -w / 2, standoff + w), (w / 2, standoff, w / 2, standoff + w), (-w / 2, standoff + w, w / 2, standoff + w)):
                    bar(p, mat, _xf(F, (x0, y, z0)), _xf(F, (x1, y, z1)), bar_w * 0.6)
            break


def railing(p, mat, a, b, h=0.06, post=0.1, w=0.0055):
    """Hand rail from a to b (both at deck level): posts, top rail and a mid rail."""
    a, b = vec(a), vec(b)
    d = b - a
    n = max(1, int(round(d.length / post)))
    up = Vector((0, 1, 0))
    for i in range(n + 1):
        c = a + d * (i / n)
        bar(p, mat, tuple(c), tuple(c + up * h), w)
    bar(p, mat, tuple(a + up * h), tuple(b + up * h), w * 1.1)
    bar(p, mat, tuple(a + up * h * 0.5), tuple(b + up * h * 0.5), w * 0.8)


def catwalk(m, p, at, length, width=0.08, axis='x', floor=None, rail=None, sides=(True, True), brackets=True):
    """Grated walkway along `axis` ('x' or 'z') centred at `at` (deck height), with rails and brackets."""
    floor = floor or Mt.tread()
    rail = rail or Mt.metal(0x3a3c40, rough=0.5)
    x, y, z = at
    if axis == 'x':
        box(p, floor, (length, 0.008, width), (x, y - 0.004, z))
        ends = [((x - length / 2, y, z + s * width / 2), (x + length / 2, y, z + s * width / 2)) for s in (-1, 1)]
    else:
        box(p, floor, (width, 0.008, length), (x, y - 0.004, z))
        ends = [((x + s * width / 2, y, z - length / 2), (x + s * width / 2, y, z + length / 2)) for s in (-1, 1)]
    for on, (a, b) in zip(sides, ends):
        if on:
            railing(p, rail, a, b)
    if brackets:
        n = max(2, int(length / 0.25))
        for i in range(n + 1):
            t = -length / 2 + length * i / n
            c = (x + t, y - 0.008, z) if axis == 'x' else (x, y - 0.008, z + t)
            box(p, rail, (0.01 if axis == 'x' else width, 0.02, width if axis == 'x' else 0.01), (c[0], c[1] - 0.01, c[2]))


def ac_unit(p, at, size=0.1, mat=None, rot=0.0):
    mat = mat or Mt.painted(0x7b7e80, wear=0.4, rust=0.3, panels=None)
    x, y, z = at
    s = size
    box(p, mat, (s * 1.4, s * 0.7, s), (x, y + s * 0.35, z), (0, rot, 0), bevel=0.004)
    cyl(p, Mt.metal(0x202224), s * 0.36, 0.006, (x, y + s * 0.7 + 0.003, z), seg=12)
    cyl(p, Mt.metal(0x4a4c50), s * 0.08, 0.012, (x, y + s * 0.7 + 0.006, z), seg=8)


def roof_vent(p, at, r=0.035, mat=None, h=None):
    """Mushroom roof vent."""
    mat = mat or Mt.metal(0x55595e, rust=0.35)
    x, y, z = at
    h = h or r * 1.4
    cyl(p, mat, r * 0.6, h, (x, y + h / 2, z), seg=8)
    cyl(p, mat, r * 1.25, r * 0.35, (x, y + h + r * 0.1, z), seg=10, r2=r * 0.5)


def roof_clutter(p, rect, y, seed=1, n=6, mats=None):
    """Scatter AC units, vents and boxes inside rect = (x0, z0, x1, z1) at roof height y."""
    rnd = random.Random(seed)
    x0, z0, x1, z1 = rect
    for i in range(n):
        x, z = rnd.uniform(x0, x1), rnd.uniform(z0, z1)
        k = rnd.random()
        if k < 0.35:
            ac_unit(p, (x, y, z), rnd.uniform(0.07, 0.11), rot=rnd.choice((0.0, math.pi / 2)))
        elif k < 0.7:
            roof_vent(p, (x, y, z), rnd.uniform(0.022, 0.04))
        else:
            s = rnd.uniform(0.04, 0.08)
            box(p, Mt.metal(0x4c5056, rust=0.35), (s * 1.3, s * 0.6, s), (x, y + s * 0.3, z), bevel=0.003)


def chimney(m, p, at, h, r, r_top=None, mat=None, bands=None, band_mat=None, cap=None, lights=4, smoke=None,
            light_color=0xff2a1a, ladder_side=None, seg=20, glow_ring=True, light_r=0.016):
    """Smokestack standing on y = at.y: tapered shell, coloured bands [(y_frac, h_frac), ...], cap ring, red
    warning lights around the crown (and a glowing ring under it: the reference's red-crowned stacks),
    optional ladder; `smoke` = point name ('smoke0') at the top."""
    mat = mat or Mt.concrete(0x7e7a72, streaks=1.0, grime=0.8)
    band_mat = band_mat or Mt.painted(0xa31812, wear=0.4, rust=0.2, streaks=0.8)
    cap = cap or Mt.metal(0x2a2b2e, rust=0.4)
    rt = r * 0.82 if r_top is None else r_top
    x, y, z = at
    cyl(p, mat, r, h, (x, y + h / 2, z), r2=rt, seg=seg)
    for (yf, hf) in bands or [(0.78, 0.08), (0.9, 0.06)]:
        rr = r + (rt - r) * yf
        rr2 = r + (rt - r) * (yf + hf)
        cyl(p, band_mat, rr + 0.004, h * hf, (x, y + h * (yf + hf / 2), z), r2=rr2 + 0.004, seg=seg, caps=False)
    # crown: rim + dark inner
    lathe(p, cap, [(rt + 0.012, h - 0.02), (rt + 0.012, h + 0.012), (rt * 0.78, h + 0.012), (rt * 0.74, h - 0.06)], (x, y, z), seg=seg, cap_bottom=False, cap_top=False)
    cyl(p, Mt.flat(0x070707, 0.95), rt * 0.76, 0.004, (x, y + h - 0.05, z), seg=seg)
    if glow_ring:
        cyl(p, Mt.light(light_color, 1.8, 'pulse'), rt + 0.006, 0.016, (x, y + h - 0.045, z), seg=seg, caps=False)
    for i in range(lights):
        a = 2 * math.pi * (i + 0.5) / lights
        light(p, (x + math.cos(a) * (rt + 0.014), y + h - 0.012, z - math.sin(a) * (rt + 0.014)), light_r, light_color, 'blink')
    if ladder_side is not None:
        a = ladder_side
        ladder(p, Mt.metal(0x2a2c30), (x + math.cos(a) * (r + 0.004), y, z - math.sin(a) * (r + 0.004)), h * 0.92, facing=a + math.pi / 2, w=0.05)
    if smoke:
        m.smoke(smoke, (x, y + h + 0.02, z), part=p)


def antenna(p, at, h, mat=None, light_color=0xff2a1a, light_mode='blink', guy=False):
    mat = mat or Mt.metal(0x2a2c30)
    x, y, z = at
    cyl(p, mat, 0.008, h, (x, y + h / 2, z), r2=0.003, seg=6)
    if light_color is not None:
        sphere(p, Mt.light(light_color, 2.4, light_mode), 0.008, (x, y + h, z), seg=6, rings=4)


def dish(p, at, r, mat=None, yaw=0.0, pitch=0.6, stand=True):
    """Parabolic dish on a stand; the bowl faces yaw (around Y, 0 = +X) tilted up by pitch."""
    mat = mat or Mt.painted(0x9a9a96, wear=0.3, panels=None)
    x, y, z = at
    if stand:
        cyl(p, Mt.metal(0x2e3034), r * 0.12, r * 0.8, (x, y + r * 0.4, z), seg=8)
    prof = [(0.0, 0.0), (r * 0.35, r * 0.03), (r * 0.7, r * 0.12), (r, r * 0.28), (r * 0.97, r * 0.3), (r * 0.66, r * 0.15), (r * 0.3, r * 0.05)]
    rot = (0.0, yaw, -(math.pi / 2 - pitch))
    lathe(p, mat, prof, (x, y + r * 0.85, z), seg=16, rot=rot, cap_top=False, cap_bottom=False)
    # feed horn
    F = T((x, y + r * 0.85, z), rot)
    cyl_between(p, Mt.metal(0x2e3034), _xf(F, (0, r * 0.05, 0)), _xf(F, (0, r * 0.55, 0)), r * 0.04, 6)


def banner(m, p, at, size, facing='+z', emblem='soviet', color=None, rod=None, wave=0.012):
    """Hanging cloth banner: at = top centre on a wall. emblem: 'soviet' (gold star on red), 'allied'
    (eagle on blue), 'allied_star', None, or a DecalImage. Cloth is team-coloured when color='team'."""
    w, h = size
    rod = rod or Mt.metal(0x2a2b2e)
    if color is None:
        color = 0x9c1612 if emblem == 'soviet' else 0x1d3a78
    cl = Mt.cloth(team=True) if color == 'team' else Mt.cloth(color)
    F = _frame(at, facing)
    rot = facing_rot(facing)
    # cloth: a strip of quads with a gentle wave, hanging below the rod, slightly off the wall
    def build(bm):
        nx, ny = 6, 5
        grid = []
        for j in range(ny + 1):
            row = []
            for i in range(nx + 1):
                u, v = i / nx, j / ny
                zz = 0.006 + wave * math.sin(u * math.pi * 2.0) * (0.3 + v)
                row.append(bm.verts.new((-w / 2 + u * w, -v * h, zz)))
            grid.append(row)
        for j in range(ny):
            for i in range(nx):
                bm.faces.new((grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1], grid[j][i]))
        return [v for row in grid for v in row]
    _emit(p, cl, build, F)
    cyl_between(p, rod, _xf(F, (-w / 2 - 0.01, 0.004, 0.008)), _xf(F, (w / 2 + 0.01, 0.004, 0.008)), 0.005, 6)
    img = None
    if emblem == 'soviet':
        img = D.soviet_star()
    elif emblem == 'allied':
        img = D.allied_eagle()
    elif emblem == 'allied_star':
        img = D.allied_star()
    elif emblem is not None:
        img = emblem
    if img is not None:
        s = min(w * 0.78, h * 0.6)
        m.decal(img, at=_xf(F, (0, -h * 0.45, 0.006)), size=(s, s), facing=facing, part=p, depth=0.03, team=0, rough=0.7)
    # gold trim at the bottom edge
    m.decal(D.solid(0xe8b434), at=_xf(F, (0, -h + 0.014, 0.006)), size=(w, 0.014), facing=facing, part=p, depth=0.03, team=0, rough=0.5)


def sign(m, p, at, size, lines, facing='+z', board=None, text_color=0xe8e4da, field=None, lights=0, emit=None, frame=None,
         stencil=False, posts=False, emblem=None, scales=None, font=None):
    """Slogan board on a wall: at = centre; lines = ['POWER', 'OUR STRENGTH'] or 'POWER|OUR STRENGTH'.
    board = material of the board (default dark red paint); field = painted background colour baked under
    the text (None: the board shows through). lights = number of lamps on top of the board. emblem =
    'soviet' | 'allied' | 'allied_star' puts that emblem on the right end (the text moves left)."""
    board = board or Mt.painted(0x8e1712, wear=0.5, rust=0.3, streaks=0.7)
    frame = frame or Mt.metal(0x26282c)
    F = _frame(at, facing)
    rot = facing_rot(facing)
    w, h = size
    box(p, board, (w, h, 0.012), _xf(F, (0, 0, 0.006)), rot, bevel=0.002)
    for (x, y, ww, hh) in [(0, h / 2, w + 0.012, 0.01), (0, -h / 2, w + 0.012, 0.01)]:
        box(p, frame, (ww, hh, 0.018), _xf(F, (x, y, 0.009)), rot)
    tw = w * (0.74 if emblem else 0.96)
    tx = -w * 0.11 if emblem else 0.0
    nl = len(lines.split('|')) if isinstance(lines, str) else len(lines)
    if scales is None and nl == 2:
        scales = [1.45, 1.0]  # headline over a smaller line, like the reference's POWER / OUR STRENGTH
    img = D.text(lines, px_h=192, aspect=tw / (h * 0.9), color=text_color, field=field, stencil=stencil, scales=scales, font=font)
    m.decal(img, at=_xf(F, (tx, 0, 0.012)), size=(tw, h * 0.9), facing=facing, part=p, depth=0.01, team=0, emit=emit)
    if emblem:
        es = min(h * 0.86, w * 0.24)
        img = {'soviet': D.soviet_star, 'allied': D.allied_eagle, 'allied_star': D.allied_star}[emblem]()
        m.decal(img, at=_xf(F, (w / 2 - w * 0.13, 0, 0.012)), size=(es, es), facing=facing, part=p, depth=0.01, team=0)
    for i in range(lights):
        x = -w / 2 + w * (i + 0.5) / lights
        cyl_between(p, frame, _xf(F, (x, h / 2 + 0.005, 0.01)), _xf(F, (x, h / 2 + 0.02, 0.04)), 0.003, 5)
        box(p, Mt.light(0xffd9a0, 1.6, 'steady'), (0.03, 0.006, 0.012), _xf(F, (x, h / 2 + 0.022, 0.042)), rot)
    if posts:
        for s in (-1, 1):
            bar(p, frame, _xf(F, (s * w * 0.4, -h / 2, 0.005)), _xf(F, (s * w * 0.4, -h / 2 - at[1], 0.005)), 0.012)


def stencil(m, p, text, at, height, facing='+z', color=0xe8e4da, team=0, wear=0.3, depth=0.02, font=None):
    """Painted stencil text directly on a surface (no board). Cyrillic picks Russo One automatically; font=
    'rajdhani' | 'russo' | a font path overrides."""
    img = D.text([text] if isinstance(text, str) and '|' not in text else text, px_h=96, color=color, wear=wear, font=font)
    return m.decal(img, at=at, size=(height * img.aspect, height), facing=facing, part=p, depth=depth, team=team)


def hazard_stripes(m, p, at, size, facing='+z', depth=0.02):
    w, h = size
    return m.decal(D.hazard(aspect=w / h), at=at, size=(w, h), facing=facing, part=p, depth=depth, team=0, rough=0.6)


def emblem(m, p, kind, at, size, facing='+z', depth=0.02):
    """Paint an emblem decal: 'soviet' star, 'allied' eagle, 'allied_star' roundel."""
    img = {'soviet': D.soviet_star, 'allied': D.allied_eagle, 'allied_star': D.allied_star}[kind]()
    return m.decal(img, at=at, size=(size, size), facing=facing, part=p, depth=depth, team=0)


# ---------------------------------------------------------------------------------------------------------
# vehicles

def track_belt(p, L, H, W, at=(0, 0, 0), link=0.05, thick=0.022, arc=5):
    """Track belt (the game's scrolling tread material): length L, height H, width W, centred at `at`
    (belt axis along X). UVs: u = distance / link along the belt, v across."""
    mat = Mt.track_material()
    r = H / 2
    half = L / 2 - r
    path = [(-half, r, 0, 1), (half, r, 0, 1)]
    for i in range(1, arc):
        a = math.pi / 2 - (i / arc) * math.pi
        path.append((half + math.cos(a) * r, math.sin(a) * r, math.cos(a), math.sin(a)))
    path += [(half, -r, 0, -1), (-half, -r, 0, -1)]
    for i in range(1, arc):
        a = -math.pi / 2 - (i / arc) * math.pi
        path.append((-half + math.cos(a) * r, math.sin(a) * r, math.cos(a), math.sin(a)))
    path.append(path[0])
    s = [0.0]
    for i in range(1, len(path)):
        s.append(s[-1] + math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
    bm, _ = p.target(mat)
    uvl = bm.loops.layers.uv.get('belt') or bm.loops.layers.uv.new('belt')
    hw = W / 2
    ox, oy, oz = at
    rings = []
    for (x, y, nx, ny) in path:
        outer = [(x, y, -hw), (x, y, hw)]
        inner = [(x - nx * thick, y - ny * thick, hw), (x - nx * thick, y - ny * thick, -hw)]
        rings.append([bm.verts.new((ox + px, oy + r + py, oz + pz)) for (px, py, pz) in outer + inner])
    for i in range(len(path) - 1):
        A, B = rings[i], rings[i + 1]
        u0, u1 = s[i] / link, s[i + 1] / link
        # outer tread, inner face, two sides
        for (k0, k1, v0, v1) in ((0, 1, 0.0, 1.0), (1, 2, 1.0, 1.0), (2, 3, 0.0, 1.0), (3, 0, 0.0, 0.0)):
            f = bm.faces.new((A[k0], B[k0], B[k1], A[k1]))
            for lp, uv in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
                lp[uvl].uv = uv
    bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces])


def road_wheels(p, mat, xs, y, z, r, w=0.03, side=1, seg=12, hub=None):
    """Road wheels at x positions xs (wheel centre height y), on side z (sign side: +1 right/+Z, -1 left)."""
    hub = hub or Mt.metal(0x3a3c40)
    for x in xs:
        cyl(p, mat, r, w, (x, y, z), (math.pi / 2, 0, 0), seg=seg, bevel=0.004)
        cyl(p, hub, r * 0.35, 0.008, (x, y, z + side * (w / 2 + 0.003)), (math.pi / 2, 0, 0), seg=8)


def barrel(p, mat, length, r, at=(0, 0, 0), muzzle_brake=True, seg=10, taper=0.85):
    """Gun barrel along +X from `at` (the barrel part's pivot), with a muzzle brake / bore."""
    x, y, z = at
    cyl(p, mat, r, length, (x + length / 2, y, z), (0, 0, -math.pi / 2), r2=r * taper, seg=seg)
    if muzzle_brake:
        cyl(p, mat, r * taper * 1.35, length * 0.09, (x + length * 0.95, y, z), (0, 0, -math.pi / 2), seg=seg, bevel=0.002)
        cyl(p, Mt.flat(0x060606, 0.9), r * taper * 0.6, 0.002, (x + length * 0.995 + 0.002, y, z), (0, 0, -math.pi / 2), seg=8)


def downpipe(p, mat, at, y0, y1, facing='+z', r=0.012, standoff=0.02, brackets=3):
    """Vertical pipe on a wall from y0 to y1 (at = (x, _, z) on the wall), with wall brackets and a foot bend."""
    F = euler3(facing_rot(facing))
    n = F @ Vector((0, 0, 1))
    x, _, z = at
    c = Vector((x, 0, z)) + n * (standoff + r)
    cyl_between(p, mat, (c.x, y0 + r * 2, c.z), (c.x, y1, c.z), r, 8)
    cyl_between(p, mat, (c.x, y0 + r * 2, c.z), tuple(Vector((c.x, y0 + r, c.z)) + n * r * 3), r, 8)
    for i in range(brackets):
        y = y0 + (y1 - y0) * (i + 0.5) / brackets
        a = Vector((x, y, z)) + n * 0.002
        b = Vector((c.x, y, c.z))
        bar(p, mat, tuple(a), tuple(b), r * 0.6, r * 1.6)


def junction_box(p, at, size=(0.08, 0.1, 0.035), facing='+z', mat=None, conduit=0.0):
    """Electrical cabinet on a wall (at = centre on the wall surface); conduit = length of a cable conduit
    running down from it."""
    mat = mat or Mt.painted(0x5b6158, wear=0.6, rust=0.35, panels=None)
    F = _frame(at, facing)
    w, h, d = size
    box(p, mat, (w, h, d), _xf(F, (0, 0, d / 2)), facing_rot(facing), bevel=0.004)
    box(p, Mt.metal(0x2a2c30), (w * 0.8, 0.006, d * 0.6), _xf(F, (0, h / 2 + 0.003, d * 0.5)), facing_rot(facing))
    if conduit > 0:
        bar(p, Mt.metal(0x2a2c30), _xf(F, (w * 0.25, -h / 2, d * 0.4)), _xf(F, (w * 0.25, -h / 2 - conduit, d * 0.4)), 0.008)


def rail_rect(p, mat, x0, z0, x1, z1, y, h=0.07, post=0.12, sides='nesw'):
    """Hand rails around a roof rectangle at height y ('n' = -z side, 's' = +z, 'e' = +x, 'w' = -x)."""
    if 'n' in sides:
        railing(p, mat, (x0, y, z0), (x1, y, z0), h, post)
    if 's' in sides:
        railing(p, mat, (x0, y, z1), (x1, y, z1), h, post)
    if 'w' in sides:
        railing(p, mat, (x0, y, z0), (x0, y, z1), h, post)
    if 'e' in sides:
        railing(p, mat, (x1, y, z0), (x1, y, z1), h, post)
