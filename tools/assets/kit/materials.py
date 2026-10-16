"""Smart materials for the HD kit.

Every kit material is a Cycles node tree that computes the channels the bake needs:

    base   linear albedo (team areas: TEAM_GREY paint; the game multiplies it by the team colour)
    rough  roughness            metal  metalness
    team   team-colour mask     emit   emissive strength (0..4) with base = the light colour
    emode  emissive animation   (0 steady, 1 blink, 2 pulse, 3 fire flicker, 4 strobe)
    height bump height (panel seams, rivets, texture relief, height decals)

Weathering (edge wear, cavity grime, rust, rain streaks, baked AO) is added on top of the raw channels when
the model is finalised, from two masks baked first (kit.bake phase 1): 'ao' (ambient occlusion with the
ground) and 'edge' (bevel-shader curvature), plus noise and the pinned Poly Haven inputs (CC0). Decals are
projected before weathering, so slogans and emblems get chipped and streaked too.

Content scripts only call the factory functions below (painted, concrete, metal, ...) and pass the result
to the shape helpers; equal arguments return the same material (one atlas island set per material kind).
"""
import math
import os

import bpy

from . import patterns

TEX_DIR = os.path.join(os.environ.get('RH_CACHE', os.path.expanduser('~/.cache/red-horizon')), 'textures')
ATLAS_UV = 'atlas'
TEAM_GREY = 0.7  # linear albedo of clean team paint in the bake; the runtime scales by teamColor / TEAM_GREY
DIRT_H = 0.2  # ground dirt / splash height (model units); kit.run lowers it for units (they are low to the ground)
EDGE_LIGHT = 0.07  # catch-light on every edge (was 0.22: together with the wear it outlined every silhouette
#                   in a pale halo at RTS distances)

_cache = {}
_graphs = {}  # material name -> _Graph (until finalize)
_images = {}


# ---------------------------------------------------------------------------------------------------------
# Node graph helper

