"""Decals: images (emblems, stencilled text, hazard stripes, rivet rows, vents, panel outlines) projected
onto whatever surfaces lie inside a thin box, baked into the atlas. They cost no triangles.

    m.decal(img, at=(x, y, z), size=(w, h), facing='+z', part=m.root, depth=0.03, ...)

`img` comes from one of the generators here (soviet_star(), allied_eagle(), text(...), hazard(), ...). The
projector box is centred at `at` (part frame), `size` wide/high in the plane, and +-depth along the facing
normal; only faces turned towards the projector receive it (no smearing on side faces). Channels:
    team=None keeps the surface's team mask, 0 clears it (white text on a team plate), 1 paints team colour
    rough / metal override the surface where the decal is opaque; emit makes it glow (lit signs)
    height adds relief from the image's height channel (rivets, slats, panel seams)
"""
import math

import bpy
import numpy as np
from mathutils import Vector

from . import core

FONT_PATH = None  # set by kit.run (repo public/fonts/rajdhani-700.woff2): the default (Latin) decal font
# Cyrillic (and any non-Latin) text: Russo One (SIL OFL, google/fonts, fetched by fetch-textures.mjs)
import os as _os
FONTS = {
    'russo': _os.path.join(_os.environ.get('RH_CACHE', _os.path.expanduser('~/.cache/red-horizon')), 'fonts', 'russoone', 'RussoOne-Regular.ttf'),
}
_img_count = [0]


# ---------------------------------------------------------------------------------------------------------
# Rasteriser (numpy, supersampled)

