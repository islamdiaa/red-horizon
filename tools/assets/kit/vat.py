"""Vertex animation textures (VAT) for skinned crowds, and the skinned-model GLB writer.

The game draws infantry instanced: one draw call per (type, faction) with the clip, time, speed and team colour per
instance. The animation lives in a texture shared by every model of a rig:

    texel (3 * bone + row, frame) = row `row` (0..2) of the bone's skinning matrix S = W @ inverse(rest) (game frame)

RGBA16F (half floats), one texture row per sampled frame, clips stacked vertically. A looping clip stores its first
frame again at its end, so the shader's linear filtering interpolates every frame pair (including the wrap) with one
fetch per matrix row. The vertex shader blends two bones per vertex and cross-fades two clips.

Outputs (kit.run, KIND 'anim'):  public/models/infantry/anim.<rig>.glb
    nodes: root + the rig's joints at rest (glTF hierarchy, so viewers show the skeleton)
    extras.rh_anim: {rig, bones, parents, rest, fps, rows, width, clips: [{name, row, frames, duration, loop, ...}],
                     vat: {bufferView, format: 'rgba16f', width, height}}
Outputs (KIND 'infantry'):  public/models/infantry/<id>[.<faction>].glb
    a glTF skinned mesh (JOINTS_0 / WEIGHTS_0, inverseBindMatrices with the dequantisation folded in), the atlas
    textures as for every HD model (kit.export), a second decimated mesh 'body_lod1' (the crowd's far LOD), and
    points (muzzles) as children of their bones.
"""
import json
import math
import os
import struct

import numpy as np
from mathutils import Matrix, Vector

from . import export as Ex
from . import materials as Mt
from .core import TO_BLENDER
from .rig import RIGS, M4

GL_BYTE, GL_UBYTE, GL_SHORT, GL_USHORT, GL_UINT, GL_FLOAT = 5120, 5121, 5122, 5123, 5125, 5126


# ---------------------------------------------------------------------------------------------------------
# Clips -> texture


def bake(skeleton, clips, log=print):
    """-> (float32 array (rows, 3 * bones, 4), clip table, report)."""
    rows = []
    table = []
    worst = 0.0
    nb = len(skeleton)
    for c in clips:
        times = c.times()
        start = len(rows)
        loop_err = 0.0
        first = None
        for i, t in enumerate(times):
            last = c.loop and i == len(times) - 1
            pose = c.fn(0.0) if last else c.fn(t)  # a loop closes on its first frame exactly
            worst = max(worst, skeleton.check(pose))
            mats = skeleton.skin(pose)
            row = np.zeros((nb * 3, 4), np.float32)
            for b, S in enumerate(mats):
                for r in range(3):
                    row[b * 3 + r] = (S[r][0], S[r][1], S[r][2], S[r][3])
            if i == 0:
                first = row
            if c.loop and i == len(times) - 1:
                # also measure how far the true end pose is from the start (a loop that doesn't close)
                end = c.fn(c.duration)
                em = skeleton.skin(end)
                e = 0.0
                for b, S in enumerate(em):
                    for r in range(3):
                        e = max(e, max(abs(S[r][k] - first[b * 3 + r][k]) for k in range(4)))
                loop_err = e
            rows.append(row)
        ent = {'name': c.name, 'row': start, 'frames': len(times), 'duration': round(c.duration, 4), 'fps': c.fps,
               'loop': bool(c.loop)}
        for k, v in c.meta.items():
            ent[k] = round(v, 5) if isinstance(v, float) else v
        table.append(ent)
        if c.loop and loop_err > 0.02:
            log(f'  WARNING clip {c.name}: loop does not close (max matrix delta {loop_err:.3f})')
    arr = np.stack(rows, 0)
    if not np.all(np.isfinite(arr)):
        raise ValueError('VAT: non-finite values')
    if np.abs(arr).max() > 60000:
        raise ValueError('VAT: values out of half-float range')
    return arr, table, {'bone_len_err': worst, 'rows': len(rows)}