class _Graph:
    """Tiny expression builder over a material node tree. Arguments are numbers, tuples or sockets."""

    def __init__(self, mat):
        self.mat = mat
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = 0
        self.ch = {}
        self.params = {}
        self.explicit = set()  # weathering keys set with set_weather (model look defaults leave them alone)

    def node(self, kind, **props):
        n = self.nt.nodes.new(kind)
        n.location = (self.x, 0)
        self.x += 30
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def _in(self, sock, v):
        if v is None:
            return
        if isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        elif isinstance(v, (tuple, list)):
            if len(v) == 3 and sock.type == 'RGBA':
                sock.default_value = (v[0], v[1], v[2], 1.0)
            else:
                sock.default_value = v
        else:
            sock.default_value = v

    def val(self, v):
        if isinstance(v, bpy.types.NodeSocket):
            return v
        n = self.node('ShaderNodeValue')
        n.outputs[0].default_value = float(v)
        return n.outputs[0]

    def rgb(self, c):
        if isinstance(c, bpy.types.NodeSocket):
            return c
        n = self.node('ShaderNodeRGB')
        n.outputs[0].default_value = (c[0], c[1], c[2], 1.0)
        return n.outputs[0]

    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self._in(n.inputs[0], a)
        if b is not None:
            self._in(n.inputs[1], b)
        if c is not None:
            self._in(n.inputs[2], c)
        return n.outputs[0]

    def add(self, a, b, clamp=False):
        return self.math('ADD', a, b, clamp=clamp)

    def mul(self, a, b, clamp=False):
        return self.math('MULTIPLY', a, b, clamp=clamp)

    def sub(self, a, b, clamp=False):
        return self.math('SUBTRACT', a, b, clamp=clamp)

    def inv(self, a):
        return self.math('SUBTRACT', 1.0, a, clamp=True)

    def smooth(self, x, lo, hi):
        n = self.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        self._in(n.inputs[0], x)
        n.inputs[1].default_value = lo
        n.inputs[2].default_value = hi
        return n.outputs[0]

    def mixf(self, a, b, f):
        n = self.node('ShaderNodeMix', data_type='FLOAT', clamp_factor=True)
        self._in(n.inputs[0], f)
        self._in(n.inputs[2], a)
        self._in(n.inputs[3], b)
        return n.outputs[0]

    def mixc(self, a, b, f, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_factor=True)
        self._in(n.inputs[0], f)
        self._in(n.inputs[6], a)
        self._in(n.inputs[7], b)
        return n.outputs[2]

    def mulc(self, a, b):
        return self.mixc(a, b, 1.0, 'MULTIPLY')

    def scalec(self, a, k):
        """colour * scalar"""
        n = self.node('ShaderNodeVectorMath', operation='SCALE')
        self._in(n.inputs[0], a)
        self._in(n.inputs[3], k)
        return n.outputs[0]

    def lum(self, c):
        n = self.node('ShaderNodeRGBToBW')
        self._in(n.inputs[0], c)
        return n.outputs[0]

    def sep(self, c):
        n = self.node('ShaderNodeSeparateColor')
        self._in(n.inputs[0], c)
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def comb(self, r, g, b):
        n = self.node('ShaderNodeCombineColor')
        self._in(n.inputs[0], r)
        self._in(n.inputs[1], g)
        self._in(n.inputs[2], b)
        return n.outputs[0]

    def xyz(self, v):
        n = self.node('ShaderNodeSeparateXYZ')
        self._in(n.inputs[0], v)
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def vmul(self, v, s):
        n = self.node('ShaderNodeVectorMath', operation='MULTIPLY')
        self._in(n.inputs[0], v)
        self._in(n.inputs[1], s)
        return n.outputs[0]

    def vadd(self, v, s):
        n = self.node('ShaderNodeVectorMath', operation='ADD')
        self._in(n.inputs[0], v)
        self._in(n.inputs[1], s)
        return n.outputs[0]

    def dot(self, a, b):
        n = self.node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
        self._in(n.inputs[0], a)
        self._in(n.inputs[1], b)
        return n.outputs[1]

    def geo(self, out):
        """Geometry node output: 'Position' (Blender world, Z up), 'Normal', 'True Normal'..."""
        return self.node('ShaderNodeNewGeometry').outputs[out]

    def obj(self):
        """Object coordinates = the part's local GAME frame (Y up)."""
        return self.node('ShaderNodeTexCoord').outputs['Object']

    def uv(self):
        return self.node('ShaderNodeUVMap', uv_map=ATLAS_UV).outputs[0]

    def noise(self, vec, scale, detail=2.0, rough=0.55, dist=0.0):
        n = self.node('ShaderNodeTexNoise', noise_dimensions='3D')
        self._in(n.inputs['Vector'], vec)
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        n.inputs['Distortion'].default_value = dist
        return n.outputs['Fac']

    def image(self, img, vec, proj='BOX', blend=0.25, ext='REPEAT', interp='Linear'):
        n = self.node('ShaderNodeTexImage', image=img, projection=proj, extension=ext, interpolation=interp)
        if proj == 'BOX':
            n.projection_blend = blend
        self._in(n.inputs[0], vec)
        return n.outputs['Color'], n.outputs['Alpha']

    def tex(self, tid, kind='diffuse', scale=3.6, offset=0.0, vec=None):
        """Box-projected Poly Haven input (kind 'diffuse' | 'arm') in object space, `scale` tiles per unit."""
        img = ph_image(tid, kind)
        v = vec if vec is not None else self.obj()
        v = self.vadd(self.vmul(v, (scale, scale, scale)), (offset, offset * 1.7, offset * 0.6))
        return self.image(img, v)

    def mask(self, name):
        """A mask baked in phase 1 ('ao', 'edge'), sampled through the atlas UVs."""
        img = bpy.data.images.get(f'RHMASK_{name}')
        if img is None:
            img = bpy.data.images.new(f'RHMASK_{name}', 8, 8, float_buffer=True)
            img.colorspace_settings.name = 'Non-Color'
        c, _ = self.image(img, self.uv(), proj='FLAT', ext='EXTEND')
        return self.sep(c)[0]

    def reroute(self, name, sock):
        n = self.node('NodeReroute')
        n.name = name
        n.label = name
        self.nt.links.new(sock, n.inputs[0])
        return n.outputs[0]


