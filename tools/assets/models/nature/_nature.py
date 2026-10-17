"""Shared helpers for the nature models (trees, rocks; render/vegetation.ts instances them): organic materials
and custom bmesh geometry on top of the kit (kit.materials._new / _set / _Graph, kit.shapes._emit).

Geometry carries three per-vertex float attributes that the materials read in the bake:
    nat_tip    0 at the trunk / crown centre .. 1 at a branch tip / the crown surface (lighter tips, inner shade)
    nat_shade  tone multiplier (~1): per tier, branch, leaf cluster or rock stratum
    nat_snow   0..1 snow lying on the upward-facing parts of that vertex (snow variants)
    nat_u      0 on a fir branch's midrib .. 1 at the notch between two branches (herringbone needle sprays)
Game frame (+Y up, ground y = 0, origin = trunk base / rock centre), 1 unit = 1 map cell. Opaque geometry only.
"""
import math
import random

import bmesh
import numpy as np
from mathutils import Matrix, Vector
from mathutils import noise as mn

from kit import materials as Mt
from kit.materials import _key, _new, _set, srgb
from kit.shapes import _emit

SNOW = (0.80, 0.84, 0.90)  # linear snow albedo (the procedural SNOW colour, a touch darker for the AO)


# ---------------------------------------------------------------------------------------------------------
# geometry plumbing

ATTRS = ('nat_tip', 'nat_shade', 'nat_snow', 'nat_u')


class _B:
    """Vertex / face builder inside a kit _emit build(bm) callback (sets the nat_* attributes)."""

    def __init__(self, bm):
        self.bm = bm
        self.lay = {k: (bm.verts.layers.float.get(k) or bm.verts.layers.float.new(k)) for k in ATTRS}
        self.verts = []
        self.faces = []

    def v(self, co, tip=0.0, shade=1.0, snow=0.0, u=0.0):
        v = self.bm.verts.new((float(co[0]), float(co[1]), float(co[2])))
        v[self.lay['nat_tip']] = tip
        v[self.lay['nat_shade']] = shade
        v[self.lay['nat_snow']] = snow
        v[self.lay['nat_u']] = u
        self.verts.append(v)
        return v

    def f(self, vs):
        if len(set(vs)) < 3:
            return None
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        self.faces.append(f)
        return f

    def attrs(self, v, tip=None, shade=None, snow=None):
        if tip is not None:
            v[self.lay['nat_tip']] = tip
        if shade is not None:
            v[self.lay['nat_shade']] = shade
        if snow is not None:
            v[self.lay['nat_snow']] = snow


def _smooth(part, mat, faces):
    """Shade these faces smooth across any angle (kit core: face attribute rh_smooth)."""
    bm, _ = part.target(mat)
    sm = bm.faces.layers.float.get('rh_smooth') or bm.faces.layers.float.new('rh_smooth')
    for f in faces:
        if f.is_valid:
            f[sm] = 1.0


def emit(part, mat, fn, smooth=True):
    """fn(B) adds verts / faces in model space; returns the faces."""
    def build(bm):
        b = _B(bm)
        fn(b)
        return b.verts
    _verts, faces = _emit(part, mat, build, Matrix.Identity(4))
    if smooth:
        _smooth(part, mat, faces)
    return faces


def nz(p, f=1.0, seed=0.0):
    """Perlin noise in [-1, 1] at p * f (deterministic)."""
    return mn.noise(Vector((p[0] * f + seed * 7.31, p[1] * f + seed * 3.17, p[2] * f - seed * 5.53)))


# ---------------------------------------------------------------------------------------------------------
# node-graph helpers (on a kit _Graph)

def _attr(g, name):
    n = g.node('ShaderNodeAttribute', attribute_type='GEOMETRY', attribute_name=name)
    return n.outputs['Fac']


def _onormal(g):
    """Object-space normal = the game frame (y up)."""
    return g.node('ShaderNodeTexCoord').outputs['Normal']


def _xyz(g, x, y, z):
    n = g.node('ShaderNodeCombineXYZ')
    g._in(n.inputs[0], x)
    g._in(n.inputs[1], y)
    g._in(n.inputs[2], z)
    return n.outputs[0]