def write_anim(skeleton, arr, table, path, meta_extra=None):
    """The anim GLB: the skeleton at rest (nodes) + the VAT as an embedded half-float buffer (extras.rh_anim)."""
    B = Ex._Bin()
    half = arr.astype(np.float16)
    H, W, _ = half.shape
    bv = B.view(half.tobytes())
    gl = {
        'asset': {'version': '2.0', 'generator': 'red-horizon tools/assets kit (vat)'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [],
    }
    root = {'name': 'root', 'children': [], 'extras': {}}
    gl['nodes'].append(root)
    node_of = {}
    for i, n in enumerate(skeleton.names):
        p = skeleton.parent[i]
        off = skeleton.rest_pos[i] - (skeleton.rest_pos[p] if p >= 0 else Vector((0, 0, 0)))
        nd = {'name': n, 'translation': [round(float(x), 6) for x in off]}
        gl['nodes'].append(nd)
        node_of[n] = len(gl['nodes']) - 1
        if p < 0:
            root['children'].append(node_of[n])
        else:
            gl['nodes'][node_of[skeleton.names[p]]].setdefault('children', []).append(node_of[n])
    root['extras']['rh_anim'] = dict({
        'rig': skeleton.name,
        'bones': list(skeleton.names),
        'parents': list(skeleton.parent),
        'rest': [[round(float(x), 6) for x in v] for v in skeleton.rest_pos],
        'clips': table,
        'vat': {'bufferView': bv, 'format': 'rgba16f', 'width': W, 'height': H, 'layout': 'x = 3 * bone + row, y = frame'},
    }, **(skeleton.meta or {}), **(meta_extra or {}))
    root['extras']['rh'] = {'id': f'anim.{skeleton.name}', 'kind': 'anim', 'rig': skeleton.name}
    gl['bufferViews'] = B.views
    blob = B.blob()
    gl['buffers'] = [{'byteLength': len(blob)}]
    return _write_glb(gl, blob, path)


def _write_glb(gl, blob, path):
    js = json.dumps(gl, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    tmp = f'{path}.tmp-{os.getpid()}'
    with open(tmp, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(blob), 0x004E4942))
        f.write(blob)
    os.replace(tmp, path)
    return total


# ---------------------------------------------------------------------------------------------------------
# Stick-figure contact sheet (numpy raster, no GPU): quick pose checks while authoring clips


def stick_sheet(skeleton, clips, path, per=6, cell=110, views=('side', 'front'), chunk=10):
    """One row per clip: `per` frames, each drawn from the side (+X right) and the front. Writes path, or
    path-1.png, path-2.png... when there are more than `chunk` clips. Returns the number of frames drawn."""
    from .export import save_png
    nv = len(views)
    total = 0
    groups = [clips[i:i + chunk] for i in range(0, len(clips), chunk)]
    for gi, group in enumerate(groups):
        img = np.ones((len(group) * cell, per * nv * cell, 4), np.float32) * 0.93
        s = cell / 0.48

        def dot(x, y, col, r=1):
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    xx, yy = int(x + dx), int(y + dy)
                    if 0 <= xx < img.shape[1] and 0 <= yy < img.shape[0]:
                        img[yy, xx, :3] = col

        def line(a, b, col):
            n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) + 2)
            for k in range(n):
                t = k / max(1, n - 1)
                dot(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, col, 1)
        for ci, c in enumerate(group):
            for fi in range(per):
                t = c.duration * fi / (per - 1 if not c.loop else per)
                pose = c.fn(t)
                total += 1
                for vi, view in enumerate(views):
                    x0 = (fi * nv + vi) * cell + cell * 0.5
                    y0 = ci * cell + cell * 0.04

                    def pr(v):
                        return (x0 + (v.x if view == 'side' else v.z) * s, y0 + (0.44 - v.y) * s)
                    for x in range(int(x0 - cell * 0.46), int(x0 + cell * 0.46)):
                        dot(x, y0 + 0.44 * s, (0.6, 0.5, 0.4), 0)
                    for bi, bn in enumerate(skeleton.names):
                        p = skeleton.parent[bi]
                        if bn in ('weapon', 'prop'):
                            W = pose[bn]
                            if W.to_scale()[0] < 0.01:
                                continue
                            if bn == 'weapon':
                                line(pr(W @ Vector((-0.06, 0, 0))), pr(W @ Vector((0.14, 0, 0))), (0.85, 0.1, 0.1))
                            else:
                                line(pr(W @ Vector((0.0, 0, 0))), pr(W @ Vector((0.04, 0, 0))), (0.6, 0.1, 0.7))
                            continue
                        if p < 0:
                            continue
                        a = pose[skeleton.names[p]].translation
                        b = pose[bn].translation
                        col = (0.1, 0.25, 0.8) if bn.endswith('_l') else (0.1, 0.6, 0.2) if bn.endswith('_r') else (0.15, 0.15, 0.15)
                        line(pr(a), pr(b), col)
                    # head, hands and feet ends
                    if 'head' in pose:
                        h = pose['head'] @ (Vector((0.004, 0.022, 0)) - Vector((0, 0, 0)))
                        hc = pr(h)
                        for k in range(16):
                            ang = 2 * math.pi * k / 16
                            dot(hc[0] + math.cos(ang) * 0.024 * s, hc[1] + math.sin(ang) * 0.024 * s, (0.15, 0.15, 0.15), 0)
                    for side in ('l', 'r'):
                        if 'foot_' + side in pose:
                            f = pose['foot_' + side]
                            line(pr(f.translation), pr(f @ Vector((0.045, -0.02, 0))), (0.4, 0.3, 0.2))
                        if 'hand_' + side in pose:
                            hnd = pose['hand_' + side]
                            fdir = hnd.to_3x3() @ (skeleton_forearm(skeleton, side))
                            line(pr(hnd.translation), pr(hnd.translation + fdir * 0.03), (0.9, 0.6, 0.1))
        out = path if len(groups) == 1 else path.replace('.png', f'-{gi + 1}.png')
        save_png(img[::-1].copy(), out)
    return total