def ph_image(tid, kind):
    key = f'PH_{tid}_{kind}'
    img = bpy.data.images.get(key)
    if img is None:
        path = os.path.join(TEX_DIR, tid, f'{kind}.jpg')
        if not os.path.exists(path):
            raise FileNotFoundError(f'{path} missing: run node tools/assets/fetch-textures.mjs')
        img = bpy.data.images.load(path)
        img.name = key
        img.colorspace_settings.name = 'sRGB' if kind == 'diffuse' else 'Non-Color'
    return img


def pattern_image(name, **kw):
    key = 'PAT_' + name + '_' + '_'.join(f'{k}{v}' for k, v in sorted(kw.items()))
    img = bpy.data.images.get(key)
    if img is None:
        img = patterns.make(name, key, **kw)
    return img


# ---------------------------------------------------------------------------------------------------------
# Material registry

def _new(key, kind, atlas=True):
    if key in _cache:
        return _cache[key], None
    m = bpy.data.materials.new(f'RH_{kind}_{len(_cache)}')
    m.use_nodes = True
    m['rh_atlas'] = atlas
    m['rh_kind'] = kind
    _cache[key] = m
    g = _Graph(m)
    _graphs[m.name] = g
    return m, g


WEATHER_KEYS = ('wear', 'grime', 'rust', 'streaks', 'ao', 'soot', 'bevel')


def set_weather(mat, **params):
    """Adjust the weathering of a kit material after creating it (before the bake): wear, grime, rust, streaks,
    ao (how much baked AO darkens the albedo, default 0.55), soot=(y0, y1), bevel (shader bevel radius).
    Note: materials are shared by equal arguments, so this changes every part using that material."""
    g = _graphs.get(mat.name)
    if g is None:
        raise KeyError(f'{mat.name} is not a kit atlas material')
    for k in params:
        if k not in WEATHER_KEYS:
            raise KeyError(f'set_weather(): unknown parameter {k}; one of {WEATHER_KEYS}')
    g.params.update(params)
    g.explicit.update(params)
    return mat


def is_atlas(mat):
    return bool(mat.get('rh_atlas', False))


def by_name(name):
    m = bpy.data.materials.get(name)
    if m is None:
        raise KeyError(name)
    return m


def _set(g, base, rough, metal, team=0.0, emit=0.0, emode=0.0, height=0.0, **weather):
    g.ch = {'base': g.rgb(base), 'rough': g.val(rough), 'metal': g.val(metal), 'team': g.val(team),
            'emit': g.val(emit), 'emode': g.val(emode), 'height': g.val(height)}
    w = dict(wear=0.5, grime=0.5, rust=0.0, streaks=0.5, ao=0.55, edge_tint=None, concrete=False, bevel=0.012, soot=None)
    w.update(weather)
    g.params = w


def _key(*a, **kw):
    return repr((a, sorted(kw.items())))


def srgb(c):
    """sRGB hex (0xRRGGBB) or (r, g, b) 0..1 sRGB -> linear tuple."""
    if isinstance(c, int):
        c = ((c >> 16 & 255) / 255.0, (c >> 8 & 255) / 255.0, (c & 255) / 255.0)

    def f(x):
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return (f(c[0]), f(c[1]), f(c[2]))


# ---------------------------------------------------------------------------------------------------------
# Material factories (all colours are sRGB hex like the procedural palette, e.g. 0x3a3d42)

