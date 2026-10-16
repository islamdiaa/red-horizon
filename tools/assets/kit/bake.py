"""Unwrap + bake (Cycles, CPU) into per-model atlases.

Phase 1  masks the smart materials read back through the atlas UVs:
         'ao'   ambient occlusion with a ground plane (contact shadows, crevices)
         'edge' curvature from the bevel shader (1 - dot(bevelled normal, normal)): edges and corners
Phase 2  channels: base colour, (roughness, metalness, team), (emit, emit mode), tangent-space normal
         (shader bevel + bump from panel seams / rivets / decal relief / texture relief).
Post     numpy: sRGB encode, ORM = (AO, roughness, metalness), mask = (team, emit / 4, mode / 4) at half
         resolution, written as WebP by kit.export.
"""
import math
import time

import bpy
import numpy as np

from . import materials as Mt

SAMPLES = {'ao': 48, 'edge': 20, 'emit': 4, 'normal': 20}
AO_DISTANCE = 0.32
EDGE_RADIUS = 0.014
CHAMFER_EDGE = 0.45  # edge-mask value of geometric chamfer faces (0.8 wore every chamfer bare: silhouette halos)
MARGIN_PX = 2.0  # island gutter in atlas pixels (bake._fill grows every island into it; HD is only drawn close up)
PACK_SHAPE = 'AABB'  # 'CONCAVE' packs tighter but takes minutes on big models; 'AABB' is instant


def _select(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def cull_hidden(objs, others=(), ground=0.03, eps=0.008):
    """Delete faces that can never be seen (they waste triangles and atlas texels): downward faces at ground
    level, faces lying flush against other geometry (a box standing on a slab) and faces buried inside
    solids. A face goes when every sample point on it is blocked (ray along its normal hits something within
    `eps`, or hits the inside of a solid). `others` occlude but are not culled. Returns the number culled."""
    import bmesh
    from mathutils.bvhtree import BVHTree
    occ = [o for o in list(objs) + list(others) if o is not None]
    if not objs:
        return 0
    allbm = bmesh.new()
    for o in occ:
        tmp = o.data.copy()
        tmp.transform(o.matrix_world)
        allbm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    tree = BVHTree.FromBMesh(allbm)
    total = 0
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        mw = o.matrix_world
        m3 = mw.to_3x3()
        dead = []
        for f in bm.faces:
            n = (m3 @ f.normal).normalized()
            c = mw @ f.calc_center_median()
            if ground is not None and n.z < -0.95 and c.z < ground:
                dead.append(f)
                continue
            pts = [c] + [c.lerp(mw @ v.co, 0.8) for v in f.verts]
            hidden = True
            for p in pts:
                hit = tree.ray_cast(p + n * 1e-4, n, 10.0)
                if hit[0] is None:
                    hidden = False
                    break
                if not (hit[3] < eps or hit[1].dot(n) > 0.2):
                    hidden = False
                    break
            if hidden:
                dead.append(f)
        if dead:
            total += len(dead)
            bmesh.ops.delete(bm, geom=dead, context='FACES')
            bm.to_mesh(o.data)
        bm.free()
    allbm.free()
    return total


def cull_model(model):
    """Hidden-face culling per part, at the rest pose. Parts move, so a part is only culled against its own
    geometry (and its non-atlas extras): the static root against the root, a turret against the turret, a
    silo missile that starts buried is never culled by the silo it rises out of. Parts made with
    m.part(..., cull=False) (and their children) are not culled at all. Ground contacts are culled on the root."""
    total = 0
    skip = set()
    for p in model.parts.values():
        q = p
        while q is not None:
            if not getattr(q, 'cull', True):
                skip.add(p.name)
                break
            q = q.parent
    for p in model.parts.values():
        if p.obj is None or p.name in skip:
            continue
        total += cull_hidden([p.obj], list(p.extra_objs.values()), ground=0.03 if p.parent is None else None)
    return total


def unwrap(objs, size, margin_px=None, angle=62.0, boost=None, boost_k=1.8):
    """Smart-project every atlas object into ONE shared UV layer 'atlas' and pack the islands together.
    boost = {object: face indices} whose islands get boost_k x the texel density (decals: text, emblems)."""
    for o in objs:
        me = o.data
        uv = me.uv_layers.get(Mt.ATLAS_UV) or me.uv_layers.new(name=Mt.ATLAS_UV)
        me.uv_layers.active = uv
    _select(objs)
    margin = (margin_px if margin_px is not None else MARGIN_PX) / size
    # round primitives come with their own UVs (kit.shapes._round_uv): smart-project only the rest
    for o in objs:
        me = o.data
        pre = me.attributes.get('rh_preuv')
        sel = [True] * len(me.polygons)
        if pre is not None:
            vals = [0.0] * len(me.polygons)
            pre.data.foreach_get('value', vals)
            sel = [v < 0.5 for v in vals]
        me.polygons.foreach_set('select', sel)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in objs:
        _scale_islands(o, (boost or {}).get(o, ()), boost_k, under_k=UNDER_K)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method='FRACTION', margin=margin, shape_method=PACK_SHAPE)
    bpy.ops.object.mode_set(mode='OBJECT')
    return coverage(objs)


