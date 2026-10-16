"""[ALLB] Shared Allied dressing for the Allied HD structures (imported by the model scripts in this directory;
build.mjs skips files starting with '_').

Allied look: clean white-painted steel and glass, dark steel frames, blue (team) trims and eagle banners, white
star roundels, hazard bands, floodlights and radar gear -- still weathered (edge wear, grime streaks, deep AO).
Everything here only *uses* the kit (tools/assets/kit): per-model bake knobs through Model.tune, material
weathering through set_weather, decal images through kit.decals.Canvas.

Tuned for the RTS camera (a structure is 150-300 px wide at the default zoom): deeper baked AO, bold
high-contrast faction elements (eagle banners, star roundels, hazard bands) and emissive accents.
"""
import math

import mathutils

from kit import *  # noqa: F401,F403
from kit import decals as _D
from kit.core import T, facing_rot  # noqa: F401

Y0 = 0.05            # top of the foundation slab
NAVY = 0x1d3a78      # fixed Allied navy (non-team accents)
GOLD = 0xe8b434
WHITE_TXT = 0xf1eee6
HAZ_Y = 0xf2b916
WIN_WARM = 0xffd9a0  # office windows
WIN_COOL = 0xcfe6ff  # control rooms / labs
FLOOD = 0xf6f1e2     # floodlight lens


# ---------------------------------------------------------------------------------------------------------
# bake / material pushes

def setup(m, edge=0.14, ao_dist=0.42, dirt_h=0.16, edge_r=0.018):
    """Per-model bake knobs (kit Model.tune): a slightly crisper edge catch-light than the kit default (checked
    for pale outlines at the default zoom) and longer AO rays (deeper crevices)."""
    m.tune(edge_light=edge, edge_radius=edge_r, ao_distance=ao_dist, dirt_h=dirt_h)


def tune(mat, **kw):
    """Weathering overrides for a kit material (kit set_weather: ao strength, bevel...)."""
    return set_weather(mat, **kw)


def white(panels=(0.26, 0.17), wear=0.6, grime=0.5, streaks=0.75, rust=0.1, tone=0xe6e3da, ao=0.78, rivets=True):
    """White-painted steel cladding (Allied walls)."""
    return tune(painted(tone, panels=panels, wear=wear, grime=grime, rust=rust, streaks=streaks, rough=0.62, metal=0.05,
                        var=0.14, rivets=rivets), ao=ao)


def offwhite(panels=(0.3, 0.2), **kw):
    return white(panels=panels, tone=0xc4c1b8, **kw)


def steel(tone=0x5f6a75, panels=(0.24, 0.16), wear=0.65, grime=0.7, rust=0.25, streaks=0.8, ao=0.85):
    """Blue-grey painted steel (frames, cladding, machinery)."""
    return tune(painted(tone, panels=panels, wear=wear, grime=grime, rust=rust, streaks=streaks, rough=0.5, metal=0.3), ao=ao)


def frame(tone=0x30353c, wear=0.75, ao=0.85):
    """Dark steel structure: pilasters, columns, door frames, parapet caps (crisp worn edges)."""
    return tune(painted(tone, panels=None, wear=wear, grime=0.55, rust=0.3, streaks=0.5, rough=0.5, metal=0.35), ao=ao)


def trim(wear=0.6, panels=None):
    """Team-colour paint (cornices, bands, panels)."""
    return tune(team(wear=wear, grime=0.5, rust=0.12, panels=panels), ao=0.8)


def roof(tone=0x565d65, ao=0.9):
    """Flat steel / membrane roof (walkable, grimy, ponding stains)."""
    return tune(concrete(tone, grime=0.85, streaks=0.3, wear=0.5, joints=(0.4, 0.4), tex='rough_concrete', rough=0.85), ao=ao)


def slab_m(tone=0x9b968c, joints=(0.5, 0.5), ao=0.85):
    return tune(concrete(tone, joints=joints, grime=0.7, streaks=0.6), ao=ao)