def painted(color=0x4a4e54, team=False, wear=0.55, grime=0.5, rust=0.25, streaks=0.5, rough=0.55,
            metal=0.15, panels=None, rivets=True, var=0.12, tex='green_metal_rust', scale=1.0, bevel=0.012, soot=None):
    """Painted steel. team=True paints it in the team colour (TEAM_GREY in the bake) with a team mask.
    panels=(w, h) adds panel seams (units) with rivet rows when rivets=True. var = paint mottling.
    soot=(y0, y1): blackened from height y0 up to y1 (model space; smokestack tops, exhaust stacks)."""
    m, g = _new(_key('painted', color, team, wear, grime, rust, streaks, rough, metal, panels, rivets, var, tex, scale, bevel, soot), 'painted')
    if g is None:
        return m
    base = (TEAM_GREY,) * 3 if team else srgb(color)
    t_col, _ = g.tex(tex, 'diffuse', 2.2 * scale, offset=len(_cache) * 0.37)
    # paint mottling: the texture's luminance around its mean, plus a soft large-scale noise
    lum = g.lum(t_col)
    mott = g.add(g.mul(g.sub(lum, 0.32), 1.2 * var), g.mul(g.sub(g.noise(g.obj(), 2.6, 4, 0.6), 0.5), var * 2.2))
    col = g.scalec(g.rgb(base), g.add(1.0, mott))
    height = g.mul(g.noise(g.obj(), 60.0, 2, 0.5), 0.12)  # orange-peel paint (texture relief would show its drips)
    if panels:
        pimg = pattern_image('panels', rivets=1 if rivets else 0)
        tile = 1.0 / max(1e-3, panels[0] * 2), 1.0 / max(1e-3, panels[1] * 3)
        pc, _ = g.image(pimg, g.vmul(g.obj(), (tile[0], tile[1], tile[0])), blend=0.15)
        ph, pseam, ptone = g.sep(pc)
        height = g.add(height, g.mul(ph, 2.5))
        col = g.scalec(col, g.mul(g.sub(1.0, g.mul(pseam, 0.62)), g.add(0.86, g.mul(ptone, 0.28))))
    _set(g, col, rough, metal, 1.0 if team else 0.0, height=height, wear=wear, grime=grime, rust=rust, streaks=streaks, bevel=bevel, soot=soot)
    return m


def team(wear=0.5, grime=0.45, rust=0.15, panels=None, rivets=True, rough=0.5):
    """Team-colour paint (trims, panels, banners on metal)."""
    return painted(0xb3b3b3, team=True, wear=wear, grime=grime, rust=rust, panels=panels, rivets=rivets, rough=rough, var=0.08)


def concrete(color=0x8a857c, grime=0.6, streaks=0.7, wear=0.6, joints=None, scale=1.0, tex='concrete_wall_008', rough=0.92, bevel=0.016, soot=None):
    """Cast concrete. joints=(w, h) adds formwork / block joints (units). soot=(y0, y1) as painted()."""
    m, g = _new(_key('concrete', color, grime, streaks, wear, joints, scale, tex, rough, bevel, soot), 'concrete')
    if g is None:
        return m
    t_col, _ = g.tex(tex, 'diffuse', 1.4 * scale, offset=len(_cache) * 0.53)
    lum = g.lum(t_col)
    col = g.scalec(g.rgb(srgb(color)), g.add(0.55, g.mul(lum, 0.9)))
    stain = g.smooth(g.noise(g.obj(), 1.6, 4, 0.6), 0.45, 0.75)
    col = g.scalec(col, g.sub(1.0, g.mul(stain, 0.18)))
    height = g.mul(lum, 0.6)
    if joints:
        pimg = pattern_image('blocks')
        tile = 1.0 / max(1e-3, joints[0] * 2), 1.0 / max(1e-3, joints[1] * 4)
        pc, _ = g.image(pimg, g.vmul(g.obj(), (tile[0], tile[1], tile[0])), blend=0.15)
        ph, pseam, _b = g.sep(pc)
        height = g.add(height, ph)
        col = g.scalec(col, g.sub(1.0, g.mul(pseam, 0.3)))
    _set(g, col, rough, 0.0, height=height, wear=wear, grime=grime, rust=0.0, streaks=streaks, concrete=True, bevel=bevel, soot=soot)
    return m


