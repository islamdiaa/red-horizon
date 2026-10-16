"""Red Horizon HD-model kit: core scene model (Model, Part, points, transforms).

Coordinates are GAME coordinates everywhere in the kit API (the same frame as src/render/models):
    +X = east (screen right), +Y = up, +Z = south (towards the camera). 1 unit = 1 map cell.
    Structures: footprint centred on the origin, ground at y = 0, front (doors, slogans) facing +Z.
    Units: face +X, ground at y = 0.
Rotations are Euler angles in RADIANS with three.js 'XYZ' order (matrix = Rx * Ry * Rz), so positions and
rotations can be copied straight from the procedural TypeScript builders.

Internally every part's mesh data stays in that game frame; the Blender object gets the extra +90 degree X
rotation (game Y-up -> Blender Z-up), so Blender's world is a normal Z-up scene for baking and the exporter
reads the mesh data back unchanged.
"""
import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

# game frame -> Blender world (Y-up -> Z-up): +90 degrees around X
TO_BLENDER = Matrix.Rotation(math.radians(90.0), 4, 'X')

# Material names with a special meaning (non-atlas primitives). See kit.materials.
TRACK = 'track'


def vec(v):
    return Vector((float(v[0]), float(v[1]), float(v[2])))


def euler3(r):
    """three.js 'XYZ' Euler (radians) -> 3x3 matrix (Blender's 'ZYX' order is the same matrix Rx*Ry*Rz)."""
    if r is None:
        return Matrix.Identity(3)
    return Euler((float(r[0]), float(r[1]), float(r[2])), 'ZYX').to_matrix()


def T(at=(0, 0, 0), rot=None, scale=None):
    """4x4 transform in the game frame: translate(at) * rotate(rot) * scale(scale)."""
    m = euler3(rot).to_4x4()
    if scale is not None:
        s = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
        m = m @ Matrix.Diagonal((s[0], s[1], s[2], 1.0))
    m.translation = vec(at)
    return m


def facing_rot(facing):
    """Rotation (radians, three XYZ) that turns a +Z-facing feature to face `facing`.

    facing: '+z' (front / south, default), '-z', '+x', '-x', '+y' (up, e.g. roof decals), '-y',
    or a yaw angle in radians (rotation around +Y).
    """
    if isinstance(facing, (int, float)):
        return (0.0, float(facing), 0.0)
    return {
        '+z': (0.0, 0.0, 0.0),
        '-z': (0.0, math.pi, 0.0),
        '+x': (0.0, math.pi / 2, 0.0),
        '-x': (0.0, -math.pi / 2, 0.0),
        '+y': (-math.pi / 2, 0.0, 0.0),
        '-y': (math.pi / 2, 0.0, 0.0),
    }[facing]


