"""Tileable procedural patterns (numpy) used by the smart materials: panel seams + rivets, concrete block
joints. Each returns a packed Blender image: R = height (0.5 = flat), G = seam mask, B = rivet / feature mask.
"""
import bpy
import numpy as np


def _to_image(name, rgb):
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, w, h, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = rgb
    img.pixels.foreach_set(px.ravel())
    img.pack()
    return img


def _blur(a, r=1):
    out = a.copy()
    for _ in range(r):
        out = (out + np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 5.0
    return out


def panels(name, rivets=1, S=512, seam=0.035, seed=7):
    """2 x 3 panels per tile (staggered vertical seams): recessed seams `seam` (fraction of a panel) wide,
    rivet rows inside the horizontal seams, and a per-panel random tone in B (0..1)."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    pw = S / 2.0
    ph = S / 3.0
    sw = max(2.0, seam * pw)
    seamd = np.full((S, S), 1e9, np.float32)
    tone = np.zeros((S, S), np.float32)
    riv = np.zeros((S, S), np.float32)
    rows = [(0, S // 3, [0, S // 2]), (S // 3, 2 * S // 3, [S // 4, 3 * S // 4]), (2 * S // 3, S, [0, S // 2])]
    rr = max(1.2, sw * 0.42)
    for ri, (y0, y1, xs) in enumerate(rows):
        inrow = (y >= y0) & (y < y1)
        d = np.minimum(np.abs(y - y0), np.abs(y - y1))
        for sx in xs:
            dx = np.abs(((x - sx + S / 2) % S) - S / 2)
            d = np.minimum(d, dx)
        seamd = np.where(inrow, d, seamd)
        # per-panel tone: which panel of the row
        cell = np.floor(((x - xs[0]) % S) / pw).astype(int)
        vals = rng.random(4).astype(np.float32)
        tone = np.where(inrow, vals[cell % 4], tone)
        if rivets:
            sp = sw * 3.2
            for ry in (y0 + sw * 1.4, y1 - sw * 1.4):
                ddx = ((x + sp / 2) % sp) - sp / 2
                dd = np.sqrt(ddx ** 2 + (y - ry) ** 2)
                riv = np.maximum(riv, np.clip(1.0 - dd / rr, 0, 1) * inrow)
    seamm = np.clip(1.0 - (seamd - sw * 0.5) / 1.2, 0, 1)
    # bevelled seam profile: a groove with soft shoulders
    groove = np.clip(1.0 - seamd / (sw * 1.2), 0, 1)
    height = 0.5 - 0.45 * groove ** 0.7 + 0.4 * np.sqrt(riv)
    rgb = np.stack([np.clip(height, 0, 1), seamm, tone], -1)
    return _to_image(name, rgb)


def blocks(name, S=512):
    """Concrete formwork / blocks: 2 x 4 per tile, running bond, shallow joints and tie holes."""
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    bh = S / 4.0
    row = np.floor(y / bh)
    off = (row % 2) * (S / 4.0)
    dx = np.abs((((x + off) % (S / 2.0)) + S / 4.0) % (S / 2.0) - S / 4.0)
    dy = np.abs(((y + bh / 2) % bh) - bh / 2)
    d = np.minimum(dx, dy)
    joint = np.clip(2.2 - d, 0, 1)
    # tie holes (formwork): small dimples in a grid inside each block
    tx = ((x + off + S / 8.0) % (S / 4.0)) - S / 8.0
    ty = ((y + bh / 2) % bh) - bh / 2
    hole = np.clip(1.0 - np.sqrt(tx ** 2 + ty ** 2) / (S / 110.0), 0, 1)
    joint = _blur(joint, 1)
    height = 0.5 - 0.45 * joint - 0.3 * hole
    rgb = np.stack([np.clip(height, 0, 1), joint, hole], -1)
    return _to_image(name, rgb)


def make(kind, name, **kw):
    return {'panels': panels, 'blocks': blocks}[kind](name, **kw)