def metal(color=0x3c4046, rough=0.42, metal=0.85, wear=0.35, grime=0.45, rust=0.2, streaks=0.3, tex='metal_plate', var=0.08, bevel=0.01):
    """Bare / dark steel: gun barrels, pipes, machinery, rails."""
    m, g = _new(_key('metal', color, rough, metal, wear, grime, rust, streaks, tex, var, bevel), 'metal')
    if g is None:
        return m
    t_col, _ = g.tex(tex, 'diffuse', 3.0, offset=len(_cache) * 0.29)
    lum = g.lum(t_col)
    col = g.scalec(g.rgb(srgb(color)), g.add(1.0 - var, g.mul(lum, var * 4)))
    _set(g, col, g.add(rough, g.mul(g.sub(lum, 0.25), 0.3)), metal, height=g.mul(lum, 0.15), wear=wear, grime=grime, rust=rust, streaks=streaks, bevel=bevel)
    return m


def rusty(color=0x5a4636, amount=0.8):
    """Heavily rusted steel (old pipes, tanks, scrap)."""
    m, g = _new(_key('rusty', color, amount), 'rusty')
    if g is None:
        return m
    t_col, _ = g.tex('rusty_painted_metal', 'diffuse', 1.6, offset=len(_cache) * 0.41)
    r_col, _ = g.tex('rusty_metal_02', 'diffuse', 2.4, offset=len(_cache) * 0.19)
    col = g.mixc(g.rgb(srgb(color)), g.mulc(t_col, r_col), amount)
    _set(g, col, 0.78, 0.35, height=g.mul(g.lum(t_col), 0.4), wear=0.2, grime=0.6, rust=0.4 * amount, streaks=0.6)
    return m


def corrugated(color=0x55595e, team=False, along='y', pitch=0.035, wear=0.45, grime=0.5, rust=0.35, streaks=0.7):
    """Corrugated sheet cladding; ribs run along `along` ('y' vertical ribs, 'x' / 'z' horizontal), `pitch` units."""
    m, g = _new(_key('corrugated', color, team, along, pitch, wear, grime, rust, streaks), 'corrugated')
    if g is None:
        return m
    o = g.obj()
    x, y, z = g.xyz(o)
    # ribs: a sine of the horizontal coordinate(s) (vertical ribs) or of the height (horizontal ribs)
    coord = g.add(x, z) if along == 'y' else y
    ribs = g.math('SINE', g.mul(coord, 2 * math.pi / pitch))
    t_col, _ = g.tex('corrugated_iron_02', 'diffuse', 1.2, offset=len(_cache) * 0.31)
    base = (TEAM_GREY,) * 3 if team else srgb(color)
    col = g.scalec(g.rgb(base), g.add(0.72, g.mul(g.lum(t_col), 0.8)))
    col = g.scalec(col, g.add(0.94, g.mul(ribs, 0.06)))
    _set(g, col, 0.6, 0.25, 1.0 if team else 0.0, height=g.mul(ribs, 0.9), wear=wear, grime=grime, rust=rust, streaks=streaks)
    return m


def tread(color=0x4a4c50):
    """Diamond tread plate (walkways, catwalks, decks)."""
    m, g = _new(_key('tread', color), 'tread')
    if g is None:
        return m
    t_col, _ = g.tex('metal_plate', 'diffuse', 5.0)
    lum = g.lum(t_col)
    col = g.scalec(g.rgb(srgb(color)), g.add(0.6, lum))
    _set(g, col, 0.5, 0.7, height=g.mul(lum, 1.2), wear=0.6, grime=0.6, rust=0.3, streaks=0.2)
    return m