def coverage(objs):
    """Share of the atlas covered by UV islands (packing efficiency; 0.5+ is good for hard-surface models)."""
    tot = 0.0
    for o in objs:
        me = o.data
        uv = me.uv_layers[Mt.ATLAS_UV].data
        for p in me.polygons:
            pts = [uv[i].uv for i in p.loop_indices]
            a = 0.0
            for i in range(len(pts)):
                x0, y0 = pts[i]
                x1, y1 = pts[(i + 1) % len(pts)]
                a += x0 * y1 - x1 * y0
            tot += abs(a) / 2
    return tot


UNDER_K = 0.4  # texel density of islands facing down (undersides: rarely seen from the RTS camera)


def _scale_islands(o, faces, k, under_k=1.0):
    """Scale the UV islands containing `faces` by k around their centres (before packing); islands that face
    down (area-weighted normal, game frame) by under_k."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv[Mt.ATLAS_UV]
    parent = list(range(len(bm.faces)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) != 2:
            continue
        f1, f2 = lf
        same = True
        for v in e.verts:
            u1 = next(l[uvl].uv for l in f1.loops if l.vert is v)
            u2 = next(l[uvl].uv for l in f2.loops if l.vert is v)
            if (u1 - u2).length > 1e-5:
                same = False
                break
        if same:
            parent[find(f1.index)] = find(f2.index)
    want = {find(i) for i in faces if i < len(bm.faces)}
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f.index), []).append(f)
    for r, fs in groups.items():
        if r in want:
            kk = k
        else:
            area = sum(f.calc_area() for f in fs) or 1.0
            ny = sum(f.normal.y * f.calc_area() for f in fs) / area  # mesh data is in the game frame (y up)
            if ny > -0.45 or under_k == 1.0:
                continue
            kk = under_k
        ls = [l for f in fs for l in f.loops]
        cx = sum(l[uvl].uv.x for l in ls) / len(ls)
        cy = sum(l[uvl].uv.y for l in ls) / len(ls)
        for l in ls:
            l[uvl].uv.x = cx + (l[uvl].uv.x - cx) * kk
            l[uvl].uv.y = cy + (l[uvl].uv.y - cy) * kk
    bm.to_mesh(o.data)
    bm.free()


def prepare_masks(size):
    for name in ('ao', 'edge'):
        img = bpy.data.images.get(f'RHMASK_{name}')
        if img is None:
            img = bpy.data.images.new(f'RHMASK_{name}', size, size, float_buffer=True)
        elif img.size[0] != size:
            img.scale(size, size)
        img.colorspace_settings.name = 'Non-Color'


def setup_scene(threads=6):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.use_denoising = False
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = threads
    sc.render.bake.margin_type = 'EXTEND'
    sc.render.bake.use_clear = True
    if sc.world is None:
        sc.world = bpy.data.worlds.new('rh_world')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (1, 1, 1, 1)
        bg.inputs['Strength'].default_value = 1.0
    sc.world.light_settings.distance = AO_DISTANCE


def ground_plane(z=-0.0008, size=12.0):
    me = bpy.data.meshes.new('rh_ground')
    s = size
    me.from_pydata([(-s, -s, z), (s, -s, z), (s, s, z), (-s, s, z)], [], [(0, 1, 2, 3)])
    mat = bpy.data.materials.new('rh_ground')
    mat.use_nodes = True
    me.materials.append(mat)
    o = bpy.data.objects.new('rh_ground', me)
    bpy.context.scene.collection.objects.link(o)
    return o


def _target(img):
    """Make `img` the active bake target of every atlas material."""
    for m in Mt.all_atlas_materials():
        nt = m.node_tree
        tn = nt.nodes.get('RH_TARGET')
        if tn is None:
            tn = nt.nodes.new('ShaderNodeTexImage')
            tn.name = 'RH_TARGET'
            tn.location = (-600, 600)
        tn.image = img
        for n in nt.nodes:
            n.select = False
        tn.select = True
        nt.nodes.active = tn


def _route(kind):
    """Wire the material output for a pass: 'bsdf' (normal bake), 'emit:<chan>' or 'emit:pack:<a>,<b>,<c>', 'edge'."""
    for m in Mt.all_atlas_materials():
        g = Mt._graphs.get(m.name)
        nt = m.node_tree
        out = g.output
        em = nt.nodes.get('RH_EMIT')
        if em is None:
            em = nt.nodes.new('ShaderNodeEmission')
            em.name = 'RH_EMIT'
            em.inputs['Strength'].default_value = 1.0
        for l in list(em.inputs['Color'].links):
            nt.links.remove(l)
        if kind == 'bsdf':
            nt.links.new(g.bsdf.outputs[0], out.inputs['Surface'])
            continue
        nt.links.new(em.outputs[0], out.inputs['Surface'])
        if kind == 'one':  # constant white: atlas coverage masks
            em.inputs['Color'].default_value = (1.0, 1.0, 1.0, 1.0)
            continue
        if kind == 'edge':
            e = nt.nodes.get('RH_EDGE')
            if e is None:
                bev = nt.nodes.new('ShaderNodeBevel')
                bev.samples = 16
                bev.inputs['Radius'].default_value = EDGE_RADIUS
                geo = nt.nodes.new('ShaderNodeNewGeometry')
                dot = nt.nodes.new('ShaderNodeVectorMath')
                dot.operation = 'DOT_PRODUCT'
                nt.links.new(bev.outputs[0], dot.inputs[0])
                nt.links.new(geo.outputs['Normal'], dot.inputs[1])
                e = nt.nodes.new('ShaderNodeMath')
                e.name = 'RH_EDGE'
                e.operation = 'SUBTRACT'
                e.use_clamp = True
                e.inputs[0].default_value = 1.0
                nt.links.new(dot.outputs[1], e.inputs[1])
                k0 = nt.nodes.new('ShaderNodeMath')
                k0.operation = 'MULTIPLY'
                k0.inputs[1].default_value = 4.0
                nt.links.new(e.outputs[0], k0.inputs[0])
                # geometric chamfers (kit.shapes marks them): the bevel shader alone misses their middle
                at = nt.nodes.new('ShaderNodeAttribute')
                at.attribute_type = 'GEOMETRY'
                at.attribute_name = 'rh_edge'
                k1 = nt.nodes.new('ShaderNodeMath')
                k1.operation = 'MULTIPLY'
                k1.inputs[1].default_value = CHAMFER_EDGE
                nt.links.new(at.outputs['Fac'], k1.inputs[0])
                k = nt.nodes.new('ShaderNodeMath')
                k.name = 'RH_EDGE_K'
                k.operation = 'MAXIMUM'
                k.use_clamp = True
                nt.links.new(k0.outputs[0], k.inputs[0])
                nt.links.new(k1.outputs[0], k.inputs[1])
            nt.links.new(nt.nodes['RH_EDGE_K'].outputs[0], em.inputs['Color'])
            continue
        chans = kind.split(':', 1)[1]
        if chans.startswith('pack:'):
            names = chans[5:].split(',')
            cc = nt.nodes.get('RH_PACK_' + chans)
            if cc is None:
                cc = nt.nodes.new('ShaderNodeCombineColor')
                cc.name = 'RH_PACK_' + chans
                for i, nme in enumerate(names):
                    if nme != '0':
                        nt.links.new(nt.nodes['RH_' + nme].outputs[0], cc.inputs[i])
                    else:
                        cc.inputs[i].default_value = 0.0
            nt.links.new(cc.outputs[0], em.inputs['Color'])
        else:
            nt.links.new(nt.nodes['RH_' + chans].outputs[0], em.inputs['Color'])


_COVER = {}  # atlas size -> bool (H, W): texels inside any UV island (set by cover())
_GUTTER = {}  # (atlas size, margin px) -> (gutter texel indices, index of the island texel each one copies)


def cover(objs, size):
    """Atlas coverage of all baked objects (a one-sample constant emission bake, no margin): the gutter fill
    of every later bake grows the islands into exactly the uncovered texels."""
    t = _new_img('RHTMP_cover', size)
    _route('one')
    sc = bpy.context.scene
    sc.cycles.samples = 1
    sc.render.bake.margin = 0
    _target(t)
    _select(objs)
    bpy.ops.object.bake(type='EMIT', margin=0, use_clear=True)
    _COVER[size] = px(t)[..., 0] > 0.5
    bpy.data.images.remove(t)
    for k in [k for k in _GUTTER if k[0] == size]:
        del _GUTTER[k]
    return _COVER[size]


def _gutter(size, r):
    """For every uncovered texel within r px of an island: the island texel it copies (grown one px per step,
    like Blender's EXTEND margin). Computed once per atlas, reused by every bake."""
    key = (size, r)
    if key not in _GUTTER:
        cov = _COVER[size]
        H, W = cov.shape
        src = np.where(cov, np.arange(H * W, dtype=np.int64).reshape(H, W), -1)
        filled = cov.copy()
        for _ in range(r):
            grow_all = np.zeros_like(filled)
            for ax, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
                f = np.roll(filled, sh, ax)
                g = f & ~filled & ~grow_all
                src[g] = np.roll(src, sh, ax)[g]
                grow_all |= g
            if not grow_all.any():
                break
            filled |= grow_all
        dst = np.flatnonzero(filled & ~cov)
        _GUTTER[key] = (dst, src.ravel()[dst])
    return _GUTTER[key]


def _fill(a, size, r):
    """Gutter margin like Blender's EXTEND: copy the nearest island texel into the gutter texels within r px.
    (Blender's own bake margin is applied per object: with several atlas objects (moving parts) a later
    object's margin overwrote the border texels of an earlier object's islands packed closer than the margin,
    e.g. a missile island's values along a ring's UV seam.)"""
    dst, src = _gutter(size, r)
    flat = a.reshape(-1, a.shape[-1])
    flat[dst] = flat[src]
    return a


def _bake(objs, img, bake_type, samples, margin, fill=True):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    # no Blender margin (it is per object, see _fill): bake the islands only, then fill the gutters here
    sc.render.bake.margin = 0
    _target(img)
    _select(objs)
    kw = {}
    if bake_type == 'NORMAL':
        kw = dict(normal_space='TANGENT')
    bpy.ops.object.bake(type=bake_type, margin=0, use_clear=True, **kw)
    if fill and margin > 0 and img.size[0] in _COVER:
        set_px(img, _fill(px(img), img.size[0], margin))


def _new_img(name, size):
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, float_buffer=True, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    return img


def px(img):
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def set_px(img, arr):
    img.pixels.foreach_set(np.ascontiguousarray(arr, np.float32).ravel())


def _blur(a, r):
    out = a.copy()
    for _ in range(r):
        out = (out + np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 5.0
    return out


def _ao_without_ground(objs, ungrounded, ao, size, margin, log):
    """Re-bake the AO of the parts made with m.part(..., ground=False) with the ground plane hidden (the
    other parts still occlude them) and merge their islands (plus their gutter margins) into `ao`."""
    gp = bpy.data.objects.get('rh_ground')
    if gp is None or not ungrounded:
        return
    t = time.time()
    gp.hide_render = True
    try:
        ao2 = _new_img('RHTMP_ao2', size)
        _bake(ungrounded, ao2, 'AO', SAMPLES['ao'], margin, fill=False)
        # the atlas coverage of those parts (a one-sample constant emission bake)
        _route('one')
        cov = _new_img('RHTMP_cov', size)
        _bake(ungrounded, cov, 'EMIT', 1, 0, fill=False)
        take = px(cov)[..., 0] > 0.5
        _route('edge')
    finally:
        gp.hide_render = False
    a, b = px(ao), px(ao2)
    a[take] = b[take]
    set_px(ao, a)
    for n in ('RHTMP_ao2', 'RHTMP_cov'):
        bpy.data.images.remove(bpy.data.images[n])
    log(f'  bake ao without ground ({len(ungrounded)} parts, {take.mean() * 100:.1f}% of the atlas) {time.time() - t:.1f}s')


def phase1(objs, size, log=print, ungrounded=()):
    """ungrounded: atlas objects of parts whose AO is baked without the ground plane (m.part(..., ground=False))."""
    margin = max(4, size // 96)
    t = time.time()
    cover(objs, size)
    ao = bpy.data.images[f'RHMASK_ao']
    _route('edge')  # (the materials read the masks: keep them out of the shader while baking into them)
    _bake(objs, ao, 'AO', SAMPLES['ao'], margin, fill=not ungrounded)
    if ungrounded:
        log(f'  bake ao {time.time() - t:.1f}s')
        _ao_without_ground(objs, list(ungrounded), ao, size, margin, log)
        set_px(ao, _fill(px(ao), size, margin))
        t = time.time()
    a = px(ao)
    # soften the noise a little (and keep the occlusion of thin crevices)
    v = a[..., 0]
    v = np.minimum(v, _blur(v, 1) + 0.03)
    a[..., 0] = a[..., 1] = a[..., 2] = v
    set_px(ao, a)
    log(f'  bake ao {time.time() - t:.1f}s')
    t = time.time()
    edge = bpy.data.images['RHMASK_edge']
    _route('edge')
    _bake(objs, edge, 'EMIT', SAMPLES['edge'], margin)
    e = px(edge)
    ev = _blur(e[..., 0], 1)
    e[..., 0] = e[..., 1] = e[..., 2] = np.clip(ev, 0, 1)
    set_px(edge, e)
    log(f'  bake edge {time.time() - t:.1f}s')


def phase2(objs, size, log=print):
    margin = max(4, size // 96)
    out = {}
    for name, route, btype, spp in (
        ('base', 'emit:base', 'EMIT', SAMPLES['emit']),
        ('rmt', 'emit:pack:rough,metal,team', 'EMIT', SAMPLES['emit']),
        ('emit', 'emit:pack:emit,emode,0', 'EMIT', SAMPLES['emit']),
        ('normal', 'bsdf', 'NORMAL', SAMPLES['normal']),
    ):
        t = time.time()
        img = _new_img('RHB_' + name, size)
        _route(route)
        _bake(objs, img, btype, spp, margin)
        out[name] = px(img).copy()
        log(f'  bake {name} {time.time() - t:.1f}s')
    out['ao'] = px(bpy.data.images['RHMASK_ao']).copy()
    _route('bsdf')
    return out


def to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def compose(ch, size, mask_scale=2):
    """-> dict of float RGBA arrays (row 0 = bottom) ready for 8-bit WebP: base, orm, normal, mask."""
    base = ch['base'].copy()
    base[..., :3] = to_srgb(base[..., :3])
    base[..., 3] = 1
    orm = np.ones_like(base)
    ao = ch['ao'][..., 0]
    orm[..., 0] = np.clip(ao * 0.85 + 0.15, 0, 1)
    orm[..., 1] = np.clip(ch['rmt'][..., 0], 0.04, 1)
    orm[..., 2] = np.clip(ch['rmt'][..., 1], 0, 1)
    nrm = ch['normal'].copy()
    nrm[..., 3] = 1
    # ORM at half resolution (the game's High tier decodes it at half the atlas anyway): smaller downloads
    h, w = orm.shape[:2]
    orm = orm.reshape(h // 2, 2, w // 2, 2, 4).mean(axis=(1, 3))
    m = np.ones_like(base)
    m[..., 0] = np.clip(ch['rmt'][..., 2], 0, 1)
    m[..., 1] = np.clip(ch['emit'][..., 0] / 4.0, 0, 1)
    m[..., 2] = np.clip(np.round(ch['emit'][..., 1]) / 4.0, 0, 1)
    if mask_scale > 1:
        h, w = m.shape[:2]
        k = mask_scale
        mm = m.reshape(h // k, k, w // k, k, 4)
        m = mm.mean(axis=(1, 3))
        # keep thin emissive details (lamp lenses) visible after the downsample, and the mode exact
        m[..., 1] = np.maximum(m[..., 1], mm[..., 1].max(axis=(1, 3)) * 0.85)
        m[..., 2] = mm[..., 2].max(axis=(1, 3))
    return {'base': base, 'orm': orm, 'normal': nrm, 'mask': m}