class Canvas:
    """RGBA float canvas (straight alpha) + a height channel; y up (row 0 = bottom, like Blender images)."""

    def __init__(self, w, h, ss=3):
        self.w, self.h, self.ss = w, h, ss
        self.W, self.H = w * ss, h * ss
        self.rgb = np.zeros((self.H, self.W, 3), np.float32)
        self.a = np.zeros((self.H, self.W), np.float32)
        self.hgt = np.full((self.H, self.W), 0.5, np.float32)

    def cover(self, tris):
        """Coverage mask (H, W) of triangles given in canvas units (0..w, 0..h)."""
        m = np.zeros((self.H, self.W), bool)
        s = self.ss
        for t in tris:
            (x0, y0), (x1, y1), (x2, y2) = [(p[0] * s, p[1] * s) for p in t]
            minx, maxx = int(max(0, math.floor(min(x0, x1, x2)))), int(min(self.W - 1, math.ceil(max(x0, x1, x2))))
            miny, maxy = int(max(0, math.floor(min(y0, y1, y2)))), int(min(self.H - 1, math.ceil(max(y0, y1, y2))))
            if maxx < minx or maxy < miny:
                continue
            yy, xx = np.mgrid[miny:maxy + 1, minx:maxx + 1].astype(np.float32)
            xx += 0.5
            yy += 0.5
            d0 = (x1 - x0) * (yy - y0) - (y1 - y0) * (xx - x0)
            d1 = (x2 - x1) * (yy - y1) - (y2 - y1) * (xx - x1)
            d2 = (x0 - x2) * (yy - y2) - (y0 - y2) * (xx - x2)
            inside = ((d0 >= 0) & (d1 >= 0) & (d2 >= 0)) | ((d0 <= 0) & (d1 <= 0) & (d2 <= 0))
            m[miny:maxy + 1, minx:maxx + 1] |= inside
        return m

    def poly(self, pts, color, alpha=1.0, height=None):
        """Fill a simple polygon (fan-triangulated: convex or star-shaped around its first point)."""
        tris = [(pts[0], pts[i], pts[i + 1]) for i in range(1, len(pts) - 1)]
        self.fill(self.cover(tris), color, alpha, height)

    def polys(self, polys, color, alpha=1.0, height=None):
        m = np.zeros((self.H, self.W), bool)
        for pts in polys:
            m |= self.cover([(pts[0], pts[i], pts[i + 1]) for i in range(1, len(pts) - 1)])
        self.fill(m, color, alpha, height)

    def fill(self, mask, color, alpha=1.0, height=None):
        if color is not None:
            self.rgb[mask] = color
            self.a[mask] = np.maximum(self.a[mask], alpha)
        if height is not None:
            self.hgt[mask] = height

    def circle(self, cx, cy, r, color, alpha=1.0, height=None, r_in=0.0):
        s = self.ss
        yy, xx = np.mgrid[0:self.H, 0:self.W].astype(np.float32)
        d = np.sqrt((xx + 0.5 - cx * s) ** 2 + (yy + 0.5 - cy * s) ** 2)
        self.fill((d <= r * s) & (d >= r_in * s), color, alpha, height)

    def rect(self, x0, y0, x1, y1, color, alpha=1.0, height=None):
        s = self.ss
        m = np.zeros((self.H, self.W), bool)
        m[int(max(0, y0 * s)):int(min(self.H, y1 * s)), int(max(0, x0 * s)):int(min(self.W, x1 * s))] = True
        self.fill(m, color, alpha, height)

    def roughen(self, amount=0.25, scale=6.0, seed=1):
        """Spray-paint edges and wear: erode alpha with noise (stencil look)."""
        rng = np.random.default_rng(seed)
        n = _value_noise(self.H, self.W, scale * self.ss, rng)
        n2 = _value_noise(self.H, self.W, scale * self.ss * 0.25, rng)
        self.a *= np.clip(1.0 - amount * np.clip((n * 0.7 + n2 * 0.6) - 0.45, 0, 1) * 2.2, 0, 1)

    def image(self, name=None):
        """-> Blender image (RGBA straight alpha) and a height image, downsampled from the supersampled canvas."""
        s = self.ss

        def down(a):
            return a.reshape(self.h, s, self.w, s, *a.shape[2:]).mean(axis=(1, 3))
        a = down(self.a)
        rgb = down(self.rgb * self.a[..., None])
        rgb = np.where(a[..., None] > 1e-4, rgb / np.maximum(a[..., None], 1e-4), 0.0)
        hgt = down(self.hgt)
        _img_count[0] += 1
        name = name or f'DECAL_{_img_count[0]}'
        img = bpy.data.images.new(name, self.w, self.h, alpha=True, float_buffer=True)
        img.colorspace_settings.name = 'Non-Color'  # colours here are already linear
        px = np.concatenate([rgb, a[..., None]], -1).astype(np.float32)
        img.pixels.foreach_set(px.ravel())
        img.pack()
        himg = None
        if np.any(np.abs(hgt - 0.5) > 1e-3):
            himg = bpy.data.images.new(name + '_h', self.w, self.h, alpha=True, float_buffer=True)
            himg.colorspace_settings.name = 'Non-Color'
            hp = np.ones((self.h, self.w, 4), np.float32)
            hp[..., 0] = hp[..., 1] = hp[..., 2] = hgt
            himg.pixels.foreach_set(hp.ravel())
            himg.pack()
        return DecalImage(img, himg, self.w / self.h)