class Part:
    """A node of the exported model: one rigid body part (the root, a turret, a barrel, a door, a dish...).

    Geometry added to a part is in the part's LOCAL frame (relative to its pivot `at`). Animated parts must use
    the procedural node names so the game's animation drives them: 'turret', 'b0'/'b1' (barrels, recoil along
    -X), 'door', 'dish', 'rotor'... (see `node tools/assets/rig.mjs <id>`).
    """

    def __init__(self, model, name, parent=None, at=(0, 0, 0), rot=None, cull=True):
        self.model = model
        self.name = name
        self.cull = cull  # hidden-face culling at the rest pose (False: keep everything, also for children)
        self.parent = parent
        self.at = vec(at)
        self.rot = tuple(rot) if rot is not None else (0.0, 0.0, 0.0)
        self.bm = bmesh.new()          # atlas geometry (baked)
        self.extra = {}                # material name -> bmesh (non-atlas: tracks, glow slots)
        self.mats = []                 # material slots of self.bm
        self.obj = None                # Blender object (created by Model.realize)
        self.extra_objs = {}

    # ---- transforms
    def local(self):
        return T(self.at, self.rot)

    def world(self):
        """Rest transform in model space (game frame)."""
        m = self.local()
        p = self.parent
        while p is not None:
            m = p.local() @ m
            p = p.parent
        return m

    def to_model(self, p):
        return self.world() @ vec(p)

    # ---- geometry plumbing (used by kit.shapes)
    def mat_index(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def target(self, mat):
        """(bmesh, material index) to add geometry with material `mat` to."""
        from . import materials as _m
        if _m.is_atlas(mat):
            return self.bm, self.mat_index(mat)
        name = mat.name
        if name not in self.extra:
            self.extra[name] = bmesh.new()
        return self.extra[name], 0

    def __repr__(self):
        return f'Part({self.name})'


class Point:
    """A named empty: muzzle ('m0'), smoke ('smoke0'), steam vent ('steam0'), sparks... (see Model.point)."""

    def __init__(self, name, part, at, rot=None, kind=None):
        self.name = name
        self.part = part
        self.at = vec(at)
        self.rot = tuple(rot) if rot is not None else (0.0, 0.0, 0.0)
        self.kind = kind

    def local(self):
        return T(self.at, self.rot)

    def world(self):
        return self.part.world() @ self.local()


class Model:
    """One HD model (one GLB). Created by kit.run for a content script's `build(m)`.

    m.root             the root part (static body)
    m.part(name, ...)  an animated sub-part (child of root unless parent= is given)
    m.point(name, ...) muzzles / smoke / steam / spark points
    m.decal(...)       projected decals (see kit.decals)
    m.meta             metadata written to glTF extras + manifest (footprint, height, radius, fx...)
    """

    def __init__(self, id, faction=None, kind='structure', atlas=None, seed=1):
        self.id = id
        self.faction = faction
        self.kind = kind  # 'structure' | 'vehicle' | 'aircraft' | 'naval' | 'infantry' | 'defense'
        self.atlas = atlas or (1024 if kind in ('structure', 'defense', 'naval') else 512)
        self.seed = seed
        self.parts = {}
        self.points = {}
        self.decals = []
        self.meta = {'footprint': None, 'height': None, 'radius': None, 'keep': []}
        self.root = self.part('root', parent=None)
        self.ground = True  # bake AO against a ground plane (contact shadows)
        self.separate_glass = False  # export glass() faces as a second, glossy material (one more draw call)
        self.tuning = {}  # m.tune(...)

    # ---- structure
    def part(self, name, parent='root', at=(0, 0, 0), rot=None, cull=True):
        """cull=False keeps every face of this part (and its children) through hidden-face culling. Parts are
        only ever culled against their own geometry, so moving parts are safe either way."""
        if name in self.parts:
            raise ValueError(f'part {name} exists')
        if isinstance(parent, str):
            parent = self.parts[parent]
        p = Part(self, name, parent, at, rot, cull)
        self.parts[name] = p
        return p

    def point(self, name, at, part=None, rot=None, kind=None):
        """Named empty in `part`'s frame (default root). kind: 'muzzle' | 'smoke' | 'steam' | 'sparks' | None."""
        part = part if isinstance(part, Part) else self.parts[part or 'root']
        self.points[name] = Point(name, part, at, rot, kind)
        return self.points[name]

    def muzzle(self, name, at, part='turret'):
        return self.point(name, at, part, kind='muzzle')

    def smoke(self, name, at, part=None):
        return self.point(name, at, part, kind='smoke')

    def steam(self, name, at, part=None):
        return self.point(name, at, part, kind='steam')

    def sparks(self, name, at, part=None):
        return self.point(name, at, part, kind='sparks')

    def decal(self, img, **kw):
        """Project a decal image (see kit.decals for the generators and options)."""
        from .decals import Decal
        d = Decal(self, img, **kw)
        self.decals.append(d)
        return d

    TUNABLE = ('edge_light', 'edge_radius', 'chamfer_edge', 'ao_distance', 'dirt_h')

    def tune(self, **kw):
        """Per-model bake knobs (instead of overriding kit module globals): edge_light (catch-light on edges,
        default 0.07), edge_radius (bevel-shader edge mask radius, 0.014), chamfer_edge (edge mask of geometric
        chamfers, 0.45), ao_distance (baked AO reach, 0.32), dirt_h (ground dirt height: 0.2 structures, 0.07
        units). Keep them near the defaults: strong edge light / wear reads as a pale halo at RTS zoom."""
        for k in kw:
            if k not in self.TUNABLE:
                raise KeyError(f'tune(): unknown setting {k}; one of {self.TUNABLE}')
        self.tuning.update(kw)

    def set_meta(self, **kw):
        """footprint=(w, h) cells, height=selection/health-bar height, radius=selection radius, keep=[...]
        (procedural extras to keep, e.g. ['glow:charge']), plus anything else (stored in extras)."""
        self.meta.update(kw)

    # ---- Blender scene
    def realize(self):
        """Create one Blender object per part (atlas mesh + extra meshes). Called by kit.run before baking."""
        coll = bpy.context.scene.collection
        for p in self.parts.values():
            p.obj = _bm_to_object(p.bm, f'P_{p.name}', p.mats, p.world(), coll)
            for name, bm in p.extra.items():
                from . import materials as _m
                p.extra_objs[name] = _bm_to_object(bm, f'X_{p.name}_{name}', [_m.by_name(name)], p.world(), coll)
        return [p.obj for p in self.parts.values() if p.obj is not None]

    def atlas_objects(self):
        return [p.obj for p in self.parts.values() if p.obj is not None]

    def tris(self):
        n = 0
        for p in self.parts.values():
            for o in [p.obj, *p.extra_objs.values()]:
                if o is not None:
                    n += sum(len(f.vertices) - 2 for f in o.data.polygons)
        return n


SHARP_ANGLE = math.radians(32.0)


def _bm_to_object(bm, name, mats, world, coll):
    if len(bm.faces) == 0:
        return None
    # triangulate up front: the unwrap, the normal bake and the exported tangents all see the same triangles
    bmesh.ops.triangulate(bm, faces=list(bm.faces), quad_method='BEAUTY', ngon_method='BEAUTY')
    # smooth by angle: smooth faces, sharp edges above SHARP_ANGLE (cylinders smooth, boxes faceted)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if not e.is_manifold:
            e.smooth = e.is_boundary is False
            continue
        e.smooth = e.calc_face_angle(math.pi) < SHARP_ANGLE
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    ob.matrix_world = TO_BLENDER @ world
    coll.objects.link(ob)
    return ob
