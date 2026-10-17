"""Skeletons and poses for skinned models (infantry, dogs): the shared rigs, forward / inverse kinematics.

Everything is in the GAME frame (see kit.core): +X forward (units face +X), +Y up, +Z = the soldier's RIGHT side.
1 unit = 1 map cell (the game draws infantry at 1.3x, render/scale.ts).

A Skeleton is a list of bones (name, parent, rest joint position). The bind (rest) orientation of every bone is the
identity: a bone's world matrix in a pose is T(joint position) @ R, where R rotates the bone's rest geometry into the
pose. The skinning matrix of a bone is then  S = W @ inverse(T(rest position)) , exactly what the vertex animation
texture stores (kit.vat) and what the game multiplies the bind-pose vertices with (src/render/models/infantry-hd*).

Rotation helpers in game axes (radians):
    rx(a)  roll: +a tips the top towards +Z (the right side)
    ry(a)  yaw:  +a turns +X (forward) towards -Z (to the LEFT)
    rz(a)  pitch: +a tips the top BACKWARDS (towards -X) and swings a hanging limb FORWARDS
    lean(a) = rz(-a): +a leans the top forwards
"""
import math

from mathutils import Matrix, Quaternion, Vector


def V(x, y=None, z=None):
    if y is None:
        return Vector((float(x[0]), float(x[1]), float(x[2])))
    return Vector((float(x), float(y), float(z)))


def rx(a):
    return Matrix.Rotation(a, 3, 'X')


def ry(a):
    return Matrix.Rotation(a, 3, 'Y')


def rz(a):
    return Matrix.Rotation(a, 3, 'Z')


def lean(a):
    return rz(-a)


I3 = Matrix.Identity(3)


def M4(pos, rot=None, scale=1.0):
    """4x4 world matrix from a position and a 3x3 rotation (optionally uniformly scaled: hidden props use 0)."""
    m = (rot if rot is not None else I3).copy()
    if scale != 1.0:
        m = m @ Matrix.Diagonal((scale, scale, scale))
    m = m.to_4x4()
    m.translation = V(pos)
    return m


def basis(d, side):
    """Orthonormal frame (columns d, s, d x s) from a direction and a side hint (made perpendicular to d)."""
    d = d.normalized()
    s = side - d * side.dot(d)
    if s.length < 1e-6:
        s = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        s = s - d * s.dot(d)
    s.normalize()
    t = d.cross(s)
    return Matrix((d, s, t)).transposed()


def frame_rot(rest_d, rest_s, d, s):
    """Rotation turning the frame (rest_d, rest_s) into (d, s)."""
    return basis(d, s) @ basis(rest_d, rest_s).transposed()


def slerp3(a, b, t):
    """Spherical interpolation of two 3x3 rotations."""
    qa = a.to_quaternion()
    qb = b.to_quaternion()
    return qa.slerp(qb, t).to_matrix()


def clamp(x, a, b):
    return a if x < a else b if x > b else x


def smooth(t):
    t = clamp(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def ik2(a, l1, l2, target, pole):
    """Two-bone IK: from joint `a` with segment lengths l1, l2 towards `target`, bending towards `pole` (a direction).
    Returns (mid joint, end joint). The end stops short of the target when it is out of reach."""
    d = target - a
    dist = d.length
    if dist < 1e-6:
        d = Vector((0, -1, 0))
        dist = 1e-6
    dirn = d.normalized()
    dist = clamp(dist, abs(l1 - l2) + 1e-5, l1 + l2 - 1e-5)
    cos_a = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1.0, 1.0)
    sin_a = math.sqrt(max(0.0, 1 - cos_a * cos_a))
    pn = pole - dirn * pole.dot(dirn)
    if pn.length < 1e-6:
        pn = Vector((1, 0, 0)) - dirn * dirn.x
    pn.normalize()
    mid = a + dirn * (l1 * cos_a) + pn * (l1 * sin_a)
    end = a + dirn * dist
    return mid, end


