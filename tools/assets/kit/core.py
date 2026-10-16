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
from mathutils import Euler, Matrix, Vector  # noqa: F401

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
    a yaw angle in radians (rotation around +Y), or any (rx, ry, rz) Euler (e.g. normal_rot(...) for a
    sloped roof or a raked armour plate). Every kit helper with a `facing=` argument accepts all of these.
    """
    if isinstance(facing, (int, float)):
        return (0.0, float(facing), 0.0)
    if isinstance(facing, (tuple, list)) or hasattr(facing, 'to_matrix'):
        return (float(facing[0]), float(facing[1]), float(facing[2]))
    return {
        '+z': (0.0, 0.0, 0.0),
        '-z': (0.0, math.pi, 0.0),
        '+x': (0.0, math.pi / 2, 0.0),
        '-x': (0.0, -math.pi / 2, 0.0),
        '+y': (-math.pi / 2, 0.0, 0.0),
        '-y': (math.pi / 2, 0.0, 0.0),
    }[facing]


def normal_rot(normal, up=None):
    """Euler (three XYZ, radians) that turns a +Z-facing feature (decal, sign, panel, quad) to face `normal`,
    keeping its top towards `up` (default +Y; for normals near +-Y the top points north (-Z) when facing up
    and south (+Z) when facing down, as facing='+y' / '-y'). Use as facing=normal_rot((0, 0.6, 0.8)) or
    m.decal(..., normal=(0, 0.6, 0.8))."""
    z = vec(normal)
    if z.length < 1e-9:
        raise ValueError('normal_rot(): zero normal')
    z.normalize()
    if up is None:
        up = (0.0, 1.0, 0.0) if abs(z.y) < 0.999 else (0.0, 0.0, -1.0 if z.y > 0 else 1.0)
    u = vec(up)
    x = u.cross(z)
    if x.length < 1e-6:
        raise ValueError(f'normal_rot(): up {tuple(up)} is parallel to the normal {tuple(normal)}')
    x.normalize()
    y = z.cross(x)
    M = Matrix((x, y, z)).transposed()  # columns = local x, y, z in the parent frame
    return tuple(M.to_euler('ZYX')[:])


class Part:
    """A node of the exported model: one rigid body part (the root, a turret, a barrel, a door, a dish...).

    Geometry added to a part is in the part's LOCAL frame (relative to its pivot `at`). Animated parts must use
    the procedural node names so the game's animation drives them: 'turret', 'b0'/'b1' (barrels, recoil along
    -X), 'door', 'dish', 'rotor'... (see `node tools/assets/rig.mjs <id>`).
    """

    def __init__(self, model, name, parent=None, at=(0, 0, 0), rot=None, cull=True, ground=None):
        self.model = model
        self.name = name
        self.cull = cull  # hidden-face culling at the rest pose (False: keep everything, also for children)
        self.ground = ground  # AO against the ground plane: None = as the parent (root: True), False = without
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

    def grounded(self):
        """True when the AO bake of this part sees the ground plane (Model.ground and no ground=False up the chain)."""
        q = self
        while q is not None:
            if q.ground is not None:
                return bool(q.ground) and self.model.ground
            q = q.parent
        return self.model.ground

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
    def part(self, name, parent='root', at=(0, 0, 0), rot=None, cull=True, ground=None):
        """cull=False keeps every face of this part (and its children) through hidden-face culling. Parts are
        only ever culled against their own geometry, so moving parts are safe either way.
        ground=False bakes this part's AO (and its children's, unless they say ground=True) without the ground
        plane: parts that rest below y = 0 (a silo missile, a lowered lift) would be blacked out by it, while
        the rest of the model keeps its contact shadows. (m.ground = False drops the plane for everything.)"""
        if name in self.parts:
            raise ValueError(f'part {name} exists')
        if isinstance(parent, str):
            parent = self.parts[parent]
        p = Part(self, name, parent, at, rot, cull, ground)
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

    TUNABLE = ('edge_light', 'edge_radius', 'chamfer_edge', 'ao_distance', 'dirt_h', 'ao')

    def look(self, **kw):
        """Per-model look knobs (instead of overriding kit module globals; call it anywhere in build(m)):
            edge_light    catch-light on edges (default 0.07)
            edge_radius   bevel-shader edge mask radius (0.014)
            chamfer_edge  edge mask of geometric chamfers (0.45)
            ao_distance   baked AO reach in units (0.32; ~0.42 for deeper crevices on 2x2 / 3x3 structures)
            dirt_h        ground dirt height (0.2 structures, 0.07 units)
            ao            how much baked AO darkens the albedo, for every material that does not set its own
                          with set_weather(mat, ao=...) (0.55; glass and lamps keep theirs)
        Keep them near the defaults: strong edge light / wear reads as a pale halo at RTS zoom."""
        for k in kw:
            if k not in self.TUNABLE:
                raise KeyError(f'look(): unknown setting {k}; one of {self.TUNABLE}')
        self.tuning.update(kw)

    tune = look  # the original name (same knobs)

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
                mat = _m.by_name(name)
                if mat.get('rh_double'):
                    _double_side(bm)
                p.extra_objs[name] = _bm_to_object(bm, f'X_{p.name}_{name}', [mat], p.world(), coll)
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


def _double_side(bm):
    """Append a reversed copy of every face (double-sided glow and fx meshes; the game draws them one-sided)."""
    faces = list(bm.faces)
    ret = bmesh.ops.duplicate(bm, geom=faces + list({e for f in faces for e in f.edges}) + list({v for f in faces for v in f.verts}))
    dup = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMFace)]
    bmesh.ops.reverse_faces(bm, faces=dup)
    # nudge the copies a hair along their (now flipped) normals so the two sides don't z-fight
    for f in dup:
        f.normal_update()
    for v in {v for f in dup for v in f.verts}:
        n = sum((f.normal for f in v.link_faces if f in dup), Vector())
        if n.length > 0:
            v.co += n.normalized() * 1e-4


def _bm_to_object(bm, name, mats, world, coll):
    if len(bm.faces) == 0:
        return None
    # triangulate up front: the unwrap, the normal bake and the exported tangents all see the same triangles
    bmesh.ops.triangulate(bm, faces=list(bm.faces), quad_method='BEAUTY', ngon_method='BEAUTY')
    # smooth by angle: smooth faces, sharp edges above SHARP_ANGLE (cylinders smooth, boxes faceted)
    for f in bm.faces:
        f.smooth = True
    sm = bm.faces.layers.float.get('rh_smooth')  # faces that stay smooth across any angle (low-poly tori)
    for e in bm.edges:
        if not e.is_manifold:
            e.smooth = e.is_boundary is False
            continue
        if sm is not None and all(f[sm] > 0.5 for f in e.link_faces):
            e.smooth = True
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
