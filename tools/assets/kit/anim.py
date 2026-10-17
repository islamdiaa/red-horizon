"""Procedural motion for skinned models: pose builders, IK, key-pose interpolation, clips.

A clip is authored as KEY POSES on bones (kit.anim.Keys: values at key times with easing) plus procedural layers
(gait cycles, breathing, recoil springs), solved per frame with forward kinematics for the spine and two-bone IK for
the limbs (feet planted on the ground, hands on the weapon's grips). There is no motion capture.

    from kit.anim import Clip, HumanBody, Keys, gait
    def pose_idle(t):
        b = HumanBody()
        b.torso((0, 0.19, 0), lean(0.02))
        b.leg('l', (0.0, 0.024, -0.04)); b.leg('r', ...)
        b.arm_ik('r', wrist, hand_rot(...), pole)
        return b.pose()
    CLIPS = [Clip('idle', 2.4, pose_idle, loop=True)]

kit.vat bakes a list of clips into the vertex (bone) animation texture and keys them on a Blender armature.
All positions and rotations are in the GAME frame (kit.rig).
"""
import math

from mathutils import Matrix, Vector

from .rig import (ARM_AXIS_REST, DOG, FOREARM_REST, HUMAN, I3, LEG_AXIS_REST, M4, UPPER_REST, V, basis, clamp,
                  frame_rot, hand_rot, ik2, lean, rx, ry, rz, slerp3, smooth)

TAU = 2 * math.pi


# ---------------------------------------------------------------------------------------------------------
# Key poses


def ease(kind, t):
    t = clamp(t, 0.0, 1.0)
    if kind == 'linear':
        return t
    if kind == 'in':
        return t * t
    if kind == 'out':
        return 1 - (1 - t) * (1 - t)
    if kind == 'step':
        return 0.0 if t < 1 else 1.0
    if kind == 'back':  # overshoot a little (snappy settles)
        s = 1.7
        u = t - 1
        return 1 + u * u * ((s + 1) * u + s)
    return t * t * (3 - 2 * t)  # 'smooth'


def _lerp(a, b, k):
    if isinstance(a, (int, float)):
        return a + (b - a) * k
    if isinstance(a, Matrix):
        return slerp3(a, b, k)
    return type(a)(x + (y - x) * k for x, y in zip(a, b)) if not isinstance(a, Vector) else a.lerp(b, k)