def skeleton_forearm(skeleton, side):
    """The rest direction of a hand (continuing the rest forearm) for drawing."""
    try:
        from .rig import FOREARM_REST
        if skeleton.name == 'human':
            return FOREARM_REST[side]
    except Exception:
        pass
    return Vector((1, 0, 0))


# ---------------------------------------------------------------------------------------------------------
# Skinned model GLB


def _weights(me, nb, bones_used=None):
    """Per-vertex top-2 (joints uint8 x4, weights uint8 x4 summing to 255)."""
    nv = len(me.vertices)
    J = np.zeros((nv, 4), np.uint8)
    Wt = np.zeros((nv, 4), np.uint8)
    missing = 0
    for v in me.vertices:
        gs = sorted(((g.group, g.weight) for g in v.groups if g.weight > 1e-4 and g.group < nb), key=lambda x: -x[1])[:2]
        if not gs:
            missing += 1
            gs = [(0, 1.0)]
        s = sum(w for _, w in gs)
        w0 = int(round(gs[0][1] / s * 255))
        J[v.index, 0] = gs[0][0]
        Wt[v.index, 0] = w0
        if len(gs) > 1:
            J[v.index, 1] = gs[1][0]
            Wt[v.index, 1] = 255 - w0
        else:
            Wt[v.index, 0] = 255
    return J, Wt, missing


def _mesh_arrays(obj, nb):
    me = obj.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    tri_loops = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get('loops', tri_loops)
    nl = len(me.loops)
    lv = np.empty(nl, np.int32)
    me.loops.foreach_get('vertex_index', lv)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    nrm = np.empty(nl * 3, np.float32)
    me.corner_normals.foreach_get('vector', nrm)
    nrm = nrm.reshape(-1, 3)
    uvl = me.uv_layers[Mt.ATLAS_UV]
    uv = np.empty(nl * 2, np.float32)
    uvl.uv.foreach_get('vector', uv)
    uv = uv.reshape(-1, 2)
    me.calc_tangents(uvmap=Mt.ATLAS_UV)
    t3 = np.empty(nl * 3, np.float32)
    me.loops.foreach_get('tangent', t3)
    sg = np.empty(nl, np.float32)
    me.loops.foreach_get('bitangent_sign', sg)
    tan = np.concatenate([t3.reshape(-1, 3), sg[:, None]], 1)
    J, Wt, missing = _weights(me, nb)
    sel = tri_loops
    return {
        'pos': co[lv[sel]], 'nrm': nrm[sel], 'uv': uv[sel], 'tan': tan[sel],
        'j': J[lv[sel]], 'w': Wt[lv[sel]], 'missing': missing, 'tris': nt,
    }