class Skeleton:
    """bones: [(name, parent or None, rest joint position (game frame))], parents before children."""

    def __init__(self, name, bones, meta=None):
        self.name = name
        self.names = [b[0] for b in bones]
        self.index = {n: i for i, n in enumerate(self.names)}
        self.parent = [self.index[b[1]] if b[1] else -1 for b in bones]
        self.rest_pos = [V(b[2]) for b in bones]
        self.meta = dict(meta or {})
        self.free = {'weapon', 'prop'}  # props are placed freely (grips, drops), not at a fixed offset from the hand
        for i, p in enumerate(self.parent):
            if p >= i:
                raise ValueError(f'{name}: bone {self.names[i]} listed before its parent')

    def __len__(self):
        return len(self.names)

    def pos(self, name):
        return self.rest_pos[self.index[name]].copy()

    def rest(self, name):
        return M4(self.pos(name))

    def length(self, a, b):
        return (self.pos(b) - self.pos(a)).length

    def rest_pose(self):
        return {n: self.rest(n) for n in self.names}

    def skin(self, pose):
        """Pose (bone name -> world matrix) -> list of skinning matrices in bone order."""
        out = []
        for i, n in enumerate(self.names):
            out.append(pose[n] @ Matrix.Translation(-self.rest_pos[i]))
        return out

    def check(self, pose, tol=2e-3):
        """Bone lengths of a pose against the rest pose (joint i relative to its parent joint): the worst error."""
        worst = 0.0
        for i, n in enumerate(self.names):
            p = self.parent[i]
            if p < 0 or n in self.free:
                continue
            want = (self.rest_pos[i] - self.rest_pos[p]).length
            got = (pose[n].translation - pose[self.names[p]].translation).length
            worst = max(worst, abs(got - want))
        return worst


# ---------------------------------------------------------------------------------------------------------
# The shared humanoid rig (every soldier type; see tools/assets/models/infantry/_clips.py for its clips).
# Slightly heroic proportions for the RTS camera: ~6.9 heads tall, broad shoulders, big hands and boots.

SH_Y, SH_Z = 0.300, 0.058  # shoulder joints


def _arm(side):
    s = 1.0 if side == 'r' else -1.0
    sh = Vector((0.0, SH_Y, SH_Z * s))
    du = Vector((0.10, -0.83, 0.55 * s)).normalized()       # A-pose: down, out, a little forward
    el = sh + du * 0.070
    df = Vector((0.30, -0.80, 0.50 * s)).normalized()        # elbow slightly bent
    wr = el + df * 0.062
    return sh, el, wr


_SH_L, _EL_L, _WR_L = _arm('l')
_SH_R, _EL_R, _WR_R = _arm('r')

HUMAN = Skeleton('human', [
    ('hips', None, (0.0, 0.192, 0.0)),
    ('spine', 'hips', (-0.002, 0.222, 0.0)),
    ('chest', 'spine', (-0.004, 0.262, 0.0)),
    ('neck', 'chest', (0.0, 0.316, 0.0)),
    ('head', 'neck', (0.004, 0.333, 0.0)),
    ('upperarm_l', 'chest', tuple(_SH_L)),
    ('forearm_l', 'upperarm_l', tuple(_EL_L)),
    ('hand_l', 'forearm_l', tuple(_WR_L)),
    ('upperarm_r', 'chest', tuple(_SH_R)),
    ('forearm_r', 'upperarm_r', tuple(_EL_R)),
    ('hand_r', 'forearm_r', tuple(_WR_R)),
    ('thigh_l', 'hips', (0.0, 0.186, -0.033)),
    ('shin_l', 'thigh_l', (0.004, 0.104, -0.035)),
    ('foot_l', 'shin_l', (-0.002, 0.024, -0.036)),
    ('thigh_r', 'hips', (0.0, 0.186, 0.033)),
    ('shin_r', 'thigh_r', (0.004, 0.104, 0.035)),
    ('foot_r', 'shin_r', (-0.002, 0.024, 0.036)),
    # props: the weapon (right hand: rifles, launchers, pistols, grenades) and a left-hand prop (kits, toolboxes,
    # the second pistol). Their bind positions float in front of the body so their AO bakes clean.
    ('weapon', 'hand_r', (0.20, 0.20, 0.12)),
    ('prop', 'hand_l', (0.20, 0.20, -0.12)),
], meta={'height': 0.385, 'eye': 0.352})