class Keys:
    """Values (numbers, tuples, Vectors or 3x3 rotations) at key times. keys = [(t, value[, ease into it])].
    Loops wrap from the last key to the first over `period` when given."""

    def __init__(self, keys, default='smooth', period=None):
        self.keys = sorted(keys, key=lambda k: k[0])
        self.default = default
        self.period = period

    def __call__(self, t):
        ks = self.keys
        if self.period:
            t = t % self.period
            if t >= ks[-1][0]:
                a, b = ks[-1], ks[0]
                span = self.period - a[0] + b[0]
                k = (t - a[0]) / span if span > 0 else 0
                return _lerp(a[1], b[1], ease(b[2] if len(b) > 2 else self.default, k))
            if t < ks[0][0]:
                a, b = ks[-1], ks[0]
                span = self.period - a[0] + b[0]
                k = (t + self.period - a[0]) / span if span > 0 else 0
                return _lerp(a[1], b[1], ease(b[2] if len(b) > 2 else self.default, k))
        if t <= ks[0][0]:
            return ks[0][1]
        if t >= ks[-1][0]:
            return ks[-1][1]
        for i in range(len(ks) - 1):
            a, b = ks[i], ks[i + 1]
            if a[0] <= t <= b[0]:
                k = (t - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 1.0
                return _lerp(a[1], b[1], ease(b[2] if len(b) > 2 else self.default, k))
        return ks[-1][1]


def spring(t, t0, amp, freq=11.0, damp=7.0):
    """Damped oscillation starting at t0 (impacts, settling): 0 before t0, rises, rings out to 0."""
    if t < t0:
        return 0.0
    u = t - t0
    return amp * math.exp(-damp * u) * math.sin(freq * u)


def kick(t, t0, rise=0.03, decay=0.18):
    """Fast rise to 1 at t0 + rise, exponential-ish smooth return over `decay` (recoil envelopes)."""
    if t < t0:
        return 0.0
    u = t - t0
    if u < rise:
        return smooth(u / rise)
    return max(0.0, 1.0 - smooth((u - rise) / decay))


def noise1(t, seed=0.0, period=None):
    """Smooth pseudo-noise in [-1, 1]: a sum of sines. With `period`, the frequencies are whole cycles per period,
    so a looping clip closes."""
    if period:
        w = TAU / period
        return (math.sin(t * w * 1 + seed * 3.1) * 0.5 + math.sin(t * w * 2 + seed * 1.7 + 1.3) * 0.3 + math.sin(t * w * 3 + seed * 0.7 + 2.1) * 0.2)
    return (math.sin(t * 1.31 + seed * 3.1) * 0.5 + math.sin(t * 2.17 + seed * 1.7 + 1.3) * 0.3 + math.sin(t * 3.73 + seed * 0.7 + 2.1) * 0.2)


# ---------------------------------------------------------------------------------------------------------
# Humanoid pose builder


class HumanBody:
    """Builds one pose of the HUMAN rig (bone name -> world matrix)."""

    def __init__(self):
        self.sk = HUMAN
        self.W = {}
        self.R = {}  # world rotations

    def _place(self, name, parent, rot):
        """Child joint follows its parent's world transform; `rot` = the child's world rotation."""
        sk = self.sk
        off = sk.pos(name) - sk.pos(parent)
        p = self.W[parent].translation + self.R[parent] @ off
        self.R[name] = rot
        self.W[name] = M4(p, rot)
        return p

    def torso(self, hips_pos, hips_rot=I3, spine=I3, chest=I3, neck=I3, head=I3):
        """hips_rot is world; spine / chest / neck / head are local (relative to the parent's world rotation)."""
        self.R['hips'] = hips_rot
        self.W['hips'] = M4(V(hips_pos), hips_rot)
        self._place('spine', 'hips', hips_rot @ spine)
        self._place('chest', 'spine', self.R['spine'] @ chest)
        self._place('neck', 'chest', self.R['chest'] @ neck)
        self._place('head', 'neck', self.R['neck'] @ head)

    def look(self, yaw=0.0, pitch=0.0, roll=0.0, world=None):
        """Re-aim the head (and a little of the neck) in WORLD terms: yaw left +, pitch down +."""
        want = world if world is not None else (ry(yaw) @ lean(pitch) @ rx(roll))
        cur = self.R['neck']
        neck = slerp3(cur, want, 0.4)
        self._place('neck', 'chest', neck)
        self._place('head', 'neck', want)

    def joint(self, name):
        return self.W[name].translation.copy()

    def shoulder(self, side):
        sk = self.sk
        n = 'upperarm_' + side
        return self.W['chest'].translation + self.R['chest'] @ (sk.pos(n) - sk.pos('chest'))

    def hip(self, side):
        sk = self.sk
        n = 'thigh_' + side
        return self.W['hips'].translation + self.R['hips'] @ (sk.pos(n) - sk.pos('hips'))

    # ---- legs
    def leg(self, side, ankle, foot_rot=None, pole=None):
        """Two-bone IK from the hip to the ankle; the knee bends towards `pole` (default: the hips' forward)."""
        sk = self.sk
        hip = self.hip(side)
        l1 = sk.length('thigh_' + side, 'shin_' + side)
        l2 = sk.length('shin_' + side, 'foot_' + side)
        fwd = self.R['hips'] @ Vector((1, 0, 0))
        if pole is None:
            pole = fwd + Vector((0, 0, 0.15 if side == 'r' else -0.15))
        knee, ank = ik2(hip, l1, l2, V(ankle), V(pole))
        self._leg_rot(side, hip, knee, ank, V(pole))
        fr = foot_rot if foot_rot is not None else self.R['hips']
        self.R['foot_' + side] = fr
        self.W['foot_' + side] = M4(ank, fr)

    def _leg_rot(self, side, hip, knee, ank, pole):
        sk = self.sk
        rest_t = (sk.pos('shin_' + side) - sk.pos('thigh_' + side)).normalized()
        rest_s = (sk.pos('foot_' + side) - sk.pos('shin_' + side)).normalized()
        dt = (knee - hip).normalized()
        ds = (ank - knee).normalized()
        line = (ank - hip)
        ln = line.normalized() if line.length > 1e-6 else Vector((0, -1, 0))
        b = (knee - hip) - ln * (knee - hip).dot(ln)
        if b.length < 1e-5:
            b = pole - ln * pole.dot(ln)
        ax = dt.cross(b.normalized())
        if ax.length < 1e-6:
            ax = LEG_AXIS_REST.copy()
        ax.normalize()
        rt = frame_rot(rest_t, LEG_AXIS_REST, dt, ax)
        rs = frame_rot(rest_s, LEG_AXIS_REST, ds, ax)
        self.R['thigh_' + side] = rt
        self.W['thigh_' + side] = M4(hip, rt)
        self.R['shin_' + side] = rs
        self.W['shin_' + side] = M4(knee, rs)

    # ---- arms
    def arm_ik(self, side, wrist, hand, pole):
        """Two-bone IK from the shoulder to the wrist; `hand` = the hand's world rotation (kit.rig.hand_rot or
        self.hand_like(...)); the elbow bends towards `pole` (a direction)."""
        sk = self.sk
        sh = self.shoulder(side)
        l1 = sk.length('upperarm_' + side, 'forearm_' + side)
        l2 = sk.length('forearm_' + side, 'hand_' + side)
        el, wr = ik2(sh, l1, l2, V(wrist), V(pole))
        self._arm_rot(side, sh, el, wr, V(pole), hand)
        return (wr - V(wrist)).length  # reach error

    def arm_fk(self, side, upper_dir, bend, hand=None, toward=None):
        """Arm by directions: the upper arm along `upper_dir` (world), the elbow bent by `bend` radians with the
        forearm swinging towards `toward` (default: the chest's forward). hand=None: the hand continues the forearm."""
        sk = self.sk
        sh = self.shoulder(side)
        l1 = sk.length('upperarm_' + side, 'forearm_' + side)
        l2 = sk.length('forearm_' + side, 'hand_' + side)
        du = V(upper_dir).normalized()
        hint = V(toward) if toward is not None else self.R['chest'] @ Vector((1, 0, 0))
        hp = hint - du * hint.dot(du)
        if hp.length < 1e-5:
            hp = (self.R['chest'] @ Vector((1, 0, 0))) - du * du.x
        hp.normalize()
        df = (du * math.cos(bend) + hp * math.sin(bend)).normalized()
        el = sh + du * l1
        wr = el + df * l2
        self._arm_rot(side, sh, el, wr, -hp, hand)
        return wr

    def _arm_rot(self, side, sh, el, wr, pole, hand):
        du = (el - sh).normalized()
        df = (wr - el).normalized()
        line = wr - sh
        ln = line.normalized() if line.length > 1e-6 else du
        b = (el - sh) - ln * (el - sh).dot(ln)
        if b.length < 1e-5:
            b = pole - ln * pole.dot(ln)
        ax = du.cross(b.normalized())
        if ax.length < 1e-6:
            ax = ARM_AXIS_REST[side].copy()
        ax.normalize()
        ru = frame_rot(UPPER_REST[side], ARM_AXIS_REST[side], du, ax)
        rf = frame_rot(FOREARM_REST[side], ARM_AXIS_REST[side], df, ax)
        self.R['upperarm_' + side] = ru
        self.W['upperarm_' + side] = M4(sh, ru)
        self.R['forearm_' + side] = rf
        self.W['forearm_' + side] = M4(el, rf)
        rh = hand if hand is not None else rf
        self.R['hand_' + side] = rh
        self.W['hand_' + side] = M4(wr, rh)

    def hand_like(self, side, fingers, palm):
        return hand_rot(side, V(fingers).normalized(), V(palm).normalized())

    # ---- props
    def weapon(self, m4=None, scale=1.0):
        """The weapon bone's world matrix (None: rides on the right hand, hidden with scale 0)."""
        self._prop('weapon', 'hand_r', m4, scale)

    def prop(self, m4=None, scale=1.0):
        self._prop('prop', 'hand_l', m4, scale)

    def _prop(self, name, hand, m4, scale):
        if m4 is None:
            # follow the hand at the rest offset (bind: prop floats in front; the offset is irrelevant when hidden)
            m4 = M4(self.W[hand].translation, self.R[hand])
        if scale != 1.0:
            m4 = m4 @ Matrix.Diagonal((scale, scale, scale, 1.0))
        self.W[name] = m4
        self.R[name] = m4.to_3x3().normalized()

    def pose(self):
        for n in self.sk.names:
            if n not in self.W:
                raise KeyError(f'pose: bone {n} not set')
        return dict(self.W)


def grip_world(weapon_m4, local_wrist, local_fingers, local_palm):
    """A grip defined in the weapon's frame -> (wrist world position, fingers world dir, palm world dir)."""
    r = weapon_m4.to_3x3().normalized()
    return weapon_m4 @ V(local_wrist), r @ V(local_fingers), r @ V(local_palm)


# ---------------------------------------------------------------------------------------------------------
# Gait (biped): foot targets, hips motion, arm swing for a cycle phase ph in [0, 1); left heel strike at 0,
# right at 0.5. Units: model units, at the rig's scale.


class Gait:
    def __init__(self, step, period, stance, lift, bob, sway, lean_, yaw, roll, width=0.036, toe=0.45, heel=0.25,
                 knee_lift=0.0, run=False):
        self.step = step          # stride / 2 (distance the body travels per step)
        self.period = period      # seconds per cycle (two steps)
        self.stance = stance      # fraction of the cycle a foot is on the ground
        self.lift = lift          # swing foot lift
        self.bob = bob            # hips vertical bob
        self.sway = sway          # hips lateral sway
        self.lean = lean_         # forward lean of the trunk
        self.yaw = yaw            # pelvis yaw amplitude
        self.roll = roll          # pelvis roll (hip drop)
        self.width = width        # foot z offset
        self.toe = toe            # toe-off heel raise (rad)
        self.heel = heel          # heel strike toes-up (rad)
        self.knee_lift = knee_lift
        self.run = run

    @property
    def stride(self):
        return 2 * self.step

    @property
    def speed(self):
        return self.stride / self.period

    def foot(self, side, ph):
        """(x, y, pitch) of the ankle target relative to the hips' ground point. pitch: + = toes up."""
        p = (ph + (0.5 if side == 'r' else 0.0)) % 1.0
        st = self.stance
        travel = self.speed * st * self.period  # how far the ground moves under a planted foot
        if p < st:
            k = p / st
            x = travel * (0.5 - k)
            y = 0.0
            # heel strike -> flat -> heel raise
            pitch = self.heel * (1 - smooth(k / 0.18)) if k < 0.18 else -self.toe * smooth((k - 0.7) / 0.3) if k > 0.7 else 0.0
        else:
            k = (p - st) / (1 - st)
            x = travel * (-0.5 + smooth(k))
            y = self.lift * math.sin(math.pi * min(1.0, k * 1.08)) ** 0.9
            if self.run:
                # the trailing foot kicks up behind, then reaches forward
                x -= 0.35 * travel * math.sin(math.pi * k) * (1 - k)
                y += self.knee_lift * math.sin(math.pi * k) ** 2
            pitch = -self.toe * (1 - smooth(k / 0.3)) + self.heel * smooth((k - 0.75) / 0.25)
        return x, y, pitch

    def hips(self, ph):
        """(dy, dz, yaw, roll) of the pelvis."""
        if self.run:
            dy = -self.bob * math.cos(TAU * 2 * (ph - self.stance / 2))
        else:
            dy = -self.bob * math.cos(TAU * 2 * ph)
        dz = -self.sway * math.sin(TAU * ph + 0.4)
        yaw = -self.yaw * math.cos(TAU * ph)
        roll = self.roll * math.sin(TAU * ph)
        return dy, dz, yaw, roll


WALK = Gait(step=0.068, period=1.0, stance=0.6, lift=0.022, bob=0.004, sway=0.006, lean_=0.04, yaw=0.12, roll=0.05)
RUN = Gait(step=0.15, period=0.62, stance=0.38, lift=0.03, bob=0.007, sway=0.004, lean_=0.17, yaw=0.16, roll=0.06,
           width=0.028, toe=0.7, heel=0.15, knee_lift=0.035, run=True)


def legs_for_gait(b, g, ph, base_y, foot_yaw=None):
    """Plant the feet of HumanBody b for gait g at phase ph. base_y: ankle height on flat ground."""
    hr = b.R['hips']
    yaw_only = foot_yaw if foot_yaw is not None else I3
    for side in ('l', 'r'):
        x, y, pitch = g.foot(side, ph)
        z = g.width * (1 if side == 'r' else -1)
        ank = Vector((x, base_y + y, z))
        b.leg(side, ank, yaw_only @ rz(pitch))
    return hr


# ---------------------------------------------------------------------------------------------------------
# Clips


class Clip:
    """name, duration (s), pose function f(t) -> {bone: world matrix}, loop (the last frame repeats the first so
    the texture interpolates across the wrap), fps (VAT sampling rate), meta (stride, events...)."""

    def __init__(self, name, duration, fn, loop=False, fps=20, **meta):
        self.name = name
        self.duration = float(duration)
        self.fn = fn
        self.loop = loop
        self.fps = fps
        self.meta = meta

    def frames(self):
        """Number of texture rows: duration * fps (+1 closing row)."""
        n = max(1, int(round(self.duration * self.fps)))
        return n + 1

    def times(self):
        n = self.frames() - 1
        return [self.duration * i / n for i in range(n + 1)]


__all__ = ['Clip', 'Gait', 'HumanBody', 'Keys', 'RUN', 'WALK', 'DOG', 'HUMAN', 'TAU', 'ease', 'grip_world', 'kick',
           'legs_for_gait', 'noise1', 'spring', 'M4', 'V', 'I3', 'lean', 'rx', 'ry', 'rz', 'hand_rot', 'basis',
           'frame_rot', 'ik2', 'slerp3', 'smooth', 'clamp']