def _unit_frames(pos, nrm, tan):
    """Unit normals and tangents for every corner (arrays in triangle-corner order, 3 per triangle).
    A zero normal (decimation can collapse a fan to nothing) takes its triangle's face normal, a zero tangent
    (degenerate UVs) one perpendicular to the normal: normalize() of a zero vector is NaN on real GPUs."""
    n = nrm.astype(np.float64)
    ln = np.linalg.norm(n, axis=1)
    bad = ln < 1e-4
    if bad.any():
        tri = pos.astype(np.float64).reshape(-1, 3, 3)
        fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        fl = np.linalg.norm(fn, axis=1, keepdims=True)
        fn = np.where(fl > 1e-12, fn / np.maximum(fl, 1e-12), np.array([0.0, 0.0, 1.0]))
        n[bad] = np.repeat(fn, 3, axis=0)[bad]
        ln = np.linalg.norm(n, axis=1)
    n /= ln[:, None]
    t = tan.astype(np.float64).copy()
    t[:, :3] -= n * np.sum(t[:, :3] * n, axis=1, keepdims=True)  # Gram-Schmidt against the normal
    lt = np.linalg.norm(t[:, :3], axis=1)
    tb = lt < 1e-4
    if tb.any():
        axis = np.where(np.abs(n[tb, 1:2]) < 0.9, np.array([0.0, 1.0, 0.0]), np.array([1.0, 0.0, 0.0]))
        t[tb, :3] = np.cross(n[tb], axis)
        lt = np.linalg.norm(t[:, :3], axis=1)
    t[:, :3] /= lt[:, None]
    t[:, 3] = np.where(t[:, 3] < 0, -1.0, 1.0)
    return n, t, int(bad.sum()), int(tb.sum())


def _quant(d, c, s):
    q = np.round((d['pos'] - c) / s * 32767).astype(np.int16)
    nf, tf, d['zero_nrm'], d['zero_tan'] = _unit_frames(d['pos'], d['nrm'], d['tan'])
    n = np.round(np.clip(nf, -1, 1) * 127).astype(np.int8)
    u = np.clip(d['uv'], 0, 1).copy()
    u[:, 1] = 1.0 - u[:, 1]
    uv = np.round(u * 65535).astype(np.uint16)
    tan = np.round(np.clip(tf, -1, 1) * 127).astype(np.int8)
    key = np.concatenate([q.astype(np.int64), n.astype(np.int64), uv.astype(np.int64), tan.astype(np.int64),
                          d['j'].astype(np.int64), d['w'].astype(np.int64)], 1)
    _u, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    return {'POSITION': q[first], 'NORMAL': n[first], 'TEXCOORD_0': uv[first], 'TANGENT': tan[first],
            'JOINTS_0': d['j'][first], 'WEIGHTS_0': d['w'][first]}, inv.astype(np.uint32)


