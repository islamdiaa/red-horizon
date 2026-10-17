"""Blender entry point: build, bake and export ONE model.

    blender -b --factory-startup -t 6 --python tools/assets/kit/run.py -- \
        --model tools/assets/models/soviet/powr.py --out public/models [--preview out.png] [--quick]

Writes <out>/<ID>[.<FACTION>].glb and prints one line 'RH_REPORT {json}' (tris, bytes, timings) for
tools/assets/build.mjs. --quick halves the atlas and bake samples (fast iteration; never commit its output).
"""
import argparse
import importlib.util
import json
import os
import sys
import time

sys.dont_write_bytecode = True  # no __pycache__ in the repo
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(ASSETS))
sys.path.insert(0, ASSETS)

import bpy  # noqa: E402

import kit  # noqa: E402
from kit import bake, decals, export, materials  # noqa: E402


def log(*a):
    print('[kit]', *a, flush=True)


def key0(m):
    return m.id + (f'.{m.faction}' if m.faction else '')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--out', default=os.path.join(REPO, 'public', 'models'))
    ap.add_argument('--preview', default=None)
    ap.add_argument('--quick', action='store_true')
    ap.add_argument('--threads', type=int, default=6)
    ap.add_argument('--keep-blend', default=None, help='save the baked .blend here (debugging)')
    ap.add_argument('--debug', default=None, help='write every baked map as PNG into this directory')
    a = ap.parse_args(argv)

    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    decals.FONT_PATH = os.path.join(REPO, 'public', 'fonts', 'rajdhani-700.woff2')
    spec = importlib.util.spec_from_file_location('rh_model', a.model)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    kind = getattr(mod, 'KIND', 'structure')
    if kind == 'anim':
        # a rig's clip set -> the vertex animation texture (kit.vat): no geometry, no bake
        return anim_main(mod, a, t0)
    m = kit.Model(mod.ID, getattr(mod, 'FACTION', None), kind, getattr(mod, 'ATLAS', None), getattr(mod, 'SEED', 1))
    if a.quick:
        m.atlas //= 2
        for k in bake.SAMPLES:
            bake.SAMPLES[k] = max(2, bake.SAMPLES[k] // 3)
    if kind in ('vehicle', 'aircraft', 'infantry'):
        materials.DIRT_H = 0.07
    mod.build(m)
    # per-model bake knobs (m.look / m.tune; 'ao' goes to materials.finalize)
    tn = m.tuning
    if 'edge_light' in tn:
        materials.EDGE_LIGHT = float(tn['edge_light'])
    if 'dirt_h' in tn:
        materials.DIRT_H = float(tn['dirt_h'])
    if 'edge_radius' in tn:
        bake.EDGE_RADIUS = float(tn['edge_radius'])
    if 'chamfer_edge' in tn:
        bake.CHAMFER_EDGE = float(tn['chamfer_edge'])
    if 'ao_distance' in tn:
        bake.AO_DISTANCE = float(tn['ao_distance'])
    objs = m.realize()
    if getattr(m, 'skin', None) is not None:
        # one vertex group per bone (group index = bone index, as written by kit.skin)
        so = m.skin.part.obj
        for n in m.skin.sk.names:
            so.vertex_groups.new(name=n)
    culled = bake.cull_model(m)
    tris = m.tris()
    log(f'{m.id}: {tris} triangles ({culled} hidden faces culled), {len(m.parts)} parts, {len(m.decals)} decals, built in {time.time() - t0:.1f}s')

    t1 = time.time()
    bake.setup_scene(a.threads)
    if m.ground:
        bake.ground_plane()
    decals.assign_targets(m)
    cov = bake.unwrap(objs, m.atlas, boost=decals.boost_faces(m))
    log(f'unwrap {time.time() - t1:.1f}s, atlas coverage {cov * 100:.0f}%')
    t1 = time.time()
    bake.prepare_masks(m.atlas)
    materials.finalize(m.decals, look=m.tuning)
    log(f'materials {time.time() - t1:.1f}s')
    t2 = time.time()
    ungrounded = [p.obj for p in m.parts.values() if p.obj is not None and not p.grounded()] if m.ground else []
    bake.phase1(objs, m.atlas, log, ungrounded=ungrounded)
    ch = bake.phase2(objs, m.atlas, log)
    log(f'bake {time.time() - t2:.1f}s')
    maps = bake.compose(ch, m.atlas)
    if a.debug:
        os.makedirs(a.debug, exist_ok=True)
        dbg = dict(ch)
        dbg['edge'] = bake.px(bpy.data.images['RHMASK_edge']).copy()
        for k, arr in dbg.items():
            v = arr.copy()
            if k == 'base':
                v[..., :3] = bake.to_srgb(v[..., :3])
            export.save_png(v, os.path.join(a.debug, f'{key0(m)}-{k}.png'))

    os.makedirs(a.out, exist_ok=True)
    key = m.id + (f'.{m.faction}' if m.faction else '')
    tmp = os.path.join(bpy.app.tempdir or '/tmp', f'rh_{key}')
    os.makedirs(tmp, exist_ok=True)
    q = {'base': 86, 'orm': 84, 'normal': 88, 'mask': 100}
    images = {k: export.save_webp(maps[k], os.path.join(tmp, f'{k}.webp'), q[k]) for k in ('base', 'orm', 'normal', 'mask')}
    path = os.path.join(a.out, key + '.glb')
    if getattr(m, 'skin', None) is not None:
        # rigged model (infantry, dogs): a glTF skinned mesh + its far LOD (kit.vat)
        from kit import vat
        st = vat.write_skinned(m, images, path, {'id': m.id, 'faction': m.faction, 'kind': m.kind, 'atlas': m.atlas}, log=log)
    else:
        st = export.write(m, images, path, {'id': m.id, 'faction': m.faction, 'kind': m.kind, 'atlas': m.atlas}, separate_glass=m.separate_glass)
    log(f'wrote {path}: {st["bytes"]} bytes, {st["tris"]} tris, {st["verts"]} verts ({time.time() - t0:.1f}s total)')
    if a.keep_blend:
        bpy.ops.wm.save_as_mainfile(filepath=a.keep_blend)
    if a.preview:
        from kit import preview
        preview.render(m, ch, a.preview)
    report = {
        'key': key, 'id': m.id, 'faction': m.faction, 'kind': m.kind, 'file': key + '.glb', 'bytes': st['bytes'],
        'tris': st['tris'], 'verts': st['verts'], 'parts': st['parts'], 'points': sorted(m.points.keys()),
        'textures': st['texture_bytes'], 'atlas': m.atlas, 'seconds': round(time.time() - t0, 1),
        'quick': a.quick,
    }
    print('RH_REPORT ' + json.dumps(report), flush=True)


def anim_main(mod, a, t0):
    """KIND 'anim': bake a rig's clips (mod.clips()) into public/models/.../anim.<rig>.glb."""
    from kit import vat
    from kit.rig import RIGS
    sk = RIGS[mod.RIG]
    clips = mod.clips()
    arr, table, rep = vat.bake(sk, clips, log)
    os.makedirs(a.out, exist_ok=True)
    key = f'anim.{sk.name}'
    path = os.path.join(a.out, key + '.glb')
    n = vat.write_anim(sk, arr, table, path, getattr(mod, 'META', None))
    extra = getattr(mod, 'report', lambda: {})()
    log(f'{key}: {len(clips)} clips, {rep["rows"]} frames, VAT {arr.shape[1]}x{arr.shape[0]} rgba16f, '
        f'bone length error {rep["bone_len_err"] * 1000:.2f} mm {extra}; wrote {path}: {n} bytes ({time.time() - t0:.1f}s)')
    if a.preview:
        frames = vat.stick_sheet(sk, clips, a.preview)
        log(f'stick sheet: {frames} frames -> {a.preview}')
    if a.keep_blend:
        ob = vat.armature(sk)
        vat.key_actions(ob, sk, clips)
        bpy.ops.wm.save_as_mainfile(filepath=a.keep_blend)
        log(f'saved the keyed armature: {a.keep_blend}')
    report = {
        'key': key, 'id': key, 'faction': None, 'kind': 'anim', 'file': key + '.glb', 'bytes': n, 'tris': 0, 'verts': 0,
        'parts': [], 'points': [], 'textures': {}, 'atlas': 0, 'seconds': round(time.time() - t0, 1), 'quick': a.quick,
        'clips': len(clips), 'frames': rep['rows'],
    }
    print('RH_REPORT ' + json.dumps(report), flush=True)


try:
    main()
except Exception:
    import traceback
    traceback.print_exc()
    print('RH_FAILED', flush=True)
    sys.exit(1)