# rest hinge axes (knees and elbows bend around these) and the rest hand frame
LEG_AXIS_REST = Vector((0, 0, 1))


def _arm_axis(side):
    sh, el, wr = (_SH_R, _EL_R, _WR_R) if side == 'r' else (_SH_L, _EL_L, _WR_L)
    du = (el - sh).normalized()
    bend = el - (sh + du * 0)  # unused
    line = (wr - sh).normalized()
    b = el - sh
    b = b - line * b.dot(line)  # elbow offset from the shoulder-wrist line (points back/out)
    return du.cross(b.normalized()).normalized()


ARM_AXIS_REST = {'l': _arm_axis('l'), 'r': _arm_axis('r')}
FOREARM_REST = {'l': (_WR_L - _EL_L).normalized(), 'r': (_WR_R - _EL_R).normalized()}
UPPER_REST = {'l': (_EL_L - _SH_L).normalized(), 'r': (_EL_R - _SH_R).normalized()}
# rest hand: fingers continue the forearm, palm faces the thigh (medial), thumb forwards
PALM_REST = {'l': Vector((0, 0, 1)), 'r': Vector((0, 0, -1))}


def hand_rot(side, fingers, palm):
    """World rotation of a hand whose fingers point along `fingers` with the palm facing `palm`."""
    f0 = FOREARM_REST[side]
    return frame_rot(f0, PALM_REST[side], fingers, palm)


# ---------------------------------------------------------------------------------------------------------
# Dog rig (attack dog): pelvis / spine / chest / neck / head / jaw / tail, four legs (upper, lower, paw).

DOG = Skeleton('dog', [
    ('hips', None, (-0.075, 0.122, 0.0)),
    ('spine', 'hips', (-0.02, 0.128, 0.0)),
    ('chest', 'spine', (0.045, 0.130, 0.0)),
    ('neck', 'chest', (0.085, 0.142, 0.0)),
    ('head', 'neck', (0.118, 0.178, 0.0)),
    ('jaw', 'head', (0.128, 0.170, 0.0)),
    ('tail', 'hips', (-0.105, 0.135, 0.0)),
    ('tail2', 'tail', (-0.145, 0.150, 0.0)),
    ('fleg_l', 'chest', (0.062, 0.112, -0.026)),
    ('fshin_l', 'fleg_l', (0.058, 0.062, -0.026)),
    ('fpaw_l', 'fshin_l', (0.062, 0.012, -0.026)),
    ('fleg_r', 'chest', (0.062, 0.112, 0.026)),
    ('fshin_r', 'fleg_r', (0.058, 0.062, 0.026)),
    ('fpaw_r', 'fshin_r', (0.062, 0.012, 0.026)),
    ('hleg_l', 'hips', (-0.082, 0.112, -0.026)),
    ('hshin_l', 'hleg_l', (-0.062, 0.066, -0.026)),
    ('hpaw_l', 'hshin_l', (-0.085, 0.014, -0.026)),
    ('hleg_r', 'hips', (-0.082, 0.112, 0.026)),
    ('hshin_r', 'hleg_r', (-0.062, 0.066, 0.026)),
    ('hpaw_r', 'hshin_r', (-0.085, 0.014, 0.026)),
], meta={'height': 0.2})

RIGS = {'human': HUMAN, 'dog': DOG}


def quat_of(m3):
    q = m3.to_quaternion()
    return q if q.w >= 0 else Quaternion((-q.w, -q.x, -q.y, -q.z))