def decimated(obj, ratio):
    """A decimated copy of obj's mesh data (collapse; UVs and vertex groups are interpolated). Returns a temp object."""
    import bpy
    ob = obj.copy()
    ob.data = obj.data.copy()
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('rh_decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    # vertex groups survive on the object (same names / order); the new mesh carries the interpolated weights
    return ob


def write_skinned(model, images, path, meta_extra=None, lod_ratio=0.3, log=print):
    """Write the soldier GLB (see the module docstring). model.skin = the kit.skin.Skin; its part's object holds the
    geometry (game frame) with one vertex group per bone (index = bone index)."""
    import bpy
    sk = model.skin.sk
    nb = len(sk)
    obj = model.skin.part.obj
    others = [p for p in model.parts.values() if p.obj is not None and p is not model.skin.part]
    if others:
        raise ValueError(f'skinned models keep all atlas geometry in the skin part (found {[p.name for p in others]})')
    d0 = _mesh_arrays(obj, nb)
    if d0['missing']:
        log(f'  WARNING {d0["missing"]} vertices without bone weights (bound to {sk.names[0]})')
    lod = decimated(obj, lod_ratio)
    d1 = _mesh_arrays(lod, nb)
    bpy.data.objects.remove(lod)
    allp = np.concatenate([d0['pos'], d1['pos']])
    lo, hi = allp.min(0), allp.max(0)
    c = (lo + hi) / 2
    s = float(max(np.abs(hi - c).max(), 1e-6))
    B = Ex._Bin()
    gl = {
        'asset': {'version': '2.0', 'generator': 'red-horizon tools/assets kit (skinned)'},
        'extensionsUsed': ['KHR_mesh_quantization', 'EXT_texture_webp'],
        'extensionsRequired': ['KHR_mesh_quantization', 'EXT_texture_webp'],
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [], 'meshes': [], 'materials': [],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
        'images': [], 'textures': [], 'skins': [],
    }
    tex = {}
    for k in ('base', 'orm', 'normal', 'mask'):
        bv = B.view(images[k])
        gl['images'].append({'bufferView': bv, 'mimeType': 'image/webp', 'name': k})
        gl['textures'].append({'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': len(gl['images']) - 1}}})
        tex[k] = len(gl['textures']) - 1
    gl['materials'].append({'name': 'body', 'pbrMetallicRoughness': {'baseColorTexture': {'index': tex['base']},
                                                                     'metallicRoughnessTexture': {'index': tex['orm']}},
                            'normalTexture': {'index': tex['normal']}, 'occlusionTexture': {'index': tex['orm']},
                            'emissiveTexture': {'index': tex['mask']}, 'emissiveFactor': [0, 0, 0]})
    meta = dict(model.meta, **(meta_extra or {}))
    root = {'name': 'root', 'children': [], 'extras': {'rh': meta}}
    gl['nodes'].append(root)
    joint_node = []
    for i, n in enumerate(sk.names):
        p = sk.parent[i]
        off = sk.rest_pos[i] - (sk.rest_pos[p] if p >= 0 else Vector((0, 0, 0)))
        gl['nodes'].append({'name': n, 'translation': [round(float(x), 6) for x in off]})
        joint_node.append(len(gl['nodes']) - 1)
        if p < 0:
            root['children'].append(joint_node[i])
        else:
            gl['nodes'][joint_node[p]].setdefault('children', []).append(joint_node[i])
    # points (muzzles...) as children of their bones, at the bone-local rest offset
    for name, pt in (model.meta.get('points') or {}).items():
        bi = sk.index[pt['bone']]
        local = [round(float(a - b), 6) for a, b in zip(pt['at'], sk.rest_pos[bi])]
        gl['nodes'].append({'name': name, 'translation': local, 'extras': {'rh_point': pt.get('kind', 'muzzle')}})
        gl['nodes'][joint_node[bi]].setdefault('children', []).append(len(gl['nodes']) - 1)
    # inverse bind matrices with the dequantisation folded in: IBM = inverse(rest) @ T(c) @ S(s)
    D = np.diag([s, s, s, 1.0]).astype(np.float64)
    D[:3, 3] = c
    ibm = []
    for i in range(nb):
        inv = np.eye(4)
        inv[:3, 3] = -np.array(sk.rest_pos[i])
        m = inv @ D
        ibm.append(m.T.reshape(-1))  # column-major
    ibm_acc = B.accessor(np.array(ibm, np.float32), GL_FLOAT, 'MAT4')
    gl['skins'].append({'name': sk.name, 'joints': joint_node, 'inverseBindMatrices': ibm_acc, 'skeleton': joint_node[0]})
    stats = {'tris': 0, 'verts': 0, 'lods': []}
    for li, d in enumerate((d0, d1)):
        attrs, idx = _quant(d, c, s)
        if d['zero_nrm'] or d['zero_tan']:
            log(f"  lod{li}: repaired {d['zero_nrm']} zero normals, {d['zero_tan']} zero tangents")
        pa = {
            'POSITION': B.accessor(attrs['POSITION'], GL_SHORT, 'VEC3', True, stride=8, minmax=True),
            'NORMAL': B.accessor(attrs['NORMAL'], GL_BYTE, 'VEC3', True, stride=4),
            'TANGENT': B.accessor(attrs['TANGENT'], GL_BYTE, 'VEC4', True, stride=4),
            'TEXCOORD_0': B.accessor(attrs['TEXCOORD_0'], GL_USHORT, 'VEC2', True, stride=4),
            'JOINTS_0': B.accessor(attrs['JOINTS_0'], GL_UBYTE, 'VEC4', False, stride=4),
            'WEIGHTS_0': B.accessor(attrs['WEIGHTS_0'], GL_UBYTE, 'VEC4', True, stride=4),
        }
        nv = attrs['POSITION'].shape[0]
        it = idx.astype(np.uint16 if nv < 65536 else np.uint32)
        ia = B.accessor(it.reshape(-1, 1), GL_USHORT if nv < 65536 else GL_UINT, 'SCALAR', target=Ex.ELEMENT)
        name = 'body' if li == 0 else 'body_lod1'
        gl['meshes'].append({'name': name, 'primitives': [{'attributes': pa, 'indices': ia, 'material': 0}],
                             'extras': {'rh_dequant': {'c': [float(x) for x in c], 's': s}, 'lod': li}})
        gl['nodes'].append({'name': name, 'mesh': len(gl['meshes']) - 1, 'skin': 0})
        root['children'].append(len(gl['nodes']) - 1)
        tris = len(idx) // 3
        stats['lods'].append(tris)
        if li == 0:
            stats['tris'] = tris
            stats['verts'] = nv
    root['extras']['rh']['lods'] = stats['lods']
    gl['bufferViews'] = B.views
    gl['accessors'] = B.accessors
    blob = B.blob()
    gl['buffers'] = [{'byteLength': len(blob)}]
    stats['bytes'] = _write_glb(gl, blob, path)
    stats['texture_bytes'] = {k: len(v) for k, v in images.items()}
    stats['parts'] = ['skin']
    return stats