def asphalt(tone=0x4a4b4f):
    return tune(concrete(tone, grime=0.6, streaks=0.1, wear=0.3, tex='rough_concrete', rough=0.9), ao=0.85)


def yellow(wear=0.7):
    return tune(painted(HAZ_Y, panels=None, wear=wear, grime=0.6, rust=0.25, streaks=0.4, rough=0.5, metal=0.2), ao=0.8)


def rail_m():
    return metal(0x3a3f45, rough=0.5)


def gun_m(tone=0x3b4046):
    return tune(metal(tone, rough=0.45, rust=0.25, wear=0.5), ao=0.85)


def dark_m(tone=0x26292e):
    return metal(tone, rough=0.55, rust=0.25)


def black():
    return flat(0x0b0b0c, 0.95)


# ---------------------------------------------------------------------------------------------------------
# decal images (kit.decals.Canvas)

_imgs = {}


def _cache(key, fn):
    if key not in _imgs:
        _imgs[key] = fn()
    return _imgs[key]


def haz_img(aspect=4.0, px=64):
    """Hazard stripes with a stripe count that follows the aspect (long bands keep short diagonal stripes)."""
    return _cache(('haz', round(aspect, 2)), lambda: hazard_img(px=px, stripes=max(3, int(round(aspect * 1.25))), aspect=aspect))


def frame_img(aspect=0.5, t=0.06, color=WHITE_TXT, px=256):
    """A rectangular outline (banner borders, panel frames). t = line width as a fraction of the short side."""
    def mk():
        w, h = (int(px * aspect), px) if aspect < 1 else (px, int(px / aspect))
        cv = _D.Canvas(w, h, ss=2)
        s = min(w, h) * t
        c = _D.lin(color)
        cv.rect(0, 0, w, s, c)
        cv.rect(0, h - s, w, h, c)
        cv.rect(0, 0, s, h, c)
        cv.rect(w - s, 0, w, h, c)
        return cv.image()
    return _cache(('frame', aspect, t, color), mk)


def disc_img(color=0xdadada, px=128):
    def mk():
        cv = _D.Canvas(px, px, ss=2)
        cv.circle(px / 2, px / 2, px * 0.49, _D.lin(color))
        return cv.image()
    return _cache(('disc', color), mk)