def rubber(color=0x1e1e20):
    m, g = _new(_key('rubber', color), 'rubber')
    if g is None:
        return m
    n = g.noise(g.obj(), 30.0, 2)
    _set(g, g.scalec(g.rgb(srgb(color)), g.add(0.85, g.mul(n, 0.3))), 0.88, 0.0, height=g.mul(n, 0.2), wear=0.1, grime=0.4, streaks=0.1)
    return m


def cloth(color=0xa01c18, team=False, grime=0.35):
    """Banners, tarps: matte fabric with a weave."""
    m, g = _new(_key('cloth', color, team, grime), 'cloth')
    if g is None:
        return m
    weave = g.noise(g.obj(), 140.0, 1, 0.3)
    base = (TEAM_GREY,) * 3 if team else srgb(color)
    col = g.scalec(g.rgb(base), g.add(0.86, g.mul(weave, 0.24)))
    _set(g, col, 0.88, 0.0, 1.0 if team else 0.0, height=g.mul(weave, 0.15), wear=0.05, grime=grime, streaks=0.3, bevel=0.004)
    return m


def glass(color=0x1a2632, lit=None, strength=1.0):
    """Window glass. lit=0xRRGGBB makes it a lit window (emissive; dims when the building loses power)."""
    m, g = _new(_key('glass', color, lit, strength), 'glass')
    if g is None:
        return m
    if lit is not None:
        n = g.noise(g.obj(), 9.0, 2)
        col = g.scalec(g.rgb(srgb(lit)), g.add(0.75, g.mul(n, 0.5)))
        _set(g, col, 0.15, 0.0, emit=strength, wear=0.0, grime=0.2, streaks=0.0, bevel=0.003)
    else:
        n = g.noise(g.geo('Position'), 3.0, 2)
        col = g.scalec(g.rgb(srgb(color)), g.add(0.8, g.mul(n, 0.4)))
        _set(g, col, 0.06, 0.1, wear=0.0, grime=0.25, streaks=0.2, bevel=0.003)
    return m


def light(color=0xff2a1a, strength=2.2, mode='steady'):
    """Emissive lamp lens. mode: 'steady' | 'blink' | 'pulse' | 'flicker' | 'strobe' (animated in the game)."""
    mode_i = {'steady': 0, 'blink': 1, 'pulse': 2, 'flicker': 3, 'strobe': 4}[mode]
    m, g = _new(_key('light', color, strength, mode_i), 'light')
    if g is None:
        return m
    _set(g, srgb(color), 0.3, 0.0, emit=strength, emode=mode_i, wear=0.0, grime=0.0, streaks=0.0, bevel=0.002)
    return m


def flat(color, rough=0.6, metal=0.0, team=False):
    """Plain unweathered surface (rarely needed: gauges, signs that decals cover)."""
    m, g = _new(_key('flat', color, rough, metal, team), 'flat')
    if g is None:
        return m
    _set(g, (TEAM_GREY,) * 3 if team else srgb(color), rough, metal, 1.0 if team else 0.0, wear=0.1, grime=0.2, streaks=0.1)
    return m


def track_material():
    """The scrolling tread (the game's shared track material); geometry needs belt UVs (u along the belt in
    links, v across 0..1). Not baked into the atlas."""
    m = bpy.data.materials.get('track')
    if m is None:
        m = bpy.data.materials.new('track')
        m.use_nodes = True
        m['rh_atlas'] = False
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (0.03, 0.03, 0.035, 1)
        bsdf.inputs['Roughness'].default_value = 0.7
    return m


def glow_material(slot='glow:blink', color=0xff3020, double_sided=False):
    """Separately animated emissive (the procedural 'glow:<slot>' meshes, driven by the type's anim). One slot
    can hold several colours (a shipyard's red and green harbour lights): each colour is its own material here,
    exported into the slot's one mesh as per-vertex COLOR_0, which the game's glow material uses.
    double_sided=True also emits the back faces (thin fins, flags, rings seen from both sides)."""
    if not slot.startswith('glow:'):
        slot = 'glow:' + slot
    key = f'{slot}#{color:06x}' + ('#2s' if double_sided else '')
    m = bpy.data.materials.get(key)
    if m is None:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        m['rh_atlas'] = False
        m['rh_slot'] = slot
        m['rh_color'] = srgb(color)
        m['rh_double'] = bool(double_sided)
    return m


