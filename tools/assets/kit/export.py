"""GLB writer: KHR_mesh_quantization + EXT_texture_webp, no decoders needed (CSP-safe).

Layout of an exported model (all names are the game's node names):

    root                     (extras.rh = model metadata: footprint, height, radius, points, keep, ...)
     +- root_mesh            mesh carrier: dequantisation transform (translation + uniform scale)
     +- turret               animated part (rest transform relative to its parent)
     |   +- turret_mesh
     |   +- b0 (+ b0_mesh)   barrels, recoil along -X
     |   +- m0               muzzle point (extras.rh_point = 'muzzle')
     +- smoke0               smoke / steam / sparks points (extras.rh_point = kind)

Primitives per part, by material: 'body' (the atlas), optional 'glass' (same atlas, glossy second material),
'track' (scrolling tread, float belt UVs), 'glow:<slot>' (separately animated emissive, COLOR_0).
Attributes: POSITION int16 (normalised), NORMAL int8, TANGENT int8, TEXCOORD_0 uint16 (atlas, normalised) or
float (track belts), indices uint16/uint32.
"""
import json
import os
import math
import struct

import bpy
import numpy as np

from . import materials as Mt

GL_BYTE, GL_UBYTE, GL_SHORT, GL_USHORT, GL_UINT, GL_FLOAT = 5120, 5121, 5122, 5123, 5125, 5126
ARRAY, ELEMENT = 34962, 34963