def _vor(g, vec, scale, out='Distance', feature='F1', rand=1.0):
    n = g.node('ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature=feature)
    g._in(n.inputs['Vector'], vec)
    n.inputs['Scale'].default_value = scale
    n.inputs['Randomness'].default_value = rand
    return n.outputs[out]


def _clamp(g, x):
    return g.math('ADD', x, 0.0, clamp=True)


def _mad(g, x, k, c=0.0):
    """x * k + c"""
    return g.math('MULTIPLY_ADD', x, k, c)


def _lin(c):
    return srgb(c) if isinstance(c, int) else c


_LUM_CACHE = {}


def tex_mean_lum(tid):
    """Mean linear luminance of a pinned Poly Haven diffuse (to normalise it around 1)."""
    if tid not in _LUM_CACHE:
        img = Mt.ph_image(tid, 'diffuse')
        w, h = img.size
        a = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(a)
        a = a.reshape(-1, 4)[:, :3]
        # byte images hold sRGB-encoded values
        a = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
        _LUM_CACHE[tid] = float((a @ np.array([0.2126, 0.7152, 0.0722], np.float32)).mean())
    return _LUM_CACHE[tid]


def _triplanar_lum(g, tid, scale, offset=(0.0, 0.0, 0.0), sharp=4.0):
    """Luminance of a Poly Haven diffuse projected on three planes with the image's vertical (v) always along
    the game's +Y on the side faces (strata stay horizontal on every side), blended by the object normal."""
    img = Mt.ph_image(tid, 'diffuse')
    P = g.obj()
    x, y, z = g.xyz(P)
    x = _mad(g, x, scale, offset[0])
    y = _mad(g, y, scale, offset[1])
    z = _mad(g, z, scale, offset[2])
    nx, ny, nz_ = g.xyz(_onormal(g))
    w = [g.math('POWER', g.math('ABSOLUTE', c), sharp) for c in (nx, ny, nz_)]
    tot = g.add(g.add(w[0], w[1]), g.add(w[2], 1e-4))
    sx, _ = g.image(img, _xyz(g, z, y, 0.0), proj='FLAT')     # +-X faces: u along z, v = height
    sy, _ = g.image(img, _xyz(g, x, z, 0.0), proj='FLAT')     # tops / bottoms
    sz, _ = g.image(img, _xyz(g, x, y, 0.0), proj='FLAT')     # +-Z faces: u along x, v = height
    lum = g.add(g.add(g.mul(g.lum(sx), w[0]), g.mul(g.lum(sy), w[1])), g.mul(g.lum(sz), w[2]))
    return g.math('DIVIDE', lum, tot)


def _snowify(g, col, rough, height, sf, k_height=0.9):
    """Blend snow over a material by the factor socket sf."""
    sc = g.scalec(g.rgb(SNOW), g.add(0.94, g.mul(g.noise(g.obj(), 40.0, 2, 0.5), 0.12)))
    col = g.mixc(col, sc, sf)
    rough = g.mixf(rough, 0.62, sf)
    height = g.add(height, g.mul(g.smooth(sf, 0.15, 0.6), k_height))
    return col, rough, height


# ---------------------------------------------------------------------------------------------------------
# materials (sRGB hex colours like the rest of the kit; organic: no wear / rust / streaks)

def needles(dark=0x243f2d, mid=0x385d40, light=0x4b7348, fresh=0x65894d, under=0x1d3223, dust=0.0, seed=0,
            spray=0.034):
    """Conifer needles. Each branch frond is a herringbone of needle sprays angled out from its midrib (nat_u
    0 on the midrib .. 1 at the notch), separated by dark gaps; fine radial needle strands; lighter towards the
    tips (nat_tip) with fresh light-green growth on the very tips; darker into the notches and on the undersides;
    per tier / branch tone (nat_shade); snow on the upward faces where nat_snow (+ dust)."""
    m, g = _new(_key('nat_needles', dark, mid, light, fresh, under, dust, seed, spray), 'foliage')
    if g is None:
        return m
    P = g.obj()
    x, y, z = g.xyz(P)
    _nx, ny, _nz = g.xyz(_onormal(g))
    tip = _attr(g, 'nat_tip')
    shade = _attr(g, 'nat_shade')
    snowv = _attr(g, 'nat_snow')
    across = _clamp(g, g.math('ABSOLUTE', _attr(g, 'nat_u')))
    rad = g.math('SQRT', g.add(g.mul(x, x), g.mul(z, z)))
    inv = g.math('DIVIDE', 1.0, g.math('MAXIMUM', rad, 0.015))
    # herringbone: sprays along lines of constant (rad - 0.3 * rad * across), warped by noise
    warp = g.noise(g.vadd(P, (seed * 1.7, 0.0, seed * 0.3)), 16.0, 2, 0.5)
    q = g.sub(rad, g.mul(g.mul(rad, across), 0.32))
    ph = g.add(g.mul(q, 2 * math.pi / spray), g.mul(warp, 3.0))
    sp = g.add(0.5, g.mul(g.math('SINE', ph), 0.5))
    sprays = g.smooth(sp, 0.18, 0.75)
    # fine needle strands (radial: P * 110 minus 100 * rad along the radial direction)
    rx, rz = g.mul(x, inv), g.mul(z, inv)
    k = g.mul(rad, -100.0)
    sv = _xyz(g, g.add(g.mul(x, 110.0), g.mul(rx, k)), g.mul(y, 90.0), g.add(g.mul(z, 110.0), g.mul(rz, k)))
    strand = g.noise(sv, 1.0, 3, 0.6, 0.0)
    clumpn = g.noise(g.vadd(P, (seed, seed, 0.0)), 7.0, 3, 0.55)
    f = g.add(g.mul(tip, 0.42), g.mul(g.sub(sprays, 0.5), 0.5))
    f = g.add(f, g.mul(g.sub(strand, 0.5), 0.55))
    f = g.add(f, g.mul(g.sub(clumpn, 0.5), 0.4))
    f = _clamp(g, g.add(f, 0.22))
    c1 = g.mixc(g.rgb(_lin(dark)), g.rgb(_lin(mid)), g.smooth(f, 0.0, 0.55))
    col = g.mixc(c1, g.rgb(_lin(light)), g.smooth(f, 0.45, 1.0))
    # fresh growth on the outer tips of the sprays
    fr = g.mul(g.smooth(tip, 0.78, 1.0), g.smooth(g.add(g.mul(sprays, 0.6), g.mul(strand, 0.6)), 0.55, 0.9), clamp=True)
    col = g.mixc(col, g.rgb(_lin(fresh)), g.mul(fr, 0.7))
    # darker into the notches between the branches and on the midrib's sides
    col = g.scalec(col, g.sub(1.0, g.mul(g.smooth(across, 0.6, 1.0), 0.2)))
    # big-scale hue drift (yellower / bluer firs) and the tone attribute
    hb = g.noise(P, 2.2, 2, 0.5)
    col = g.mixc(col, g.mulc(col, g.rgb((1.15, 1.05, 0.8))), g.mul(g.smooth(hb, 0.45, 0.72), 0.6))
    col = g.scalec(col, shade)
    col = g.mixc(g.rgb(_lin(under)), col, g.smooth(ny, -0.9, -0.2))
    rough = g.val(0.86)
    height = g.add(g.add(g.mul(sprays, 0.7), g.mul(strand, 0.6)), g.mul(g.inv(across), 0.5))
    # snow on the upward faces where nat_snow (+ a dusting)
    up = g.smooth(ny, 0.2, 0.72)
    br = g.noise(P, 11.0, 3, 0.6)
    amt = g.add(snowv, dust)
    sf = g.mul(g.smooth(g.add(g.mul(amt, 1.1), g.mul(g.sub(br, 0.5), 0.9)), 0.42, 0.62), up, clamp=True)
    sf = g.mul(sf, g.smooth(g.add(g.mul(sprays, 0.6), g.mul(strand, 0.5)), 0.25, 0.6), clamp=True)
    sf = g.mul(sf, g.sub(1.0, g.mul(g.smooth(across, 0.35, 0.95), 0.75)), clamp=True)
    col, rough, height = _snowify(g, col, rough, height, sf, 0.5)
    _set(g, col, rough, 0.0, height=height, wear=0.0, grime=0.06, rust=0.0, streaks=0.0, ao=0.62, bevel=0.02)
    return m


def leaves(dark=0x1f3a14, light=0x4f7a2a, sun=0x8aa64a, inner=0.5, cells=24.0, seed=0, twigs=None, dust=0.0):
    """Broadleaf foliage: leaf clumps (Voronoi domes, each its own tone), sun-lit tops (object normal + the
    crown-surface attribute nat_tip), darker inner shade, per-cluster tone (nat_shade). twigs=hex: dry twig
    specks (scrub)."""
    m, g = _new(_key('nat_leaves', dark, light, sun, inner, cells, seed, twigs, dust), 'foliage')
    if g is None:
        return m
    P = g.obj()
    _nx, ny, _nz = g.xyz(_onormal(g))
    tip = _attr(g, 'nat_tip')
    shade = _attr(g, 'nat_shade')
    snowv = _attr(g, 'nat_snow')
    Ps = g.vadd(P, (seed * 0.9, seed * 0.4, -seed * 1.1))
    vd = _vor(g, Ps, cells)
    dome = _clamp(g, g.sub(1.0, g.mul(vd, 1.35)))
    cell = g.lum(_vor(g, Ps, cells, out='Color'))
    vd2 = _vor(g, Ps, cells * 2.6)
    small = _clamp(g, g.sub(1.0, g.mul(vd2, 1.4)))
    fine = g.noise(Ps, 80.0, 2, 0.5)
    f = g.add(g.mul(g.sub(dome, 0.5), 0.45), g.mul(g.sub(cell, 0.5), 0.5))
    f = g.add(f, g.mul(g.sub(small, 0.5), 0.3))
    f = _clamp(g, g.add(f, g.add(g.mul(g.sub(fine, 0.5), 0.25), 0.45)))
    col = g.mixc(g.rgb(_lin(dark)), g.rgb(_lin(light)), f)
    sunk = g.mul(g.smooth(ny, -0.1, 0.85), g.smooth(tip, 0.45, 1.0))
    sunk = g.mul(sunk, g.smooth(g.add(dome, g.mul(g.sub(fine, 0.5), 0.6)), 0.25, 0.75), clamp=True)
    col = g.mixc(col, g.rgb(_lin(sun)), g.mul(sunk, 0.75))
    # inner shade (crown interior) and the cluster tone
    col = g.scalec(col, g.add(1.0 - inner, g.mul(g.smooth(tip, 0.2, 0.95), inner)))
    col = g.scalec(col, shade)
    hb = g.noise(P, 2.6, 2, 0.5)
    col = g.mixc(col, g.mulc(col, g.rgb((1.12, 1.05, 0.8))), g.mul(g.smooth(hb, 0.45, 0.7), 0.6))
    if twigs is not None:
        tw = g.smooth(g.noise(g.vmul(Ps, (60.0, 25.0, 60.0)), 1.0, 2, 0.5), 0.62, 0.7)
        col = g.mixc(col, g.rgb(_lin(twigs)), g.mul(tw, 0.55))
    rough = g.val(0.8)
    height = g.add(g.mul(dome, 0.75), g.mul(small, 0.35))
    if dust:
        up = g.smooth(ny, 0.3, 0.8)
        br = g.noise(P, 9.0, 3, 0.6)
        sf = g.mul(g.smooth(g.add(g.mul(g.add(snowv, dust), 1.1), g.mul(g.sub(br, 0.5), 0.9)), 0.45, 0.62), up, clamp=True)
        col, rough, height = _snowify(g, col, rough, height, sf, 0.4)
    _set(g, col, rough, 0.0, height=height, wear=0.0, grime=0.06, rust=0.0, streaks=0.0, ao=0.62, bevel=0.025)
    return m


def bark(color=0x6a5444, dark=0x3a2c22, seed=0, moss=None):
    """Furrowed bark: vertical furrows (stretched noise) over plates, darker in the cracks."""
    m, g = _new(_key('nat_bark', color, dark, seed, moss), 'bark')
    if g is None:
        return m
    P = g.obj()
    x, y, z = g.xyz(P)
    fv = _xyz(g, g.mul(x, 70.0), g.mul(y, 9.0), g.mul(z, 70.0))
    furrow = g.smooth(g.noise(fv, 1.0, 4, 0.6, 0.3), 0.38, 0.62)
    pv = _xyz(g, g.mul(x, 38.0), g.mul(y, 12.0), g.mul(z, 38.0))
    plate = _clamp(g, g.mul(_vor(g, pv, 1.0, out='Distance', feature='DISTANCE_TO_EDGE'), 6.0))
    f = g.mul(furrow, plate)
    col = g.mixc(g.rgb(_lin(dark)), g.rgb(_lin(color)), f)
    col = g.scalec(col, g.add(0.85, g.mul(g.noise(P, 18.0, 2), 0.3)))
    if moss is not None:
        mk = g.mul(g.smooth(g.noise(P, 6.0, 3), 0.5, 0.7), g.inv(furrow))
        col = g.mixc(col, g.rgb(_lin(moss)), g.mul(mk, 0.6))
    height = g.add(g.mul(furrow, 0.9), g.mul(plate, 0.4))
    _set(g, col, 0.9, 0.0, height=height, wear=0.0, grime=0.3, rust=0.0, streaks=0.0, ao=0.6, bevel=0.01)
    return m


def snow_mat(seed=0):
    """Settled snow (mantles on fir tiers, caps on rocks): soft cushions (two octaves of lumps in the albedo and
    the normal), a faint sparkle, cooler / bluer in the hollows between fir branches (nat_u)."""
    m, g = _new(_key('nat_snow', seed), 'snow')
    if g is None:
        return m
    P = g.obj()
    lumps = g.noise(g.vadd(P, (seed, 0.0, -seed)), 8.0, 3, 0.55)
    lumps2 = g.noise(g.vadd(P, (-seed, seed, 0.0)), 22.0, 2, 0.5)
    fine = g.noise(P, 70.0, 2, 0.5)
    col = g.scalec(g.rgb(SNOW), g.add(0.8, g.add(g.add(g.mul(lumps, 0.22), g.mul(lumps2, 0.12)), g.mul(fine, 0.06))))
    shade = _attr(g, 'nat_shade')
    col = g.scalec(col, g.add(0.6, g.mul(shade, 0.4)))
    hollow = g.smooth(_attr(g, 'nat_u'), 0.45, 1.0)
    col = g.mixc(col, g.mulc(col, g.rgb((0.8, 0.86, 0.98))), g.mul(hollow, 0.7))
    height = g.add(g.add(g.mul(lumps, 1.3), g.mul(lumps2, 0.6)), g.mul(fine, 0.15))
    _set(g, col, 0.6, 0.0, height=height, wear=0.0, grime=0.0, rust=0.0, streaks=0.0, ao=0.55, bevel=0.03)
    return m


def stone(color=0x8a8a88, tex='cliff_side', scale=1.7, contrast=0.9, band=0.16, k=1.12, seed=0, snow=0.0, grime=0.25,
          cracks=0.0):
    """Neutral light-grey rock (the game tints it per climate): the luminance of a CC0 rock photo projected
    triplanar (strata kept horizontal), normalised around 1; stratum tones (nat_shade), fine horizontal bands,
    soft mottling, crevice darkening (AO + a little grime), worn light edges. snow > 0: snow on the upward
    faces where nat_snow, thick where nat_snow is ~1. k compensates the baked AO so the mean lands on `color`."""
    m, g = _new(_key('nat_stone', color, tex, scale, contrast, band, k, seed, snow, grime, cracks), 'stone')
    if g is None:
        return m
    P = g.obj()
    x, y, z = g.xyz(P)
    _nx, ny, _nz = g.xyz(_onormal(g))
    mean = tex_mean_lum(tex)
    lum = _triplanar_lum(g, tex, scale, (seed * 0.37, seed * 0.11, seed * 0.53))
    t = g.math('DIVIDE', lum, mean)
    tone = _mad(g, g.sub(t, 1.0), contrast, 1.0)
    tone = g.math('MAXIMUM', tone, 0.25)
    bands = g.noise(_xyz(g, g.mul(x, 0.6), g.mul(y, 16.0), g.mul(z, 0.6)), 1.0, 2, 0.5)
    tone = g.mul(tone, _mad(g, g.sub(bands, 0.5), band * 2.0, 1.0))
    mott = g.noise(P, 2.4, 3, 0.55)
    tone = g.mul(tone, _mad(g, g.sub(mott, 0.5), 0.3, 1.0))
    tone = g.mul(tone, _attr(g, 'nat_shade'))
    base = tuple(c * k for c in srgb(color))
    col = g.scalec(g.rgb(base), tone)
    # a hint of warm / cool variation (kept small: the game tints the rock per climate)
    cv = g.noise(g.vadd(P, (3.1, 0.0, 1.7)), 1.3, 2)
    col = g.mixc(col, g.mulc(col, g.rgb((1.06, 1.0, 0.92))), g.mul(g.smooth(cv, 0.5, 0.7), 0.8))
    height = g.add(g.mul(t, 0.7), g.mul(bands, 0.2))
    if cracks:
        # a warped Voronoi crack network (thin dark lines, sunk in the normal map)
        wv = g.vadd(g.vmul(P, (1.0, 1.0, 1.0)), g.scalec(g.noise(P, 3.0, 2, 0.5), 0.35))
        ed = _vor(g, g.vadd(wv, (seed * 0.7, 0.0, 0.0)), 3.2, out='Distance', feature='DISTANCE_TO_EDGE')
        ed2 = _vor(g, g.vadd(wv, (0.0, seed * 0.4, 1.3)), 7.5, out='Distance', feature='DISTANCE_TO_EDGE')
        ck = g.math('MAXIMUM', g.inv(g.smooth(ed, 0.0, 0.03)), g.mul(g.inv(g.smooth(ed2, 0.0, 0.025)), 0.6))
        ck = g.mul(ck, g.smooth(g.noise(g.vadd(P, (5.0, 1.0, 2.0)), 2.0, 2), 0.4, 0.6), clamp=True)
        col = g.scalec(col, g.sub(1.0, g.mul(ck, 0.55 * cracks)))
        height = g.sub(height, g.mul(ck, 0.9 * cracks))
        t = g.mul(t, g.sub(1.0, g.mul(ck, 0.7)))
    rough = g.val(0.9)
    if snow > 0:
        snowv = _attr(g, 'nat_snow')
        up = g.smooth(ny, 0.45, 0.85)
        br = g.noise(P, 7.0, 3, 0.6)
        # thick where nat_snow ~1 (tops), a dusting where it is low (ledges); the cracks stay dark
        amt = g.add(g.mul(snowv, 1.15 * snow), g.mul(g.sub(br, 0.5), 0.8))
        sf = g.mul(g.smooth(amt, 0.3, 0.55), up, clamp=True)
        sf = g.mul(sf, g.smooth(t, 0.35, 0.8), clamp=True)
        col, rough, height = _snowify(g, col, rough, height, sf, 1.2)
    _set(g, col, rough, 0.0, height=height, wear=0.3, grime=grime, rust=0.0, streaks=0.25, ao=0.6, bevel=0.02,
         concrete=True)
    return m


# ---------------------------------------------------------------------------------------------------------
# trees

def tube(p, mat, pts, radii, seg=6, cap=True, flare=0.0, seed=0, shade=1.0, smooth=True):
    """Tapered tube through points (trunks, limbs, twigs); parallel-transport frames; flare = root buttresses
    at the first ring; cap closes the end with a short point."""
    pts = [Vector(q) for q in pts]
    tans = []
    for i in range(len(pts)):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        tans.append((b - a).normalized())
    ref = Vector((1, 0, 0)) if abs(tans[0].x) < 0.9 else Vector((0, 0, 1))
    nrm = (ref - tans[0] * ref.dot(tans[0])).normalized()
    frames = []
    for i, t in enumerate(tans):
        if i > 0:
            nrm = tans[i - 1].rotation_difference(t) @ nrm
            nrm = (nrm - t * nrm.dot(t)).normalized()
        frames.append((nrm.copy(), t.cross(nrm)))
    rng = random.Random(seed)
    ph = rng.random() * 6.28

    def fn(B):
        rings = []
        for i, (c, r) in enumerate(zip(pts, radii)):
            n_, b_ = frames[i]
            ring = []
            for k in range(seg):
                a = 2 * math.pi * k / seg
                rr = r * (1 + 0.08 * nz(c + Vector((math.cos(a), 0, math.sin(a))), 9.0, seed))
                if i == 0 and flare:
                    rr *= 1 + flare * max(0.0, math.cos(3 * a + ph)) ** 2
                ring.append(B.v(c + (n_ * math.cos(a) + b_ * math.sin(a)) * rr, 0.0, shade))
            rings.append(ring)
        for i in range(len(rings) - 1):
            for k in range(seg):
                k2 = (k + 1) % seg
                B.f((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
        if cap:
            tv = B.v(pts[-1] + tans[-1] * radii[-1] * 1.6, 0.0, shade)
            for k in range(seg):
                B.f((rings[-1][k], rings[-1][(k + 1) % seg], tv))
    return emit(p, mat, fn, smooth)


def _polar_face(B, verts, coords, L, du, uvl, pre, chunk=6, voff=0.0):
    """Face with preset atlas UVs from (line index j | None, v) per vertex: u = j * du (strips of `chunk` lines;
    None = the apex, u between its neighbours), v as given. Rectangular strips pack tightly."""
    f = B.f(verts)
    if f is None:
        return None
    js = [c[0] for c in coords if c[0] is not None]
    wrap = js and max(js) - min(js) > L / 2
    js = [j + L if (wrap and j < L / 2) else j for j in js]
    j0 = min(js)
    c0 = (j0 // chunk) * chunk
    mid = sum(js) / len(js)
    for lp, (j, v) in zip(f.loops, coords):
        if j is None:
            jj = mid
        else:
            jj = j + L if (wrap and j < L / 2) else j
        lp[uvl].uv = ((jj - c0) * du, v + voff)
    f[pre] = 1.0
    return f


def conifer_tier(p, mat, y_rim, y_top, R, n, seed, shade=1.0, notch=0.66, droop=1.45, ridge=0.03, sag=0.045,
                 under=True, edge=True, rot=0.0, rings=(0.36, 0.7, 1.0), snow=None, mantle=None, snow_mat_=None,
                 thick=None, tilt=0.06):
    """One drooping tier of a fir: a corrugated skirt of n branch fronds (ridged midribs out to jagged tips, V
    notches between them that sit lower and closer in, the rim sagging at the tips), a thick needle edge
    (edge=True), an underside (under=True) and optionally a snow mantle (mantle=(hem, thick)) in snow_mat_ over
    its upper part. snow(s, tip) -> nat_snow per vertex (material snow). Preset polar atlas UVs."""
    rng = random.Random(seed)
    L = 2 * n
    h = y_top - y_rim
    tk = thick if thick is not None else 0.045 * R / 0.47 + 0.012
    lines = []
    for j in range(L):
        tip = j % 2 == 0
        a0 = rot + 2 * math.pi * j / L + (rng.random() - 0.5) * (math.pi / L) * (0.7 if tip else 0.35)
        ln = R * (0.8 + rng.random() * 0.36) * (1.15 if rng.random() < 0.15 else 1.0) if tip else R * notch * (0.86 + rng.random() * 0.28)
        curve = (rng.random() - 0.5) * (0.6 / n) if tip else 0.0
        sh = shade * (0.86 + rng.random() * 0.28) if tip else shade
        sg = 0.5 + rng.random() * 1.1 if tip else 1.0
        lines.append((tip, a0, ln, curve, sh, sg))
    ta = rng.random() * 6.28
    tx, tz = math.cos(ta) * tilt * rng.random(), math.sin(ta) * tilt * rng.random()

    def pos(j, s, lift=0.0, out=1.0):
        tip, a0, ln, curve, _sh, sg = lines[j % L]
        rr = ln * s * out
        a = a0 + curve * s * s
        rf = min(1.25, rr / R)
        y = y_top - h * rf ** droop
        if tip:
            y += ridge * math.sin(math.pi * min(1.0, s * 1.12)) - sag * sg * s ** 3
        else:
            y -= h * rf ** droop * 0.4 * s + ridge * 0.4 * math.sin(math.pi * s)
        x, z = math.cos(a) * rr, math.sin(a) * rr
        return Vector((x, y + lift + x * tx + z * tz, z))

    def tipf(j, s):
        return s if lines[j][0] else s * 0.8

    def uat(j):
        return 0.0 if lines[j % L][0] else 1.0

    r_ref = 0.7 * R
    du = 2 * math.pi / L * r_ref
    slant = math.sqrt(R * R + h * h)

    def fn(B):
        uvl = B.bm.loops.layers.uv.get(Mt.ATLAS_UV) or B.bm.loops.layers.uv.new(Mt.ATLAS_UV)
        pre = B.bm.faces.layers.float.get('rh_preuv') or B.bm.faces.layers.float.new('rh_preuv')
        apex = B.v((0, y_top, 0), 0.0, shade, snow(0.0, True) if snow else 0.0, 0.5)
        grid = []
        for s in rings:
            ring = []
            for j in range(L):
                sv = snow(s, lines[j][0]) if snow else 0.0
                ring.append(B.v(pos(j, s), tipf(j, s), lines[j][4] if s > 0.5 else shade, sv, uat(j)))
            grid.append(ring)
        for j in range(L):
            j2 = (j + 1) % L
            _polar_face(B, (apex, grid[0][j2], grid[0][j]), ((None, 0.0), (j2, rings[0] * slant), (j, rings[0] * slant)), L, du, uvl, pre)
        for k in range(len(grid) - 1):
            A, C = grid[k], grid[k + 1]
            for j in range(L):
                j2 = (j + 1) % L
                _polar_face(B, (A[j], A[j2], C[j2], C[j]),
                            ((j, rings[k] * slant), (j2, rings[k] * slant), (j2, rings[k + 1] * slant), (j, rings[k + 1] * slant)),
                            L, du, uvl, pre)
        rim = grid[-1]
        if edge:
            rim2 = []
            for j in range(L):
                tip = lines[j][0]
                w = pos(j, 0.93, -tk * (1.0 if tip else 0.7))
                rim2.append(B.v(w, tipf(j, 1.0) * 0.95, lines[j][4] * 0.95, 0.0, uat(j)))
            for j in range(L):
                j2 = (j + 1) % L
                _polar_face(B, (rim[j], rim[j2], rim2[j2], rim2[j]),
                            ((j, slant), (j2, slant), (j2, slant + tk), (j, slant + tk)), L, du, uvl, pre)
            rim = rim2
        if under:
            uc = B.v((0, y_rim + h * 0.45, 0), 0.3, shade * 0.8, 0.0, 0.5)
            for j in range(L):
                j2 = (j + 1) % L
                _polar_face(B, (uc, rim[j], rim[j2]), ((None, 0.0), (j, slant), (j2, slant)), L, du, uvl, pre, voff=10.0)
    faces = emit(p, mat, fn, smooth=True)
    if mantle is not None and snow_mat_ is not None:
        hem, mth = mantle
        mr = random.Random(seed * 31 + 7)

        def fm(B):
            uvl = B.bm.loops.layers.uv.get(Mt.ATLAS_UV) or B.bm.loops.layers.uv.new(Mt.ATLAS_UV)
            pre = B.bm.faces.layers.float.get('rh_preuv') or B.bm.faces.layers.float.new('rh_preuv')
            hems = [hem * (0.84 + mr.random() * 0.32) if lines[j][0] else min(0.97, hem * (1.05 + mr.random() * 0.15)) for j in range(L)]
            th = [mth * (0.65 + mr.random() * 0.7) for j in range(L)]

            def lump(w, k):
                return w + Vector((0.0, nz(w, 9.0, seed) * mth * 0.45 * k, 0.0))
            apex = B.v((0, y_top + mth * 1.1, 0), 0.0, 1.0, 1.0, 0.5)
            r1 = [B.v(lump(pos(j, hems[j] * 0.5, th[j] * 1.05), 1.0), hems[j] * 0.5, 1.0, 1.0, uat(j)) for j in range(L)]
            r2 = [B.v(lump(pos(j, hems[j] * 0.9, th[j] * 0.95, 1.05), 0.8), hems[j] * 0.9, 0.97, 1.0, uat(j)) for j in range(L)]
            r3 = [B.v(pos(j, min(1.0, hems[j] + 0.08), 0.003, 1.0), hems[j], 0.75, 1.0, uat(j)) for j in range(L)]
            for j in range(L):
                j2 = (j + 1) % L
                _polar_face(B, (apex, r1[j2], r1[j]), ((None, 0.0), (j2, 0.5 * hem * slant), (j, 0.5 * hem * slant)), L, du, uvl, pre)
            vv = (0.5 * hem * slant, 0.9 * hem * slant, (hem + 0.08) * slant + mth)
            for k, (A, C) in enumerate(((r1, r2), (r2, r3))):
                for j in range(L):
                    j2 = (j + 1) % L
                    _polar_face(B, (A[j], A[j2], C[j2], C[j]), ((j, vv[k]), (j2, vv[k]), (j2, vv[k + 1]), (j, vv[k + 1])), L, du, uvl, pre)
        emit(p, snow_mat_, fm, smooth=True)
    return faces


def conifer(m, H=1.48, R0=0.47, tiers=5, seed=1, n0=9, y0=0.32, sub=True, snow=None, needles_mat=None,
            bark_mat=None, trunk_r=0.062, hem=0.72, thick=0.034, dust=0.0, n_min=5, hk=1.0, sub_from=0):
    """A whole fir: trunk + `tiers` drooping tiers from rim height y0 up to the tip at H, bottom radius R0.
    snow: None | 'heavy' (snow mantles on every tier) | 'light' (dusting on the tier tops by the material)."""
    r = m.root
    nd = needles_mat or needles(dust=dust)
    bk = bark_mat or bark()
    sm = snow_mat(seed) if snow == 'heavy' else None
    rng = random.Random(seed)
    sy = H / 1.48
    specs = []
    h_last = 0.30 * sy * hk
    y_last = H - h_last
    for k in range(tiers):
        t = k / (tiers - 1)
        Rk = R0 * (1 - 0.7 * t) * (0.95 + rng.random() * 0.1)
        yr = y0 + (y_last - y0) * t ** 0.95
        hgt = (0.4 - 0.1 * t) * sy * hk if k < tiers - 1 else h_last
        nk = max(n_min, round(n0 - (n0 - n_min) * t))
        specs.append((yr, yr + hgt, Rk, nk, 0.84 + 0.28 * t))
    # trunk (root flare at the base; its top hides in the upper tiers)
    tube(r, bk, [(0, -0.03, 0), (0, 0.08, 0), (0, 0.45, 0), (0, H * 0.75, 0)],
         [trunk_r * 1.25, trunk_r, trunk_r * 0.72, trunk_r * 0.3], seg=6, cap=False, flare=0.45, seed=seed)
    for k, (yr, yt, Rk, nk, sh) in enumerate(specs):
        rot = rng.random() * 6.28
        sn = None
        if snow == 'light':
            def sn(s, tip, k=k):
                return 0.5 * (1.0 - 0.3 * s) * (0.8 + 0.2 * k / max(1, tiers - 1))
        elif snow == 'heavy':
            def sn(s, tip):
                return 0.8 if s < hem + 0.1 else 0.2
        mantle = (hem * (1.0 if k < tiers - 1 else 1.1), thick * (0.75 + 0.25 * (1 - k / tiers))) if sm else None
        conifer_tier(r, nd, yr, yt, Rk, nk, seed * 101 + k, shade=sh, rot=rot, under=True, snow=sn,
                     mantle=mantle, snow_mat_=sm, droop=1.45 if k < tiers - 1 else 1.15,
                     sag=0.045 if k < tiers - 1 else 0.015)
        if sub and sub_from <= k < tiers - 1:
            hgt = yt - yr
            conifer_tier(r, nd, yr + hgt * 0.16, yt - hgt * 0.12, Rk * 0.8, nk, seed * 211 + k, shade=sh * 0.92,
                         rot=rot + math.pi / (2 * nk), under=False, edge=True, rings=(0.45, 1.0), snow=sn,
                         thick=0.03 * Rk / 0.47 + 0.01)
    return specs


def clump(p, mat, at, r, seed, squash=(1.0, 0.8, 1.0), lump=0.24, bottom=-0.35, flat=0.45, crown=None, shade=1.0,
          subdiv=2, snow=0.0):
    """A leaf cluster: a noise-displaced icosphere (80 triangles), flattened underneath. crown=(centre, radii)
    sets nat_tip = how far out on the crown surface each vertex is (inner faces darker)."""
    at = Vector(at)
    sq = Vector(squash)

    def fn(B):
        res = bmesh.ops.create_icosphere(B.bm, subdivisions=subdiv, radius=1.0)
        vs = res['verts']
        for v in vs:
            d = v.co.normalized()
            k = 1 + lump * nz(d, 1.6, seed) + lump * 0.4 * nz(d, 3.4, seed + 3)
            co = Vector((d.x * sq.x, d.y * sq.y, d.z * sq.z)) * r * k
            if co.y < bottom * r:
                co.y = bottom * r + (co.y - bottom * r) * flat
            w = co + at
            v.co = w
            if crown is not None:
                c, rad = crown
                q = Vector(((w.x - c[0]) / rad[0], (w.y - c[1]) / rad[1], (w.z - c[2]) / rad[2]))
                tipv = min(1.0, max(0.0, q.length))
            else:
                tipv = min(1.0, max(0.0, 0.5 + 0.5 * d.y))
            B.attrs(v, tipv, shade, snow)
        B.verts.extend(vs)
        B.faces.extend(res['faces'] if 'faces' in res else [])
    return emit(p, mat, fn, smooth=True)


def spike(p, mat, a, b, r, seg=3, shade=1.0):
    """A thin pointed twig from a to b (3-sided cone)."""
    a, b = Vector(a), Vector(b)
    t = (b - a).normalized()
    ref = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 0, 1))
    n_ = (ref - t * ref.dot(t)).normalized()
    b_ = t.cross(n_)

    def fn(B):
        ring = [B.v(a + (n_ * math.cos(2 * math.pi * k / seg) + b_ * math.sin(2 * math.pi * k / seg)) * r, 0.0, shade)
                for k in range(seg)]
        tv = B.v(b, 0.0, shade)
        for k in range(seg):
            B.f((ring[k], ring[(k + 1) % seg], tv))
    return emit(p, mat, fn, smooth=True)


# ---------------------------------------------------------------------------------------------------------
# rocks

def outline(n, ax, az, seed, rough=0.12, front=None, dents=2, dent=0.06, rot=0.0):
    """Irregular closed outline (x, z), counter-clockwise seen from above (+Y), radii ax / az. front=z:
    flatten the +Z side at z (a steep cliff face). dents: vertical crack grooves (inward notches)."""
    rng = random.Random(seed)
    pts = []
    dent_at = set(rng.sample(range(n), dents)) if dents else set()
    for i in range(n):
        a = rot + 2 * math.pi * i / n + (rng.random() - 0.5) * (math.pi / n) * 0.8
        k = 1 + (rng.random() - 0.5) * 2 * rough
        if i in dent_at:
            k -= dent / max(ax, az)
        x, z = math.cos(a) * ax * k, math.sin(a) * az * k
        if front is not None and z > front:
            z = front + (z - front) * 0.15
        pts.append((x, z))
    # counter-clockwise from above: angle goes x -> -z (game +Z is south / down on a top view)
    return list(reversed(pts)) if _area(pts) > 0 else pts


def _area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, z0 = pts[i]
        x1, z1 = pts[(i + 1) % len(pts)]
        a += x0 * z1 - x1 * z0
    return a / 2


def strata_slab(p, mat, pts, y0, y1, seed, shade=1.0, snow=0.0, bulge=0.035, chamfer=0.03, dome=0.012,
                amp=0.02, offset=(0.0, 0.0), cap_mat=None, cap=None):
    """One rock stratum: an irregular slab through rings (bottom, bulging middle, top edge, chamfered top rim,
    a slightly domed top) with noise displacement; open underneath (it rests on the stratum below or the
    ground). nat_snow = snow on its top. cap=(thick, inset) + cap_mat: a snow cap lying on the top."""
    n = len(pts)
    cx = sum(q[0] for q in pts) / n + offset[0]
    cz = sum(q[1] for q in pts) / n + offset[1]
    P = [(q[0] + offset[0], q[1] + offset[1]) for q in pts]

    def ring(y, k, toward=0.0, dy=0.0, amp_k=1.0):
        out = []
        for (x, z) in P:
            xx = cx + (x - cx) * k
            zz = cz + (z - cz) * k
            if toward:
                d = Vector((x - cx, 0, z - cz))
                if d.length > 1e-6:
                    d.normalize()
                    xx -= d.x * toward
                    zz -= d.z * toward
            w = Vector((xx, y + dy, zz))
            dsp = nz(w, 5.5, seed) * amp * amp_k
            dv = Vector((xx - cx, 0, zz - cz))
            if dv.length > 1e-6:
                dv.normalize()
            w += dv * dsp
            w.y += nz(w, 7.0, seed + 11) * amp * 0.4 * amp_k
            out.append(w)
        return out
    h = y1 - y0
    R0 = ring(y0, 1.0, amp_k=1.0)
    R1 = ring(y0 + h * 0.45, 1.0 + bulge, amp_k=1.2)
    R2 = ring(y1 - chamfer, 1.0, amp_k=0.8)
    R3 = ring(y1, 1.0, toward=chamfer * 1.1, amp_k=0.5)
    R4 = ring(y1 + dome * 0.6, 0.55, amp_k=0.3)
    C = Vector((cx, y1 + dome, cz))

    def fn(B):
        def mk(rw, tip, sn):
            return [B.v(w, tip, shade, sn) for w in rw]
        rr = [mk(R0, 0.0, 0.0), mk(R1, 0.2, 0.0), mk(R2, 0.5, snow * 0.5), mk(R3, 0.8, snow), mk(R4, 1.0, snow)]
        c = B.v(C, 1.0, shade, snow)
        for k in range(len(rr) - 1):
            A, D = rr[k], rr[k + 1]
            for i in range(n):
                i2 = (i + 1) % n
                B.f((A[i], A[i2], D[i2], D[i]))
        for i in range(n):
            B.f((rr[-1][i], rr[-1][(i + 1) % n], c))
        bmesh.ops.recalc_face_normals(B.bm, faces=B.faces)
        # recalc on an open shell may pick inwards: the top must face up
        top = [f for f in B.faces if c in f.verts]
        if top:
            top[0].normal_update()
            if top[0].normal.y < 0:
                bmesh.ops.reverse_faces(B.bm, faces=B.faces)
    faces = emit(p, mat, fn, smooth=False)
    if cap is not None and cap_mat is not None:
        thick, inset = cap
        Q3 = ring(y1 + 0.004, 1.0, toward=chamfer * 1.1 + inset, amp_k=0.5)
        Q2 = ring(y1 + thick * 0.75, 1.0, toward=chamfer * 1.1 + inset + thick * 0.6, amp_k=0.4)
        Q1 = ring(y1 + dome * 0.6 + thick, 0.5, amp_k=0.3)
        Cc = Vector((cx, y1 + dome + thick * 1.1, cz))
        rng = random.Random(seed)

        def fc(B):
            rows = []
            for rw in (Q3, Q2, Q1):
                row = []
                for w in rw:
                    ww = w.copy()
                    if rw is not Q3:
                        ww.y += (rng.random() - 0.5) * thick * 0.5
                    row.append(B.v(ww, 1.0, 1.0, 1.0))
                rows.append(row)
            c = B.v(Cc, 1.0, 1.0, 1.0)
            for k in range(len(rows) - 1):
                A, D = rows[k], rows[k + 1]
                for i in range(n):
                    i2 = (i + 1) % n
                    B.f((A[i], A[i2], D[i2], D[i]))
            for i in range(n):
                B.f((rows[-1][i], rows[-1][(i + 1) % n], c))
            top = [f for f in B.faces if c in f.verts]
            top[0].normal_update()
            if top[0].normal.y < 0:
                bmesh.ops.reverse_faces(B.bm, faces=B.faces)
        emit(p, cap_mat, fc, smooth=True)
    return faces


def hull_rock(p, mat, at, size, seed, npts=20, cuts=1, amp=0.05, bottom_y=-0.06, shade=1.0, snow=0.0, yaw=0.0,
              smooth_k=0.3):
    """Chunky boulder: the convex hull of jittered points on an ellipsoid (planar fracture facets) centred at
    `at` with full size `size`, each edge split `cuts` times and noise-displaced (rounded, irregular), cut flat
    at y = bottom_y (model space; keep it below the ground: the buried bottom is culled). nat_tip = height on
    the rock (0 bottom .. 1 top), nat_snow = snow."""
    rng = random.Random(seed)
    at = Vector(at)
    sx, sy, sz = size
    cyw, syw = math.cos(yaw), math.sin(yaw)
    lo = bottom_y - at.y

    def fn(B):
        bm = B.bm
        before = set(bm.verts)
        vs = []
        ga = math.pi * (3 - math.sqrt(5))
        for i in range(npts):
            yy = 1 - 2 * (i + 0.5) / npts
            rr = math.sqrt(max(0.0, 1 - yy * yy))
            a = ga * i + rng.random() * 0.6
            d = Vector((math.cos(a) * rr, yy, math.sin(a) * rr))
            d *= 0.8 + rng.random() * 0.32
            vs.append(bm.verts.new((d.x * sx / 2, max(lo, d.y * sy / 2), d.z * sz / 2)))
        res = bmesh.ops.convex_hull(bm, input=vs)
        # points inside the hull (no faces after it) are dropped; each vertex once
        dead = [v for v in vs if v.is_valid and not v.link_faces]
        if dead:
            bmesh.ops.delete(bm, geom=dead, context='VERTS')
        faces = list({f for v in bm.verts if v not in before for f in v.link_faces})
        bmesh.ops.triangulate(bm, faces=faces)
        faces = list({f for v in bm.verts if v not in before for f in v.link_faces})
        edges = list({e for f in faces for e in f.edges})
        if cuts:
            bmesh.ops.subdivide_edges(bm, edges=edges, cuts=cuts, use_grid_fill=True, smooth=smooth_k)
        allv = [v for v in bm.verts if v not in before]
        top = max(v.co.y for v in allv)
        for v in allv:
            c = v.co.copy()
            n = Vector((c.x / sx, c.y / sy, c.z / sz))
            if n.length > 1e-6:
                n.normalize()
            d = nz(c, 3.2, seed) * amp + nz(c, 7.5, seed + 5) * amp * 0.35
            w = c + Vector((n.x * sx, n.y * sy, n.z * sz)) * d
            if w.y < lo:
                w.y = lo
            hy = (w.y - lo) / max(1e-3, top - lo)
            w = Vector((w.x * cyw - w.z * syw, w.y, w.x * syw + w.z * cyw)) + at
            v.co = w
            B.attrs(v, min(1.0, max(0.0, hy)), shade, snow)
            B.verts.append(v)
        fs = list({f for v in B.verts for f in v.link_faces})
        B.faces.extend(fs)
        bmesh.ops.recalc_face_normals(bm, faces=fs)
    return emit(p, mat, fn, smooth=False)


def broadleaf(m, trunk, limbs, clusters, crown, leaf_mat, bark_mat, seed=1, flare=0.5, twigs=(), snow=0.0,
              lump=0.24, flat=0.45, bottom=-0.35):
    """A deciduous tree: trunk = (points, radii) with root flare; limbs = [(points, radii)] (tapered, capped);
    clusters = [(centre, radius, squash)] leaf clusters (crown = (centre, radii) for the inner shade);
    twigs = [(a, b, r)] thin spikes poking out of the foliage (scrub)."""
    r = m.root
    rng = random.Random(seed)
    tube(r, bark_mat, trunk[0], trunk[1], seg=6, cap=False, flare=flare, seed=seed)
    for i, (pts, rad) in enumerate(limbs):
        tube(r, bark_mat, pts, rad, seg=5, cap=True, seed=seed * 17 + i)
    for i, (at, rr, sq) in enumerate(clusters):
        clump(r, leaf_mat, at, rr, seed * 31 + i, squash=sq, lump=lump, flat=flat, bottom=bottom, crown=crown,
              shade=0.86 + rng.random() * 0.28, snow=snow)
    for i, (a, b, w) in enumerate(twigs):
        spike(r, bark_mat, a, b, w)


def strata(m, slabs, mat, snow=False, cap_mat=None, seed=1, n=13):
    """Stacked strata: slabs = [(y0, y1, ax, az, (ox, oz), front | None, rough)] bottom to top; each its own
    tone (nat_shade). snow: thick on the top slab (+ a snow cap in cap_mat), a dusting on the ledges."""
    r = m.root
    # keep every face: the open-bottomed slabs rest on each other, and the hidden-face cull judged whole top fans
    # (rim to centre) buried under the stratum above, leaving hollow rings
    r.cull = False
    rng = random.Random(seed)
    last = len(slabs) - 1
    for i, (y0, y1, ax, az, off, front, rough) in enumerate(slabs):
        pts = outline(n, ax, az, seed * 13 + i, rough=rough, front=None if front is None else front - off[1],
                      dents=2 if ax > 0.25 else 1, dent=0.05, rot=rng.random() * 6.28)
        sh = 0.84 + rng.random() * 0.32
        sn = (1.0 if i == last else 0.38) if snow else 0.0
        cap = (0.045, 0.02) if (snow and i == last and cap_mat is not None) else None
        strata_slab(r, mat, pts, y0, y1, seed * 7 + i, shade=sh, snow=sn, offset=off, cap=cap, cap_mat=cap_mat,
                    chamfer=0.028 + 0.01 * rng.random(), amp=0.022)


def debris(m, mat, rocks, seed=1, snow=0.0):
    """Loose stones: [(at, size)] small convex-hull rocks."""
    for i, (at, size) in enumerate(rocks):
        hull_rock(m.root, mat, at, size, seed * 19 + i, npts=12, cuts=1, amp=0.04, shade=0.85 + 0.1 * (i % 3),
                  snow=snow, yaw=i * 1.7)