# ---------------------------------------------------------------------------------------------------------
# Finalisation: decals + weathering + outputs (called by kit.run after the model is built)

def all_atlas_materials():
    return [m for m in _cache.values() if is_atlas(m)]


def finalize(decals, look=None):
    """look: per-model material defaults from Model.look (only 'ao' today): applied to every material that did
    not set the key with set_weather, except glass and lamps."""
    look = {k: v for k, v in (look or {}).items() if k in ('ao',)}
    for m in all_atlas_materials():
        g = _graphs.get(m.name)
        if g is None or 'base' not in g.ch:
            continue
        if m.get('rh_kind') not in ('glass', 'light'):
            for k, v in look.items():
                if k not in g.explicit:
                    g.params[k] = float(v)
        _finalize(g, decals)


def _finalize(g, decals):
    ch = dict(g.ch)
    w = g.params
    N = g.geo('Normal')
    # ---- decals (projected boxes; see kit.decals): only those touching faces of this material
    for d in decals:
        if d.mats is None or g.mat.name in d.mats:
            d.apply(g, ch, N)
    # ---- weathering from the baked masks (ao: 1 = open; edge: 1 = on a bevelled edge)
    ao = g.mask('ao')
    edge = g.mask('edge')
    P = g.geo('Position')  # Blender world: z = game up
    _x, _y, nz = g.xyz(N)
    vert = g.inv(g.math('ABSOLUTE', nz))
    px, py, pz = g.xyz(P)
    n_fine = g.noise(P, 34.0, 3, 0.6)
    n_mid = g.noise(P, 7.0, 3, 0.55)
    n_big = g.noise(P, 1.6, 2, 0.5)
    cav = g.inv(ao)
    expo = g.smooth(ao, 0.5, 0.85)
    # edge wear: exposed bevelled edges, broken up by noise
    # (the amount shifts the threshold: more wear = more chipped edges, each chip fully bare)
    wear = g.mul(g.smooth(g.add(g.add(edge, g.mul(g.sub(n_fine, 0.5), 0.85)), (w['wear'] - 0.5) * 0.7), 0.5, 0.66), g.mul(expo, min(1.0, w['wear'] * 4)), clamp=True)
    # cavity grime (under ledges, corners, against walls) and ground dirt splashed up the walls
    grime = g.mul(g.smooth(g.add(g.mul(cav, 1.5), g.mul(g.sub(n_mid, 0.5), 0.5)), 0.18, 0.75), w['grime'], clamp=True)
    dirt = g.mul(g.mul(g.smooth(g.sub(DIRT_H, pz), 0.0, DIRT_H), g.add(0.5, g.mul(n_mid, 0.7))), g.mul(vert, w['grime']), clamp=True)
    # rust: the Poly Haven rust spots, in crevices and on exposed steel
    rust_src, _ = g.tex('rusty_metal_02', 'diffuse', 2.2, vec=P)
    rr, rg, rb = g.sep(rust_src)
    rustiness = g.smooth(g.sub(rr, rb), 0.06, 0.28)
    rust = g.mul(g.smooth(g.add(g.add(g.add(g.mul(cav, 1.3), g.mul(rustiness, 0.35)), g.mul(g.sub(n_mid, 0.5), 0.3)), (w['rust'] - 0.5) * 0.4), 0.58, 0.9), min(1.0, w['rust'] * 3), clamp=True)
    # rain / soot streaks: vertically stretched noise in clusters on vertical faces, stronger under ledges
    sv = g.comb(g.mul(px, 1.0), g.mul(py, 1.0), g.mul(pz, 0.045))
    sn = g.noise(sv, 30.0, 2, 0.5)
    clusters = g.smooth(n_big, 0.42, 0.62)
    streak = g.mul(g.mul(g.smooth(sn, 0.6, 0.74), g.mul(vert, clusters)), g.mul(w['streaks'], g.add(0.3, g.mul(cav, 1.2))), clamp=True)
    base, rough, metal, team = ch['base'], ch['rough'], ch['metal'], ch['team']
    if w['concrete']:
        base = g.mixc(base, g.scalec(base, 1.18), g.mul(wear, 0.8))
        rough = g.mixf(rough, 0.95, wear)
    else:
        # bare steel: mid grey and metallic (the environment gives it the shine); a light grey here reads as a
        # pale outline around every model at RTS distances
        bare = g.scalec(g.rgb(srgb(0x80838a)), g.add(0.8, g.mul(n_fine, 0.4)))
        base = g.mixc(base, bare, wear)
        rough = g.mixf(rough, 0.3, wear)
        metal = g.mixf(metal, 0.95, wear)
    base = g.mixc(base, g.mulc(rust_src, g.rgb((0.62, 0.5, 0.42))), rust)
    rough = g.mixf(rough, 0.85, rust)
    metal = g.mixf(metal, 0.2, rust)
    base = g.mixc(base, g.mulc(base, g.rgb((0.32, 0.29, 0.25))), grime)
    rough = g.mixf(rough, 0.92, g.mul(grime, 0.6))
    base = g.mixc(base, g.rgb((0.075, 0.065, 0.055)), g.mul(dirt, 0.75))
    streak_col = g.rgb((0.5, 0.4, 0.32)) if not w['concrete'] else g.rgb((0.4, 0.38, 0.35))
    base = g.mixc(base, g.mulc(base, streak_col), g.mul(streak, 0.7))
    if w['soot']:
        y0, y1 = w['soot']
        sk = g.mul(g.smooth(pz, y0, y1), g.add(0.75, g.mul(n_mid, 0.5)), clamp=True)
        base = g.mixc(base, g.mulc(base, g.rgb((0.12, 0.11, 0.1))), sk)
        rough = g.mixf(rough, 0.95, sk)
        team = g.mul(team, g.inv(g.mul(sk, 0.7)))
    base = g.scalec(base, g.add(1.0, g.mul(g.mul(edge, expo), EDGE_LIGHT)))
    # baked AO into the albedo (the game also gets it as aoMap for indirect light)
    aof = g.add(g.mul(ao, w['ao']), 1.0 - w['ao'])
    base = g.scalec(base, aof)
    team = g.mul(g.mul(team, g.inv(wear)), g.inv(g.mul(rust, 0.85)))
    # ---- outputs
    out = {
        'base': base,
        'rough': rough,
        'metal': metal,
        'team': team,
        'emit': ch['emit'],
        'emode': ch['emode'],
    }
    for k, s in out.items():
        g.reroute('RH_' + k, s)
    # normal: bevelled edges (shader bevel) + bump from height
    bev = g.node('ShaderNodeBevel', samples=8)
    bev.inputs['Radius'].default_value = w['bevel']
    bump = g.node('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.6
    bump.inputs['Distance'].default_value = 0.004
    g._in(bump.inputs['Height'], ch['height'])
    g.nt.links.new(bev.outputs[0], bump.inputs['Normal'])
    g.reroute('RH_normal', bump.outputs[0])
    bsdf = g.node('ShaderNodeBsdfPrincipled')
    g.nt.links.new(base, bsdf.inputs['Base Color'])
    g.nt.links.new(rough, bsdf.inputs['Roughness'])
    g.nt.links.new(metal, bsdf.inputs['Metallic'])
    g.nt.links.new(bump.outputs[0], bsdf.inputs['Normal'])
    outn = g.node('ShaderNodeOutputMaterial')
    g.nt.links.new(bsdf.outputs[0], outn.inputs['Surface'])
    g.bsdf = bsdf
    g.output = outn