class _Bin:
    def __init__(self):
        self.chunks = []
        self.size = 0
        self.views = []
        self.accessors = []

    def view(self, data: bytes, target=None, stride=None):
        pad = (-self.size) % 8
        if pad:
            self.chunks.append(b'\0' * pad)
            self.size += pad
        v = {'buffer': 0, 'byteOffset': self.size, 'byteLength': len(data)}
        if target:
            v['target'] = target
        if stride:
            v['byteStride'] = stride
        self.chunks.append(data)
        self.size += len(data)
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, arr, ctype, typ, normalized=False, target=ARRAY, stride=None, minmax=False):
        """arr: (n, k) numpy array already in the component type; padded to `stride` bytes per element."""
        n = arr.shape[0]
        raw = np.ascontiguousarray(arr)
        if stride and raw.itemsize * raw.shape[1] != stride:
            k = raw.shape[1]
            padk = stride // raw.itemsize
            tmp = np.zeros((n, padk), raw.dtype)
            tmp[:, :k] = raw
            raw = tmp
        bv = self.view(raw.tobytes(), target, stride if target == ARRAY else None)
        a = {'bufferView': bv, 'componentType': ctype, 'count': int(n), 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = [int(x) if ctype != GL_FLOAT else float(x) for x in arr.min(axis=0)]
            a['max'] = [int(x) if ctype != GL_FLOAT else float(x) for x in arr.max(axis=0)]
        self.accessors.append(a)
        return len(self.accessors) - 1

    def blob(self):
        data = b''.join(self.chunks)
        return data + b'\0' * ((-len(data)) % 4)


def _mesh_data(obj, atlas=True, separate_glass=False):
    """-> {material_name: dict(pos, nrm, tan, uv, col)} for one object (object-local = part frame)."""
    me = obj.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    if nt == 0:
        return {}
    tri_loops = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get('loops', tri_loops)
    tri_mat = np.empty(nt, np.int32)
    me.loop_triangles.foreach_get('material_index', tri_mat)
    nl = len(me.loops)
    lv = np.empty(nl, np.int32)
    me.loops.foreach_get('vertex_index', lv)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    nrm = np.empty(nl * 3, np.float32)
    me.corner_normals.foreach_get('vector', nrm)
    nrm = nrm.reshape(-1, 3)
    uv = None
    tan = None
    uvname = Mt.ATLAS_UV if atlas else ('belt' if 'belt' in me.uv_layers else None)
    if uvname and uvname in me.uv_layers:
        uvl = me.uv_layers[uvname]
        uv = np.empty(nl * 2, np.float32)
        uvl.uv.foreach_get('vector', uv)
        uv = uv.reshape(-1, 2)
        if atlas:
            me.calc_tangents(uvmap=uvname)
            t3 = np.empty(nl * 3, np.float32)
            me.loops.foreach_get('tangent', t3)
            sg = np.empty(nl, np.float32)
            me.loops.foreach_get('bitangent_sign', sg)
            tan = np.concatenate([t3.reshape(-1, 3), sg[:, None]], 1)
    mats = [m for m in me.materials]
    out = {}
    for mi in np.unique(tri_mat):
        mat = mats[mi] if mi < len(mats) else None
        if atlas:
            name = 'glass' if (separate_glass and mat is not None and mat.get('rh_kind') == 'glass') else 'body'
        else:
            name = (mat.get('rh_slot') or mat.name) if mat is not None else 'body'  # glow colours share their slot
        sel = tri_loops.reshape(-1, 3)[tri_mat == mi].ravel()
        d = out.setdefault(name, {'pos': [], 'nrm': [], 'tan': [], 'uv': [], 'col': []})
        d['pos'].append(co[lv[sel]])
        d['nrm'].append(nrm[sel])
        if uv is not None:
            d['uv'].append(uv[sel])
        if tan is not None:
            d['tan'].append(tan[sel])
        if name.startswith('glow:') and mat is not None:
            c = mat.get('rh_color', (1, 0.2, 0.1))
            d['col'].append(np.tile(np.array([c[0], c[1], c[2], 1.0], np.float32), (len(sel), 1)))
    for d in out.values():
        for k in list(d):
            d[k] = np.concatenate(d[k]) if d[k] else None
    return out


def _quant_part(prims, track=False):
    """Weld + quantise the primitives of one part. Returns (center, scale, [(name, attrs, indices)])."""
    allp = np.concatenate([p['pos'] for p in prims.values()])
    lo, hi = allp.min(0), allp.max(0)
    c = (lo + hi) / 2
    s = float(max(np.abs(hi - c).max(), 1e-6))
    res = []
    for name, p in prims.items():
        q = np.round((p['pos'] - c) / s * 32767).astype(np.int16)
        n = np.round(np.clip(p['nrm'], -1, 1) * 127).astype(np.int8)
        cols = [q.astype(np.int64), n.astype(np.int64)]
        uv = None
        tan = None
        if p['uv'] is not None:
            if name == 'track':
                uv = p['uv'].astype(np.float32)
                cols.append(np.round(uv * 4096).astype(np.int64))
            else:
                u = np.clip(p['uv'], 0, 1).copy()
                u[:, 1] = 1.0 - u[:, 1]
                uv = np.round(u * 65535).astype(np.uint16)
                cols.append(uv.astype(np.int64))
        if p['tan'] is not None:
            t = p['tan'].copy()
            t[:, :3] /= np.maximum(np.linalg.norm(t[:, :3], axis=1, keepdims=True), 1e-6)
            tan = np.round(np.clip(t, -1, 1) * 127).astype(np.int8)
            cols.append(tan.astype(np.int64))
        col = None
        if p['col'] is not None:
            col = np.round(np.clip(p['col'], 0, 1) * 255).astype(np.uint8)
            cols.append(col.astype(np.int64))
        key = np.concatenate(cols, 1)
        uniq, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        inv = inv.ravel()
        attrs = {'POSITION': q[first], 'NORMAL': n[first]}
        if uv is not None:
            attrs['TEXCOORD_0'] = uv[first]
        if tan is not None:
            attrs['TANGENT'] = tan[first]
        if col is not None:
            attrs['COLOR_0'] = col[first]
        res.append((name, attrs, inv.astype(np.uint32)))
    return c, s, res


def write(model, images, path, meta_extra=None, separate_glass=False):
    """images: {'base': bytes, 'orm': bytes, 'normal': bytes, 'mask': bytes} (WebP). Returns stats."""
    B = _Bin()
    gl = {
        'asset': {'version': '2.0', 'generator': 'red-horizon tools/assets kit'},
        'extensionsUsed': ['KHR_mesh_quantization', 'EXT_texture_webp'],
        'extensionsRequired': ['KHR_mesh_quantization', 'EXT_texture_webp'],
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [], 'meshes': [], 'materials': [],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
        'images': [], 'textures': [],
    }
    tex = {}
    for k in ('base', 'orm', 'normal', 'mask'):
        bv = B.view(images[k])
        gl['images'].append({'bufferView': bv, 'mimeType': 'image/webp', 'name': k})
        gl['textures'].append({'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': len(gl['images']) - 1}}})
        tex[k] = len(gl['textures']) - 1
    mat_index = {}

    def material(name):
        if name in mat_index:
            return mat_index[name]
        if name in ('body', 'glass'):
            md = {'name': name, 'pbrMetallicRoughness': {'baseColorTexture': {'index': tex['base']},
                                                         'metallicRoughnessTexture': {'index': tex['orm']}},
                  'normalTexture': {'index': tex['normal']}, 'occlusionTexture': {'index': tex['orm']},
                  # the mask (team, emit, emit mode) rides in the emissive slot with a zero factor: generic
                  # viewers ignore it, the game reads it (src/render/models/hd.ts)
                  'emissiveTexture': {'index': tex['mask']}, 'emissiveFactor': [0, 0, 0]}
            if name == 'glass':
                md['pbrMetallicRoughness']['roughnessFactor'] = 0.25
        elif name == 'track':
            md = {'name': 'track', 'pbrMetallicRoughness': {'baseColorFactor': [0.05, 0.05, 0.055, 1], 'metallicFactor': 0.5, 'roughnessFactor': 0.6}}
        else:
            md = {'name': name, 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 1}, 'emissiveFactor': [1, 1, 1]}
        gl['materials'].append(md)
        mat_index[name] = len(gl['materials']) - 1
        return mat_index[name]

    stats = {'tris': 0, 'verts': 0, 'parts': []}
    node_of = {}

    def mk_node(name, M, extras=None):
        loc, rot, _sc = M.decompose()
        nd = {'name': name}
        if loc.length > 1e-7:
            nd['translation'] = [round(float(v), 6) for v in loc]
        if abs(rot.w - 1.0) > 1e-7:
            nd['rotation'] = [round(float(rot.x), 7), round(float(rot.y), 7), round(float(rot.z), 7), round(float(rot.w), 7)]
        if extras:
            nd['extras'] = extras
        gl['nodes'].append(nd)
        return len(gl['nodes']) - 1

    # parts in hierarchy order (root first)
    order = []

    def visit(p):
        order.append(p)
        for c in model.parts.values():
            if c.parent is p:
                visit(c)
    visit(model.root)
    for p in order:
        meta = None
        if p is model.root:
            meta = {'rh': dict(model.meta, **(meta_extra or {}))}
        else:
            meta = {'rh_part': True}
        node_of[p.name] = mk_node(p.name, p.local(), meta)
        if p.parent is not None:
            gl['nodes'][node_of[p.parent.name]].setdefault('children', []).append(node_of[p.name])
        prims = {}
        objs = [(p.obj, True)] + [(o, False) for o in p.extra_objs.values()]
        for (o, atlas) in objs:
            if o is None:
                continue
            for k, d in _mesh_data(o, atlas, separate_glass).items():
                if k in prims:
                    for kk in d:
                        if d[kk] is not None:
                            prims[k][kk] = np.concatenate([prims[k][kk], d[kk]]) if prims[k][kk] is not None else d[kk]
                else:
                    prims[k] = d
        if not prims:
            continue
        c, s, qprims = _quant_part(prims)
        mesh = {'name': p.name, 'primitives': []}
        for (name, attrs, idx) in qprims:
            pa = {}
            pa['POSITION'] = B.accessor(attrs['POSITION'], GL_SHORT, 'VEC3', True, stride=8, minmax=True)
            pa['NORMAL'] = B.accessor(attrs['NORMAL'], GL_BYTE, 'VEC3', True, stride=4)
            if 'TANGENT' in attrs:
                pa['TANGENT'] = B.accessor(attrs['TANGENT'], GL_BYTE, 'VEC4', True, stride=4)
            if 'TEXCOORD_0' in attrs:
                t = attrs['TEXCOORD_0']
                if t.dtype == np.uint16:
                    pa['TEXCOORD_0'] = B.accessor(t, GL_USHORT, 'VEC2', True, stride=4)
                else:
                    pa['TEXCOORD_0'] = B.accessor(t.astype(np.float32), GL_FLOAT, 'VEC2', False, stride=8)
            if 'COLOR_0' in attrs:
                pa['COLOR_0'] = B.accessor(attrs['COLOR_0'], GL_UBYTE, 'VEC4', True, stride=4)
            nv = attrs['POSITION'].shape[0]
            it = idx.astype(np.uint16 if nv < 65536 else np.uint32)
            ia = B.accessor(it.reshape(-1, 1), GL_USHORT if nv < 65536 else GL_UINT, 'SCALAR', target=ELEMENT)
            mesh['primitives'].append({'attributes': pa, 'indices': ia, 'material': material(name)})
            stats['tris'] += len(idx) // 3
            stats['verts'] += nv
        gl['meshes'].append(mesh)
        from mathutils import Matrix, Vector
        Mq = Matrix.Translation(Vector(c.tolist())) @ Matrix.Diagonal((s, s, s, 1.0))
        cn = {'name': p.name + '_mesh', 'mesh': len(gl['meshes']) - 1, 'translation': [float(v) for v in c], 'scale': [s, s, s], 'extras': {'rh_mesh': True}}
        gl['nodes'].append(cn)
        gl['nodes'][node_of[p.name]].setdefault('children', []).append(len(gl['nodes']) - 1)
        stats['parts'].append(p.name)
    for pt in model.points.values():
        i = mk_node(pt.name, pt.local(), {'rh_point': pt.kind or 'point'})
        gl['nodes'][node_of[pt.part.name]].setdefault('children', []).append(i)
    gl['bufferViews'] = B.views
    gl['accessors'] = B.accessors
    blob = B.blob()
    gl['buffers'] = [{'byteLength': len(blob)}]
    js = json.dumps(gl, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    # atomic: tests, the dev server and the service worker never see a half-written GLB while agents rebuild
    tmp = f'{path}.tmp-{os.getpid()}'
    with open(tmp, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(blob), 0x004E4942))
        f.write(blob)
    os.replace(tmp, path)
    stats['bytes'] = total
    stats['texture_bytes'] = {k: len(v) for k, v in images.items()}
    return stats


def save_webp(arr, path, quality, size=None):
    """Write an RGBA float array (row 0 = bottom, values 0..1, already encoded) as an RGB WebP via Blender."""
    h, w = arr.shape[:2]
    img = bpy.data.images.new('rh_out', w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    a = np.ascontiguousarray(arr, np.float32).copy()
    a[..., 3] = 1.0
    img.pixels.foreach_set(a.ravel())
    img.filepath_raw = path
    img.file_format = 'WEBP'
    img.save(filepath=path, quality=quality)
    bpy.data.images.remove(img)
    with open(path, 'rb') as f:
        return f.read()


def save_png(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new('rh_dbg', w, h, alpha=False, float_buffer=False)
    a = np.ascontiguousarray(arr, np.float32).copy()
    a[..., 3] = 1.0
    img.pixels.foreach_set(np.clip(a, 0, 1).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