# ---------------------------------------------------------------------------------------------------------
# Blender armature + keyed actions (debugging / inspection: kit.run --keep-blend saves them)


def armature(skeleton, name='rig'):
    import bpy
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for i, n in enumerate(skeleton.names):
        b = arm.edit_bones.new(n)
        head = TO_BLENDER @ skeleton.rest_pos[i]
        kids = [j for j, p in enumerate(skeleton.parent) if p == i]
        if kids:
            tail = TO_BLENDER @ skeleton.rest_pos[kids[0]]
            if (tail - head).length < 0.005:
                tail = head + Vector((0, 0, 0.02))
        else:
            tail = head + Vector((0, 0, 0.02))
        b.head, b.tail = head, tail
        if skeleton.parent[i] >= 0:
            b.parent = eb[skeleton.names[skeleton.parent[i]]]
        eb[n] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def key_actions(ob, skeleton, clips):
    """Key every clip as an action on armature `ob` (pose bones' matrix_basis from the clip's world matrices)."""
    import bpy
    C = TO_BLENDER
    Ci = C.inverted()
    rest = {b.name: b.matrix_local.copy() for b in ob.data.bones}
    ob.animation_data_create()
    for c in clips:
        act = bpy.data.actions.new(c.name)
        ob.animation_data.action = act
        for fi, t in enumerate(c.times()):
            pose = c.fn(t)
            P = {}
            for i, n in enumerate(skeleton.names):
                S = pose[n] @ Matrix.Translation(-skeleton.rest_pos[i])
                P[n] = C @ S @ Ci @ rest[n]
            for i, n in enumerate(skeleton.names):
                p = skeleton.parent[i]
                pb = ob.pose.bones[n]
                if p < 0:
                    basis = rest[n].inverted() @ P[n]
                else:
                    pn = skeleton.names[p]
                    basis = (rest[pn].inverted() @ rest[n]).inverted() @ P[pn].inverted() @ P[n]
                pb.matrix_basis = basis
                frame = 1 + fi
                pb.keyframe_insert('location', frame=frame, group=n)
                pb.keyframe_insert('rotation_quaternion', frame=frame, group=n)
                pb.keyframe_insert('scale', frame=frame, group=n)
    return ob


__all__ = ['bake', 'write_anim', 'write_skinned', 'stick_sheet', 'armature', 'key_actions', 'RIGS', 'M4']
