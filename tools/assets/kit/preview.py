"""Quick look at a baked model in Blender (Cycles): the exported atlases on a preview material, a sun, a
sky, the RTS camera angle (~40 degrees) plus a close-up. `build.mjs --preview` writes <key>.png next to the
report. The in-game check (tools/focus-shot.mjs) stays the reference: this is for fast iteration.
"""
import math

import bpy
import numpy as np
from mathutils import Vector

from . import bake as B
from . import core
from . import materials as Mt

TEAM_PREVIEW = (0.62, 0.09, 0.07)  # a conditioned Soviet red, linear


def _img(name, arr, colorspace='Non-Color'):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, float_buffer=True)
    img.colorspace_settings.name = colorspace
    a = np.ascontiguousarray(arr, np.float32).copy()
    a[..., 3] = 1
    img.pixels.foreach_set(a.ravel())
    return img


def _material(ch):
    m = bpy.data.materials.new('rh_preview')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = Mt.ATLAS_UV

    def tex(img):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        nt.links.new(uv.outputs[0], n.inputs[0])
        return n
    base = tex(_img('pv_base', ch['base']))  # linear albedo
    rmt = tex(_img('pv_rmt', ch['rmt']))
    em = tex(_img('pv_emit', ch['emit']))
    nrm = tex(_img('pv_nrm', ch['normal']))
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(rmt.outputs[0], sep.inputs[0])
    sep_e = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(em.outputs[0], sep_e.inputs[0])
    team = nt.nodes.new('ShaderNodeMix')
    team.data_type = 'RGBA'
    team.blend_type = 'MULTIPLY'
    nt.links.new(sep.outputs[2], team.inputs[0])
    nt.links.new(base.outputs[0], team.inputs[6])
    team.inputs[7].default_value = (TEAM_PREVIEW[0] / Mt.TEAM_GREY, TEAM_PREVIEW[1] / Mt.TEAM_GREY, TEAM_PREVIEW[2] / Mt.TEAM_GREY, 1)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(team.outputs[2], bsdf.inputs['Base Color'])
    nt.links.new(sep.outputs[0], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs[1], bsdf.inputs['Metallic'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.uv_map = Mt.ATLAS_UV
    nt.links.new(nrm.outputs[0], nm.inputs['Color'])
    nt.links.new(nm.outputs[0], bsdf.inputs['Normal'])
    nt.links.new(base.outputs[0], bsdf.inputs['Emission Color'])
    k = nt.nodes.new('ShaderNodeMath')
    k.operation = 'MULTIPLY'
    k.inputs[1].default_value = 1.6
    nt.links.new(sep_e.outputs[0], k.inputs[0])
    nt.links.new(k.outputs[0], bsdf.inputs['Emission Strength'])
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    return m


def render(model, ch, path, size=(960, 600)):
    sc = bpy.context.scene
    mat = _material(ch)
    objs = model.atlas_objects()
    for o in objs:
        for i in range(len(o.data.materials)):
            o.data.materials[i] = mat
    # ground: snowy-grey plane
    g = bpy.data.objects.get('rh_ground')
    if g is not None:
        gm = g.data.materials[0]
        bs = gm.node_tree.nodes.get('Principled BSDF')
        bs.inputs['Base Color'].default_value = (0.5, 0.52, 0.55, 1)
        bs.inputs['Roughness'].default_value = 0.9
    # light: sun from the camera side + sky
    sun_d = bpy.data.lights.new('sun', 'SUN')
    sun_d.energy = 3.2
    sun_d.angle = math.radians(4)
    sun = bpy.data.objects.new('sun', sun_d)
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(sun)
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.42, 0.5, 0.62, 1)
    sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    # frame the model from the RTS direction (south-east, ~40 degrees down)
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    r = (hi - lo).length / 2
    cam_d = bpy.data.cameras.new('cam')
    cam_d.lens = 50
    cam = bpy.data.objects.new('cam', cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.film_transparent = False
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'AgX'
    sc.render.image_settings.file_format = 'PNG'
    shots = []
    for (name, az, el, dist) in (('rts', -0.5, 40, 3.0), ('close', 0.45, 24, 1.9)):
        d = Vector((math.sin(az) * math.cos(math.radians(el)), -math.cos(az) * math.cos(math.radians(el)), math.sin(math.radians(el))))
        cam.location = c + d * r * dist
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        out = path.replace('.png', f'-{name}.png')
        sc.render.filepath = out
        bpy.ops.render.render(write_still=True)
        shots.append(out)
    print('[kit] preview', ' '.join(shots), flush=True)