def roundel_img(ring=WHITE_TXT, px=256, ring_in=0.4):
    """White outer ring + white five-pointed star (transparent between: the team disc shows through)."""
    def mk():
        cv = _D.Canvas(px, px)
        c = px / 2
        cv.circle(c, c, px * 0.49, _D.lin(ring), r_in=px * ring_in)
        pts = _D.star_points(c, c * 0.985, px * 0.34)
        tris = [((c, c * 0.985), pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
        cv.fill(cv.cover(tris), _D.lin(ring), 1.0, 0.6)
        cv.roughen(0.12, seed=5)
        return cv.image()
    return _cache(('roundel', ring, ring_in), mk)


def chevron_img(n=3, color=HAZ_Y, px=128):
    """n stacked chevrons pointing up (+v), transparent background (apron markings)."""
    def mk():
        w, h = px * 2, px * n
        cv = _D.Canvas(w, h, ss=2)
        col = _D.lin(color)
        for i in range(n):
            y = i * px + px * 0.15
            t = px * 0.32
            cv.poly([(0, y), (w / 2, y + px * 0.55), (w / 2, y + px * 0.55 + t), (0, y + t)], col)
            cv.poly([(w, y), (w, y + t), (w / 2, y + px * 0.55 + t), (w / 2, y + px * 0.55)], col)
        cv.roughen(0.35, seed=9)
        return cv.image()
    return _cache(('chev', n, color), mk)


def lit_panes_img(cols, rows=1, lit=None, color=WIN_WARM, px=48):
    """Only the lit panes of a windows_img grid (transparent elsewhere): an emissive overlay."""
    def mk():
        w, h = px * cols, int(px * rows * 1.1)
        cv = _D.Canvas(w, h, ss=2)
        ph = h / rows
        for r_ in range(rows):
            for c_ in range(cols):
                i = r_ * cols + c_
                if lit is not None and i not in lit:
                    continue
                x0, y0 = c_ * px + px * 0.1, r_ * ph + ph * 0.12
                cv.rect(x0, y0, x0 + px * 0.8, y0 + ph * 0.76, _D.lin(color))
                cv.rect(x0, y0, x0 + px * 0.8, y0 + ph * 0.14, _D.lin(color) * 0.55)
        return cv.image()
    return _cache(('litp', cols, rows, tuple(sorted(lit)) if lit is not None else None, color), mk)


def windows_img(cols, rows=1, lit=None, color=WIN_WARM, dark=0x18212b, frame=0x2a2e33, px=48):
    """A strip of window panes (cols x rows) with mullions; lit = set of lit pane indices (None: all lit)."""
    def mk():
        w, h = px * cols, int(px * rows * 1.1)
        cv = _D.Canvas(w, h, ss=2)
        cv.rect(0, 0, w, h, _D.lin(frame), height=0.6)
        ph = h / rows
        for r_ in range(rows):
            for c_ in range(cols):
                i = r_ * cols + c_
                on = lit is None or i in lit
                x0, y0 = c_ * px + px * 0.1, r_ * ph + ph * 0.12
                cv.rect(x0, y0, x0 + px * 0.8, y0 + ph * 0.76, _D.lin(color if on else dark), height=0.3)
                if on:  # a darker lower sill shade inside the pane
                    cv.rect(x0, y0, x0 + px * 0.8, y0 + ph * 0.14, _D.lin(color) * 0.55, height=0.3)
        return cv.image()
    return _cache(('win', cols, rows, tuple(sorted(lit)) if lit is not None else None, color), mk)


def stripes_img(n=6, a=WHITE_TXT, b=None, px=64, vertical=True):
    """Alternating bands (runway / aviation stripes); b None = transparent gaps."""
    def mk():
        w, h = (px * n, px) if not vertical else (px * n, px)
        cv = _D.Canvas(w, h, ss=1)
        for i in range(n):
            col = a if i % 2 == 0 else b
            if col is not None:
                cv.rect(i * px, 0, (i + 1) * px, h, _D.lin(col))
        return cv.image()
    return _cache(('stripes', n, a, b), mk)


# ---------------------------------------------------------------------------------------------------------
# faction dressing

def eagle_banner(m, p, at, size, facing='+z', star=True, border=True):
    """Big team-colour cloth banner: white inner border, a large white spread eagle, a star above, gold hem.
    at = top centre on the wall."""
    w, h = size
    banner(m, p, at, size, facing=facing, emblem=None, color='team')
    F = T(at, facing_rot(facing))

    def xf(v):
        return tuple(F @ mathutils.Vector(v))
    if border:
        m.decal(frame_img(w / h, 0.07), at=xf((0, -h * 0.5, 0.008)), size=(w * 0.9, h * 0.9), facing=facing, part=p,
                depth=0.03, team=0, rough=0.8)
    es = min(w * 0.86, h * 0.62)
    m.decal(allied_eagle(), at=xf((0, -h * (0.56 if star else 0.48), 0.008)), size=(es, es), facing=facing, part=p,
            depth=0.03, team=0, rough=0.75)
    if star:
        m.decal(_star_img(), at=xf((0, -h * 0.17, 0.008)), size=(w * 0.32, w * 0.32), facing=facing, part=p, depth=0.03,
                team=0, rough=0.75)


def _star_img():
    def mk():
        px = 128
        cv = _D.Canvas(px, px)
        c = px / 2
        pts = _D.star_points(c, c * 0.98, px * 0.47)
        tris = [((c, c * 0.98), pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
        cv.fill(cv.cover(tris), _D.lin(WHITE_TXT), 1.0, 0.6)
        return cv.image()
    return _cache('star', mk)


def roundel(m, p, at, size, facing='+z', depth=0.03, team_disc=True, disc=None, plate=None):
    """Star roundel painted on a surface: team (or fixed) disc, white outer ring, white star.
    plate = a material: paints it on a thin plate instead (relief, and only the plate gets the decal's extra atlas
    density, not the whole roof or wall under it)."""
    if plate is not None:
        F = T(at, facing_rot(facing))
        if facing == '+y':
            cyl(p, plate, size * 0.5, 0.006, tuple(F @ mathutils.Vector((0, 0, 0.003))), seg=20)
        else:
            box(p, plate, (size * 0.96, size * 0.96, 0.006), tuple(F @ mathutils.Vector((0, 0, 0.003))), facing_rot(facing))
        at = tuple(F @ mathutils.Vector((0, 0, 0.006)))
        depth = 0.0035
    if team_disc:
        m.decal(disc_img(), at=at, size=(size * 0.98, size * 0.98), facing=facing, part=p, depth=depth, team=1, rough=0.55)
    else:
        m.decal(disc_img(disc or NAVY), at=at, size=(size * 0.98, size * 0.98), facing=facing, part=p, depth=depth, team=0, rough=0.55)
    m.decal(roundel_img(), at=at, size=(size, size), facing=facing, part=p, depth=depth, team=0, rough=0.55)


def mark(m, p, img, at, size, base, roll=0.0, **kw):
    """Ground / roof marking on a thin strip of `base` laid on the surface at `at` (top of the surface): only
    the strip gets the decal (and its extra atlas density), not the whole slab under it."""
    x, y, z = at
    w, h = size
    box(p, base, (w + 0.012, 0.004, h + 0.012), (x, y + 0.002, z), (0, roll, 0))
    kw.setdefault('team', 0)
    m.decal(img, at=(x, y + 0.004, z), size=size, facing='+y', part=p, depth=0.0025, roll=roll, **kw)


def floodlight(p, at, yaw=0.0, pitch=0.55, s=0.05, strength=3.2, mount=None):
    """Chunky floodlight: bracket + housing + bright lens. at = mount point; the lamp faces yaw (0 = +Z)
    tilted down by pitch."""
    housing = gun_m(0x2c3035)
    x, y, z = at
    if mount is not None:
        bar(p, housing, (x, y - mount, z), (x, y, z), s * 0.22)
    rot = (pitch, yaw, 0.0)
    F = T(at, rot)
    def xf(v):
        return tuple(F @ mathutils.Vector(v))
    box(p, housing, (s * 1.25, s * 0.85, s * 0.7), xf((0, 0, s * 0.2)), rot, bevel=s * 0.12)
    box(p, light_mat(FLOOD, strength, 'steady'), (s * 1.05, s * 0.66, s * 0.04), xf((0, 0, s * 0.56)), rot)
    box(p, housing, (s * 1.3, s * 0.08, s * 0.5), xf((0, s * 0.45, s * 0.42)), rot)  # hood


def flood_mast(m, p, at, h, n=2, yaw=0.0, s=0.05, beacon=True):
    """Lighting mast: lattice-ish pole, a crossbar with n floodlights (facing yaw), red beacon on top."""
    x, y, z = at
    pole = gun_m(0x3a3f46)
    cyl(p, pole, 0.022, h, (x, y + h / 2, z), r2=0.014, seg=8)
    cyl(p, frame(), 0.05, 0.04, (x, y + 0.02, z), seg=8, bevel=0.006)
    cx, cz = math.cos(yaw), -math.sin(yaw)  # crossbar perpendicular to the lamp direction
    half = s * 0.75 * n
    bar(p, pole, (x - cx * half, y + h - 0.02, z - cz * half), (x + cx * half, y + h - 0.02, z + cz * half), 0.014)
    fx, fz = math.sin(yaw), math.cos(yaw)
    for i in range(n):
        t = -half + (i + 0.5) * (2 * half / n)
        floodlight(p, (x + cx * t + fx * 0.02, y + h - 0.02, z + cz * t + fz * 0.02), yaw=yaw, pitch=0.6, s=s)
    if beacon:
        light(p, (x, y + h + 0.01, z), 0.014, 0xff2a1a, 'blink')


def strobe(p, at, r=0.016, color=0xf0f4ff):
    """White aviation strobe (Allied corner lights)."""
    light(p, at, r, color, 'strobe', strength=3.0)


def lit_sign(m, p, at, size, text, facing='+z', emblem_kind='allied', lights=2, emit=0.55, board=None, **kw):
    """Navy (team) sign board with backlit white lettering and an eagle; lamps on top."""
    sign(m, p, at, size, text, facing=facing, board=board or trim(wear=0.45), text_color=WHITE_TXT, lights=lights,
         emblem=emblem_kind, emit=emit, **kw)


def hazard_band(m, p, at, size, facing='+z', depth=0.02, roll=0.0, base=None):
    """Hazard stripes; on the ground pass base= (the surface material): they go on a thin strip (see mark)."""
    w, h = size
    if base is not None and facing == '+y':
        return mark(m, p, haz_img(w / h), at, size, base, roll=roll, rough=0.6)
    m.decal(haz_img(w / h), at=at, size=size, facing=facing, part=p, depth=depth, team=0, rough=0.6, roll=roll)


def lit_doorway(m, p, at, size, facing='+z', warm=WIN_WARM, frame_m=None, glow=0.75, hazard=True):
    """Open doorway with a lit interior (reads at distance and at night): dark reveal, a warm emissive back
    wall, a dark frame with a hazard lintel. at = bottom centre on the wall."""
    w, h = size
    F = T(at, facing_rot(facing))
    def xf(v):
        return tuple(F @ mathutils.Vector(v))
    rot = facing_rot(facing)
    fm = frame_m or frame()
    box(p, black(), (w, h, 0.008), xf((0, h / 2, 0.002)), rot)
    box(p, light_mat(warm, glow, 'steady'), (w * 0.72, h * 0.62, 0.004), xf((0, h * 0.4, 0.007)), rot)
    t = 0.03
    for (x, y, ww, hh) in ((0, h + t / 2, w + 2 * t, t), (-w / 2 - t / 2, h / 2, t, h), (w / 2 + t / 2, h / 2, t, h)):
        box(p, fm, (ww, hh, 0.03), xf((x, y, 0.015)), rot, bevel=0.004)
    if hazard:
        m.decal(haz_img((w + 2 * t) / t), at=xf((0, h + t / 2, 0.03)), size=(w + 2 * t, t * 0.95), facing=facing,
                part=p, depth=0.02, team=0)


def glazing(m, p, at, size, cols, facing='+z', lit=None, color=WIN_COOL, emit=0.7, tint=0x2b4762, depth=0.012):
    """Glass pane (dark reflective blue) with a lit-pane pattern decal (emissive where lit): reads as glass by
    day and as lit windows at night. at = centre on the wall, size (w, h)."""
    w, h = size
    box(p, glass(tint), (w, h, 0.008), at, facing_rot(facing))
    m.decal(windows_img(cols, 1, lit=set(), color=color, dark=tint, frame=0x23272c), at=at, size=(w, h), facing=facing, part=p,
            depth=depth, team=0, rough=0.12)
    if lit is None or len(lit):
        m.decal(lit_panes_img(cols, 1, lit=lit, color=color), at=at, size=(w, h), facing=facing, part=p, depth=depth, team=0,
                rough=0.2, emit=emit)


def drums(p, at, n=3, colors=(0x2f5f9a, 0x9a8f2a, 0x5a5f66)):
    x, y, z = at
    offs = [(0, 0), (0.085, 0.02), (0.035, 0.08), (0.12, 0.09), (-0.05, 0.07)]
    for i in range(n):
        dx, dz = offs[i % len(offs)]
        mat = painted(colors[i % len(colors)], panels=None, wear=0.6, rust=0.45, grime=0.6)
        cyl(p, mat, 0.038, 0.11, (x + dx, y + 0.055, z + dz), seg=10, bevel=0.004)
        cyl(p, dark_m(), 0.039, 0.008, (x + dx, y + 0.075, z + dz), seg=10, caps=False)


def crates(p, at, n=3, s=0.09, rot=0.2):
    x, y, z = at
    wood = tune(painted(0x7a6a48, panels=None, wear=0.4, rust=0.0, grime=0.7, streaks=0.3, rough=0.85, metal=0.0), ao=0.8)
    olive = painted(0x4f5a3a, panels=None, wear=0.6, rust=0.3, grime=0.6)
    pos = [(0, 0, 0), (s * 1.05, 0, 0.01), (s * 0.5, s, 0.005), (-s * 0.1, 0, s * 1.05)]
    for i in range(n):
        dx, dy, dz = pos[i % len(pos)]
        box(p, wood if i % 2 == 0 else olive, (s, s * 0.85, s), (x + dx, y + dy + s * 0.425, z + dz), (0, rot * (i % 2), 0), bevel=0.006)


def flag_pole(m, p, at, h=0.9, size=(0.36, 0.22), yaw=0.0, part=None):
    """Flagpole with a team-colour Allied flag (eagle, white border) flying toward +x (after yaw). If `part` is
    given the cloth goes into that part (an animated 'flag' node at the pole top); at = pole foot."""
    x, y, z = at
    pole = metal(0xb0b4b8, rough=0.35, rust=0.1)
    cyl(p, slab_m(0x8a857c), 0.05, 0.04, (x, y + 0.02, z), seg=10, bevel=0.006)
    cyl(p, pole, 0.011, h, (x, y + h / 2, z), r2=0.008, seg=8)
    sphere(p, metal(0xd8b040, rough=0.3), 0.016, (x, y + h + 0.01, z), seg=8, rings=5)
    fp = part or p
    w, hh = size
    off = (0, 0, 0) if part is not None else (x, y + h - 0.02, z)
    rot = (0.0, yaw, 0.0)
    F = T(off, rot)

    def xf(v):
        return tuple(F @ mathutils.Vector(v))
    cl = cloth(team=True)
    nx = 6
    for i in range(nx):
        u0, u1 = i / nx, (i + 1) / nx
        z0 = 0.02 * math.sin(u0 * math.pi * 1.6)
        z1 = 0.02 * math.sin(u1 * math.pi * 1.6)
        cx = 0.012 + (u0 + u1) / 2 * w
        cz = (z0 + z1) / 2
        ang = math.atan2(z1 - z0, w / nx)
        box(fp, cl, (w / nx + 0.002, hh, 0.004), xf((cx, -hh / 2, cz)), (0.0, yaw - ang, 0.0))
    for fc, sgn in (('+z', 1), ('-z', -1)):
        m.decal(frame_img(w / hh, 0.08), at=xf((0.012 + w / 2, -hh / 2, 0.0)), size=(w * 0.94, hh * 0.9), facing=yaw if fc == '+z' else yaw + math.pi,
                part=fp, depth=0.03, team=0, rough=0.8)
        m.decal(allied_eagle(), at=xf((0.012 + w / 2, -hh / 2, 0.0)), size=(hh * 0.85, hh * 0.85), facing=yaw if fc == '+z' else yaw + math.pi,
                part=fp, depth=0.03, team=0, rough=0.75)


def lamp_post(p, at, h=0.42, yaw=0.0):
    """Street lamp: pole, arm, hooded lamp (warm)."""
    x, y, z = at
    pole = dark_m()
    cyl(p, pole, 0.012, h, (x, y + h / 2, z), r2=0.009, seg=6)
    fx, fz = math.sin(yaw), math.cos(yaw)
    bar(p, pole, (x, y + h - 0.01, z), (x + fx * 0.09, y + h - 0.01, z + fz * 0.09), 0.012)
    box(p, gun_m(), (0.05, 0.022, 0.06), (x + fx * 0.09, y + h - 0.02, z + fz * 0.09), (0, yaw, 0), bevel=0.005)
    box(p, light_mat(0xffd49a, 2.6, 'steady'), (0.038, 0.004, 0.046), (x + fx * 0.09, y + h - 0.032, z + fz * 0.09), (0, yaw, 0))


def parapet_rect(p, mat, x0, z0, x1, z1, y, h=0.045, t=0.035, bevel=0.006):
    """Raised parapet around a roof rectangle (top at y + h)."""
    slab(p, mat, x0, x1, y, y + h, z1 - t, z1, bevel=bevel)
    slab(p, mat, x0, x1, y, y + h, z0, z0 + t, bevel=bevel)
    slab(p, mat, x0, x0 + t, y, y + h, z0 + t, z1 - t, bevel=bevel)
    slab(p, mat, x1 - t, x1, y, y + h, z0 + t, z1 - t, bevel=bevel)


def block(m, p, x, z, w, d, h, wall=None, base=None, cornice=None, roof_m=None, cap=None, plinth=0.1, y0=Y0,
          pilasters=(), side_pilasters=(), band=True, parapet=True, cornice_h=0.055):
    """Allied building block centred at (x, z): concrete plinth, white walls, dark pilasters (front x list /
    east side z list), a team cornice, a membrane roof inside a dark parapet. Returns the roof top y."""
    wall = wall or white()
    base = base or slab_m(0x8d887f)
    cornice = cornice or trim()
    roof_m = roof_m or roof()
    cap = cap or frame()
    box(p, base, (w + 0.04, plinth, d + 0.04), (x, y0 + plinth / 2, z), bevel=0.012)
    box(p, wall, (w, h - plinth, d), (x, y0 + plinth + (h - plinth) / 2, z), bevel=0.01)
    top = y0 + h
    fz = z + d / 2
    ex = x + w / 2
    if band:
        box(p, cornice, (w + 0.05, cornice_h, d + 0.05), (x, top - cornice_h / 2 - 0.005, z), bevel=0.01)
    box(p, roof_m, (w - 0.03, 0.02, d - 0.03), (x, top + 0.004, z))
    if parapet:
        parapet_rect(p, cap, x - w / 2 - 0.025, z - d / 2 - 0.025, x + w / 2 + 0.025, z + d / 2 + 0.025, top - 0.01, h=0.05, t=0.035)
    for px_ in pilasters:
        box(p, cap, (0.055, h - plinth - cornice_h + 0.01, 0.035), (px_, y0 + plinth + (h - plinth - cornice_h) / 2, fz + 0.012), bevel=0.008)
    for pz in side_pilasters:
        box(p, cap, (0.035, h - plinth - cornice_h + 0.01, 0.055), (ex + 0.012, y0 + plinth + (h - plinth - cornice_h) / 2, pz), bevel=0.008)
    return top + 0.014


def lathe_in(p, mat, profile, at=(0, 0, 0), seg=16):
    """Surface of revolution whose faces look INWARD (towards the axis): the inside of cooling towers, tanks,
    stacks seen over their rim. profile = [(radius, y), ...] top to bottom or bottom to top."""
    import bmesh
    from kit import shapes as _S

    def build(bm):
        rings = []
        for (rr, y) in profile:
            rings.append([bm.verts.new((math.cos(2 * math.pi * i / seg) * rr, y, -math.sin(2 * math.pi * i / seg) * rr)) for i in range(seg)])
        for k in range(len(rings) - 1):
            A, B = rings[k], rings[k + 1]
            for i in range(seg):
                j = (i + 1) % seg
                f = bm.faces.new((A[i], B[i], B[j], A[j]))
                f.normal_update()
                # make it face the axis
                c = f.calc_center_median()
                radial = mathutils.Vector((c.x, 0.0, c.z))
                if f.normal.dot(radial) > 0:
                    f.normal_flip()
        vs = [v for ring in rings for v in ring]
        _S._round_uv(bm, vs)
        return vs
    return _S._emit(p, mat, build, T(at))