def _value_noise(H, W, cell, rng):
    gh, gw = int(H / cell) + 2, int(W / cell) + 2
    g = rng.random((gh, gw)).astype(np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    fy, fx = yy / cell, xx / cell
    y0, x0 = fy.astype(int), fx.astype(int)
    ty, tx = fy - y0, fx - x0
    ty, tx = ty * ty * (3 - 2 * ty), tx * tx * (3 - 2 * tx)
    a = g[y0, x0] * (1 - tx) + g[y0, x0 + 1] * tx
    b = g[y0 + 1, x0] * (1 - tx) + g[y0 + 1, x0 + 1] * tx
    return a * (1 - ty) + b * ty


class DecalImage:
    def __init__(self, img, himg, aspect):
        self.img, self.himg, self.aspect = img, himg, aspect


def lin(c):
    from .materials import srgb
    return np.array(srgb(c), np.float32)


# ---------------------------------------------------------------------------------------------------------
# Emblems

def star_points(cx, cy, r, r_in=0.382, rot=0.0, n=5):
    pts = []
    for i in range(n * 2):
        a = math.pi / 2 + rot + i * math.pi / n
        rr = r if i % 2 == 0 else r * r_in
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    return pts


def _star(cv, cx, cy, r, color, height=None):
    pts = star_points(cx, cy, r)
    # star = 5 triangles from the centre + centre pentagon (fan from the centre covers it all)
    tris = [((cx, cy), pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
    cv.fill(cv.cover(tris), color, 1.0, height)


def soviet_star(px=256, color=0xe8b434, border=0x7a1410, field=None):
    """Gold five-pointed star with a dark red outline (transparent background unless field is given)."""
    cv = Canvas(px, px)
    c = px / 2
    if field is not None:
        cv.rect(0, 0, px, px, lin(field))
    _star(cv, c, c * 0.98, px * 0.47, lin(border))
    _star(cv, c, c * 0.98, px * 0.40, lin(color), height=0.62)
    return cv.image()


def allied_star(px=256, color=0xe8e4da, ring=0x1d3a78, field=None):
    """White star in a blue roundel (vehicles, Allied structures)."""
    cv = Canvas(px, px)
    c = px / 2
    if field is not None:
        cv.rect(0, 0, px, px, lin(field))
    cv.circle(c, c, px * 0.48, lin(ring))
    cv.circle(c, c, px * 0.43, lin(color), r_in=px * 0.40)
    _star(cv, c, c * 0.98, px * 0.36, lin(color), height=0.6)
    return cv.image()


def allied_eagle(px=256, color=0xe8e4da, field=None):
    """Stylised spread-wing eagle (Allied banners)."""
    cv = Canvas(px, px)
    s = px / 100.0
    if field is not None:
        cv.rect(0, 0, px, px, lin(field))
    col = lin(color)

    def P(pts):
        return [(x * s, y * s) for x, y in pts]
    # wings: feathered right wing, mirrored for the left
    right = [(52, 58), (95, 78), (93, 70), (88, 71), (90, 63), (84, 64), (85, 56), (78, 57), (78, 50), (70, 51), (58, 44)]
    left = [(100 - x, y) for x, y in right]
    # fan-triangulate each wing from the root
    cv.polys([P(right), P(left)], col, height=0.6)
    # body, tail and head
    cv.poly(P([(50, 62), (57, 55), (58, 40), (54, 26), (50, 22), (46, 26), (42, 40), (43, 55)]), col, height=0.6)
    cv.poly(P([(50, 26), (58, 14), (54, 12), (50, 16), (46, 12), (42, 14)]), col, height=0.6)
    cv.circle(50 * s, 68 * s, 7.5 * s, col, height=0.6)
    cv.poly(P([(55, 70), (63, 66), (56, 64)]), lin(0xe8b434))  # beak
    # small star above the head
    _star(cv, 50 * s, 86 * s, 8 * s, col, height=0.6)
    return cv.image()


# ---------------------------------------------------------------------------------------------------------
# Text (Rajdhani Bold via Blender's font engine -> triangles -> raster)

_glyphs = {}
STENCIL_GAP = set('ABDOPQR04689')


def font_for(text, font=None):
    """Decal font name: explicit `font` ('rajdhani' | 'russo' | a .ttf / .otf / .woff2 path), else Russo One when
    the text has non-Latin characters (Cyrillic slogans), else Rajdhani Bold."""
    if font:
        return font
    return 'russo' if any(ord(c) > 0x024F for c in text) else 'rajdhani'


def _font(name):
    if name == 'rajdhani':
        if not FONT_PATH:
            return None
        return bpy.data.fonts.get('rh_font') or _load_font()
    path = FONTS.get(name, name)
    key = 'rh_font_' + _os.path.basename(path)
    f = bpy.data.fonts.get(key)
    if f is None:
        if not _os.path.exists(path):
            raise FileNotFoundError(f'{path} missing: run node tools/assets/fetch-textures.mjs')
        f = bpy.data.fonts.load(path)
        f.name = key
    return f


def _glyph(ch, font='rajdhani'):
    k = (font, ch)
    if k in _glyphs:
        return _glyphs[k]
    cu = bpy.data.curves.new('glyph', 'FONT')
    cu.body = ch
    fo = _font(font)
    if fo is not None:
        cu.font = fo
    ob = bpy.data.objects.new('glyph', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    tris = []
    for p in me.polygons:
        vs = [me.vertices[i].co for i in p.vertices]
        for i in range(1, len(vs) - 1):
            tris.append(((vs[0].x, vs[0].y), (vs[i].x, vs[i].y), (vs[i + 1].x, vs[i + 1].y)))
    xs = [v.co.x for v in me.vertices] or [0.0, 0.3]
    ob.evaluated_get(dg).to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    g = (tris, min(xs), max(xs))
    _glyphs[k] = g
    return g


def _load_font():
    f = bpy.data.fonts.load(FONT_PATH)
    f.name = 'rh_font'
    return f


def text(lines, px_h=128, aspect=None, color=0xe8e4da, field=None, stencil=False, spacing=0.08, wear=0.25, seed=3, emboss=False, scales=None, font=None):
    """Stencilled text, one or more lines (list or 'A|B'), centred. Returns a DecalImage whose aspect ratio
    fits the text (or is padded to `aspect` = w / h). field = background colour (a painted sign board).
    scales = per-line size factors (e.g. [1.4, 1.0]: a big headline over a smaller line).
    font = 'rajdhani' (default for Latin) | 'russo' (Russo One, picked automatically for Cyrillic) | a font path."""
    if isinstance(lines, str):
        lines = lines.split('|')
    font = font_for(''.join(lines), font)
    scales = list(scales or [1.0] * len(lines)) + [1.0] * len(lines)
    # measure
    lay = []
    lh = 0.75  # cap height ~ 0.7 em in Rajdhani; line pitch
    widths = []
    for li, ln in enumerate(lines):
        sc = scales[li]
        x = 0.0
        row = []
        for ch in ln:
            if ch == ' ':
                x += 0.28 * sc
                continue
            tris, x0, x1 = _glyph(ch, font)
            row.append((ch, tris, x - x0 * sc, x0 * sc, x1 * sc))
            x += (x1 - x0) * sc + spacing * sc
        widths.append(max(0.0, x - spacing * sc))
        lay.append(row)
    tw = max(widths) if widths else 1.0
    th = sum(lh * scales[i] for i in range(len(lines))) + 0.18 * (len(lines) - 1)
    pad = 0.12
    W = tw + 2 * pad
    H = th + 2 * pad
    if aspect:
        if W / H < aspect:
            W = H * aspect
        else:
            H = W / aspect
    px_w = max(8, int(round(px_h * W / H / 4)) * 4)
    cv = Canvas(px_w, px_h)
    k = px_h / H
    if field is not None:
        cv.rect(0, 0, px_w, px_h, lin(field))
    col = lin(color)
    ytop = H - pad - (H - 2 * pad - th) / 2
    for li, row in enumerate(lay):
        sc = scales[li]
        ox = (W - widths[li]) / 2
        ytop -= lh * sc
        oy = ytop - 0.02 * sc
        ytop -= 0.18
        for ch, tris, dx, x0, x1 in row:
            tt = [tuple(((p[0] * sc + dx + ox) * k, (p[1] * sc + oy) * k) for p in t) for t in tris]
            m = cv.cover(tt)
            if stencil and ch in STENCIL_GAP:
                # stencil bridge: a thin vertical gap through the glyph centre
                gx = ((x0 + x1) / 2 + dx + ox) * k * cv.ss
                gw = max(1.0, 0.03 * k * cv.ss)
                xx = np.arange(cv.W)[None, :]
                m &= ~((np.abs(xx + 0.5 - gx) < gw) & np.ones((cv.H, 1), bool))
            cv.fill(m, col, 1.0, 0.6 if emboss else None)
    if wear:
        cv.roughen(wear, seed=seed)
    return cv.image()


# ---------------------------------------------------------------------------------------------------------
# Patterns: hazard stripes, rivets, vents, grilles, panel outlines

def hazard(px=256, stripes=6, a=0xf2b916, b=0x18181a, aspect=4.0, wear=0.3):
    w, h = int(px * aspect), px
    cv = Canvas(w, h, ss=2)
    cv.rect(0, 0, w, h, lin(b))
    step = w / stripes
    for i in range(-2, stripes + 3):
        x = i * step
        cv.poly([(x, 0), (x + step / 2, 0), (x + step / 2 + h, h), (x + h, h)], lin(a))
    if wear:
        cv.roughen(wear * 0.5, seed=11)
        cv.a = np.maximum(cv.a, 0.0)
    return cv.image()


def rivets(n=12, px=32, r=0.32):
    """A row of n rivet heads (height decal; colour untouched)."""
    cv = Canvas(px * n, px, ss=2)
    for i in range(n):
        cv.circle(px * (i + 0.5), px / 2, px * r, None, height=0.85)
    return cv.image()


def vent(slats=8, px=128, aspect=1.6, frame=0x3a3d42, slot=0x0c0c0d):
    """Louvred vent: dark slots between slanted slats, a frame."""
    w, h = int(px * aspect), px
    cv = Canvas(w, h, ss=2)
    cv.rect(0, 0, w, h, lin(frame), height=0.62)
    m = h * 0.1
    sh = (h - 2 * m) / slats
    for i in range(slats):
        y = m + i * sh
        cv.rect(m, y, w - m, y + sh * 0.45, lin(slot), height=0.3)
        cv.rect(m, y + sh * 0.45, w - m, y + sh, lin(frame) * 1.15, height=0.55)
    return cv.image()


def grille(px=128, aspect=1.0, n=10, frame=0x3a3d42, hole=0x0b0b0c):
    w, h = int(px * aspect), px
    cv = Canvas(w, h, ss=2)
    cv.rect(0, 0, w, h, lin(frame), height=0.62)
    m = h * 0.08
    cell = (h - 2 * m) / n
    nx = max(1, int((w - 2 * m) / cell))
    for i in range(nx):
        for j in range(n):
            x, y = m + i * cell, m + j * cell
            cv.rect(x + cell * 0.18, y + cell * 0.18, x + cell * 0.82, y + cell * 0.82, lin(hole), height=0.3)
    return cv.image()


def panel_outline(px=128, aspect=1.0, rivet=True, line=0x101012, inset=0.06):
    """A panel seam rectangle (dark recessed line) with corner rivets; colour only on the line."""
    w, h = int(px * aspect), px
    cv = Canvas(w, h, ss=2)
    t = max(1.5, px * 0.025)
    i = px * inset
    for (x0, y0, x1, y1) in [(i, i, w - i, i + t), (i, h - i - t, w - i, h - i), (i, i, i + t, h - i), (w - i - t, i, w - i, h - i)]:
        cv.rect(x0, y0, x1, y1, lin(line), 0.6, height=0.2)
    if rivet:
        for (x, y) in [(i * 2.2, i * 2.2), (w - i * 2.2, i * 2.2), (i * 2.2, h - i * 2.2), (w - i * 2.2, h - i * 2.2)]:
            cv.circle(x, y, px * 0.03, None, height=0.85)
    return cv.image()


def solid(color, px=8):
    """A plain colour patch (trims, stripes)."""
    cv = Canvas(px, px, ss=1)
    cv.rect(0, 0, px, px, lin(color))
    return cv.image()


def number(s, px_h=64, color=0xe8e4da, font=None):
    return text([s], px_h=px_h, color=color, stencil=False, wear=0.2, font=font)


TEAM_NEUTRAL = 0xdbdbdb  # sRGB of TEAM_GREY (linear 0.7): with team=1 this is exactly the clean team paint


def team_paint(k=1.0, px=8):
    """Solid grey that, projected with team=1, paints the team colour scaled by k (1 = the clean team paint,
    0.6 = a dark shade for recesses and stripes, 1.3 = a light shade; the game multiplies the albedo by
    teamColour / TEAM_GREY). m.decal(team_paint(0.6), ..., team=1)."""
    from .materials import TEAM_GREY
    v = max(0.0, min(1.0, TEAM_GREY * k))
    s = v * 12.92 if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
    c = int(round(s * 255))
    return solid((c << 16) | (c << 8) | c, px)


def mullions(nx=6, ny=2, aspect=4.0, px=128, frame=0x1c1e21, t=0.09, dark=0.0, seed=1, pane=0x1b232c, dark_panes=None):
    """Window-frame grid for glazing: opaque bars, transparent panes, some panes painted as dark (unlit)
    glass. dark = fraction of panes dark (random by seed) or dark_panes = explicit pane indices (row-major
    from the bottom left). Project it with emit=0.0 over lit glass (kit.shapes.glazing does): the bars and
    the dark panes stop glowing, the other panes stay lit."""
    import random as _r
    key = ('mull', nx, ny, round(aspect, 2), px, frame, round(t, 3), round(dark, 2), seed, pane,
           tuple(sorted(dark_panes)) if dark_panes is not None else None)
    if key in _mull:
        return _mull[key]
    rnd = _r.Random(seed)
    w, h = max(8, int(px * aspect)), px
    cv = Canvas(w, h, ss=2)
    col = lin(frame)
    bw = h * t
    cw, ch = (w - bw) / nx, (h - bw) / ny
    for i in range(nx):  # (the same random panes as the original SOVB helper for the same seed)
        for j in range(ny):
            off = (j * nx + i) in dark_panes if dark_panes is not None else (dark > 0 and rnd.random() < dark)
            if off:
                cv.rect(i * cw, j * ch, (i + 1) * cw + bw, (j + 1) * ch + bw, lin(pane), height=0.45)
    for i in range(nx + 1):
        x = i * cw
        cv.rect(x, 0, x + bw, h, col, height=0.7)
    for j in range(ny + 1):
        y = j * ch
        cv.rect(0, y, w, y + bw, col, height=0.7)
    img = cv.image()
    _mull[key] = img
    return img


_mull = {}


# ---------------------------------------------------------------------------------------------------------
# Projector

class Decal:
    """A box projector (m.decal(img, ...)): `img` is projected along the decal's -Z onto every face within
    `depth` of its plane that faces it.

    at, size     centre (part frame) and (w, h) in units (a number: the width, height from the image aspect)
    facing       '+z' / '-z' / '+x' / '-x' / '+y' / '-y', a yaw angle, or an (rx, ry, rz) Euler
    normal, up   alternative to facing: the surface normal the decal looks along (any direction: sloped
                 roofs, raked armour), with its top towards `up` (default +Y; see core.normal_rot)
    rot          alternative to facing: an explicit (rx, ry, rz) Euler (three XYZ, radians)
    roll         extra rotation (radians) in the decal plane
    team, rough, metal, emit   channel overrides under the decal (emit=0.0 also switches a lit surface off)
    color=False  only the height / channel overrides (rivets, seams); tint multiplies the image colour
    """

    def __init__(self, model, img, at, size, facing='+z', part=None, depth=0.03, roll=0.0, opacity=1.0,
                 team=None, rough=None, metal=None, emit=None, height=1.0, color=True, tint=None, boost=None,
                 normal=None, up=None, rot=None):
        part = part or model.root
        if isinstance(part, str):
            part = model.parts[part]
        self.img = img
        w, h = (size, size / img.aspect) if isinstance(size, (int, float)) else size
        if h is None:
            h = w / img.aspect
        self.w, self.h, self.depth = w, h, depth
        if rot is not None:
            rot = core.facing_rot(rot)
        elif normal is not None:
            rot = core.normal_rot(normal, up)
        else:
            rot = core.facing_rot(facing)
        M = part.world() @ core.T(at, rot) @ core.T((0, 0, 0), (0, 0, roll))
        e = bpy.data.objects.new(f'DECALP_{len(model.decals)}', None)
        e.empty_display_type = 'CUBE'
        e.matrix_world = core.TO_BLENDER @ M
        bpy.context.scene.collection.objects.link(e)
        self.empty = e
        self.nrm = ((core.TO_BLENDER @ M).to_3x3() @ Vector((0, 0, 1))).normalized()
        self.opacity, self.team, self.rough, self.metal, self.emit = opacity, team, rough, metal, emit
        self.height_k = height
        self.color = color
        self.tint = tint
        self.M = M  # model space (game frame)
        self.boost = boost if boost is not None else (color and img.himg is None or img.aspect > 1.8)
        self.mats = None  # names of the materials with faces inside the box (assign_targets)

    def apply(self, g, ch, N):
        tc = g.node('ShaderNodeTexCoord')
        tc.object = self.empty
        x, y, z = g.xyz(tc.outputs['Object'])
        u = g.add(g.mul(x, 1.0 / self.w), 0.5)
        v = g.add(g.mul(y, 1.0 / self.h), 0.5)
        uvw = g.comb(u, v, 0.0)
        col, alpha = g.image(self.img.img, uvw, proj='FLAT', ext='CLIP')
        inside = g.math('LESS_THAN', g.math('ABSOLUTE', z), self.depth)
        facing = g.smooth(g.dot(N, tuple(self.nrm)), 0.25, 0.55)
        a = g.mul(g.mul(g.mul(alpha, inside), facing), self.opacity)
        if self.color:
            c = col if self.tint is None else g.mulc(col, g.rgb(self.tint))
            ch['base'] = g.mixc(ch['base'], c, a)
        if self.team is not None:
            ch['team'] = g.mixf(ch['team'], float(self.team), a)
        if self.rough is not None:
            ch['rough'] = g.mixf(ch['rough'], self.rough, a)
        if self.metal is not None:
            ch['metal'] = g.mixf(ch['metal'], self.metal, a)
        if self.emit is not None:
            ch['emit'] = g.mixf(ch['emit'], self.emit, a)
        if self.img.himg is not None and self.height_k:
            hc, ha = g.image(self.img.himg, uvw, proj='FLAT', ext='CLIP')
            hh = g.sep(hc)[0]
            inside2 = g.mul(g.mul(inside, facing), ha)
            ch['height'] = g.add(ch['height'], g.mul(g.mul(g.sub(hh, 0.5), inside2), 2.0 * self.height_k))


def assign_targets(model):
    """Find, per decal, the materials that have faces inside its projector box (decals are only wired into
    those materials: much faster node building and baking)."""
    import numpy as np
    # every face as its vertices in model space (an overlap test: an off-centre emblem on a big sign board's
    # front quad lies inside the box although the quad's centre does not)
    verts = []  # (n, 3) arrays
    names = []
    refs = []  # (object, face index)
    for p in model.parts.values():
        o = p.obj
        if o is None:
            continue
        W = p.world()
        me = o.data
        co = np.empty(len(me.vertices) * 3, np.float64)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        Wm = np.array(W)
        co = co @ Wm[:3, :3].T + Wm[:3, 3]
        for f in me.polygons:
            verts.append(co[list(f.vertices)])
            names.append(me.materials[f.material_index].name if f.material_index < len(me.materials) else '')
            refs.append((o, f.index))
    if not verts:
        return
    for di, d in enumerate(model.decals):
        Mi = np.array(d.M.inverted())
        R, t = Mi[:3, :3], Mi[:3, 3]
        hx, hy, hz = d.w / 2 + 0.01, d.h / 2 + 0.01, d.depth + 0.005
        idx = []
        for i, V in enumerate(verts):
            L = V @ R.T + t
            lo, hi = L.min(0), L.max(0)
            # face bounding box overlaps the projector box
            if lo[0] < hx and hi[0] > -hx and lo[1] < hy and hi[1] > -hy and lo[2] < hz and hi[2] > -hz:
                idx.append(i)
        d.mats = {names[i] for i in idx}
        d.faces = [refs[i] for i in idx]
        if not idx:
            print(f'[kit] WARNING: decal #{di} ({d.img.img.name}, {d.w:.3f} x {d.h:.3f}, depth {d.depth}) at '
                  f'{tuple(round(x, 3) for x in d.M.translation)} touches no faces: check its position / facing / depth', flush=True)


def boost_faces(model):
    """{object: set(face indices)} of faces under colour decals (text, emblems): they get more atlas texels."""
    out = {}
    for d in model.decals:
        if not d.boost:
            continue
        for (o, i) in getattr(d, 'faces', []):
            out.setdefault(o, set()).add(i)
    return out
