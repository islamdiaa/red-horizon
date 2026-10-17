"""Shared soldier builder for the HD infantry (imported by the model scripts in this directory).

    from _soldier import *
    def build(m):
        s = Soldier(m, 'soviet')
        s.body(coat=True)
        s.helmet('ssh40')
        s.soviet_kit()
        s.rifle('ak')
        s.finish(set='rifle')

Everything is skinned to the shared humanoid rig (kit.rig.HUMAN) in its A-pose bind: smooth tubes for the limbs and
torso (two-bone weights across the joints), rigid gear on single bones, the weapon on the 'weapon' bone (modelled
in its own frame, see _gear.py) and hand-held items on 'weapon' / 'prop'. Team colour: the outer torso garment and
the helmet (team mask), everything else faction colours.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Matrix, Vector  # noqa: E402

from kit import *  # noqa: E402,F401,F403
from kit import decals as D  # noqa: E402
from kit import materials as Mt  # noqa: E402
from kit.rig import FOREARM_REST, HUMAN, PALM_REST, basis  # noqa: E402
from kit.skin import Skin, mix, ring  # noqa: E402
from _gear import FLAMER, LAUNCHER, PISTOL, RIFLE  # noqa: E402

SK = HUMAN
P = SK.pos
W_BIND = P('weapon')
PROP_BIND = P('prop')
HEAD_C = Vector((0.004, 0.354, 0.0))

# palette (sRGB)
SKIN = 0xc79c7e
SOV_TROUSERS = 0x5b5741
SOV_COAT = 0x6a6450
ALLY_TROUSERS = 0x4a4f38
WEB_SOV = 0x6b6045
WEB_ALLY = 0x5c5a42
BOOT = 0x2a231d
GLOVE = 0x2d2824
GUN = 0x24262a
WOOD = 0x7a4a28


def euler_of(m3):
    """3x3 rotation -> the kit's (three.js XYZ) Euler."""
    return tuple(m3.to_euler('ZYX')[:])


def along(a, b, k):
    return a + (b - a) * k


def skin_mat():
    m = flat(SKIN, rough=0.62)
    set_weather(m, wear=0.0, grime=0.12, streaks=0.0, ao=0.4)
    return m


def fabric(color, team=False, grime=0.3):
    m = cloth(color, team=team, grime=grime)
    set_weather(m, streaks=0.05, wear=0.02)
    return m


def leather(color=BOOT, rough=0.55):
    m = painted(color, wear=0.25, grime=0.55, rust=0.0, streaks=0.1, rough=rough, metal=0.0, rivets=False, var=0.05, bevel=0.004)
    return m


def gunmetal(color=GUN):
    return metal(color, rough=0.45, metal=0.75, wear=0.45, grime=0.4, rust=0.05, streaks=0.05, bevel=0.003)


def wood(color=WOOD):
    m = painted(color, wear=0.3, grime=0.35, rust=0.0, streaks=0.05, rough=0.5, metal=0.0, rivets=False, var=0.2, bevel=0.003)
    return m


def helmet_paint():
    return team(wear=0.35, grime=0.35, rust=0.05, rivets=False, rough=0.62)


class Soldier:
    def __init__(self, m, faction, build=1.0):
        self.m = m
        self.faction = faction
        self.sk = Skin(m, SK)
        self.p = self.sk.part
        self.build = build  # torso / limb bulk
        self.points = {}
        m.look(edge_light=0.03, dirt_h=0.06, ao_distance=0.06, ao=0.62)
        m.ground = True

    # ------------------------------------------------------------------------------------------------- body
    def body(self, jacket=None, trousers=None, boots=None, gloves=True, coat=False, sleeves=None, bare_arms=False,
             jacket_len=0.0, coat_len=0.105, collar=True, coat_mat=None):
        """Torso, legs (trousers + boots), arms (sleeves + gloves / hands), neck and head."""
        sk = self.sk
        fac = self.faction
        k = self.build
        self.jacket = jacket or fabric(0xb4b4b4, team=True)
        self.trousers = trousers or fabric(SOV_TROUSERS if fac == 'soviet' else ALLY_TROUSERS)
        self.boots = boots or leather()
        self.skin = skin_mat()
        self.glove = leather(GLOVE, 0.7) if gloves else self.skin
        sleeve = self.skin if bare_arms else (sleeves or self.jacket)
        # ---- legs
        for s in (-1, 1):
            side = 'r' if s > 0 else 'l'
            H, K, A = P('thigh_' + side), P('shin_' + side), P('foot_' + side)
            th, sh, ft = 'thigh_' + side, 'shin_' + side, 'foot_' + side
            rings = [
                ring(H + Vector((0.0, 0.016, -0.004 * s)), 0.029 * k, 0.034 * k, mix(('hips', 0.65), (th, 0.35))),
                ring(along(H, K, 0.1), 0.029 * k, 0.032 * k, mix(('hips', 0.25), (th, 0.75))),
                ring(along(H, K, 0.4), 0.026 * k, 0.028 * k, {th: 1}),
                ring(along(H, K, 0.75), 0.021 * k, 0.022 * k, {th: 1}),
                ring(along(H, K, 0.92), 0.0195 * k, 0.021 * k, mix((th, 0.8), (sh, 0.2)), front_bias=0.06),
                ring(K, 0.0195 * k, 0.022 * k, mix((th, 0.5), (sh, 0.5)), front_bias=0.12),
                ring(along(K, A, 0.14), 0.0185 * k, 0.020 * k, mix((sh, 0.85), (th, 0.15))),
                ring(along(K, A, 0.38), 0.019 * k, 0.020 * k, {sh: 1}, front_bias=-0.12),
                ring(along(K, A, 0.56), 0.019 * k, 0.020 * k, {sh: 1}),
                ring(along(K, A, 0.63), 0.016 * k, 0.017 * k, {sh: 1}),
            ]
            sk.tube(self.trousers, rings, seg=8, cap1=True)
            # boot: shaft + foot
            brings = [
                ring(along(K, A, 0.56), 0.0172 * k, 0.0185 * k, {sh: 1}),
                ring(along(K, A, 0.86), 0.0158 * k, 0.0172 * k, {sh: 1}),
                ring(A + Vector((0.0, 0.004, 0.0)), 0.0158 * k, 0.019 * k, mix((sh, 0.45), (ft, 0.55))),
            ]
            sk.tube(self.boots, brings, seg=8)
            x0 = A.x
            sole = [(-0.02, -0.0005), (-0.016, 0.011), (0.0, 0.0135), (0.03, 0.0135), (0.05, 0.010), (0.056, 0.0),
                    (0.05, -0.010), (0.03, -0.0135), (0.0, -0.0135), (-0.016, -0.011)]
            top = [(-0.018, 0.0), (-0.014, 0.010), (0.0, 0.012), (0.024, 0.011), (0.040, 0.007), (0.044, 0.0),
                   (0.040, -0.007), (0.024, -0.011), (0.0, -0.012), (-0.014, -0.010)]
            instep = [(-0.016, 0.0), (-0.012, 0.010), (0.0, 0.0125), (0.012, 0.010), (0.018, 0.006), (0.02, 0.0),
                      (0.018, -0.006), (0.012, -0.010), (0.0, -0.0125), (-0.012, -0.010)]
            z0 = A.z
            res = loft(self.p, self.boots, [
                (0.0, [(x0 + x, z0 + z) for x, z in sole]),
                (0.007, [(x0 + x, z0 + z) for x, z in sole]),
                (0.016, [(x0 + x, z0 + z) for x, z in top]),
                (0.028, [(x0 + x, z0 + z) for x, z in instep]),
            ])
            sk.rigid(res, ft)
        # ---- torso
        bk = k
        tr = [
            ring((-0.002, 0.168, 0.0), 0.046 * bk, 0.033 * bk, {'hips': 1}),
            ring((-0.003, 0.190, 0.0), 0.058 * bk, 0.039 * bk, {'hips': 1}),
            ring((-0.003, 0.212, 0.0), 0.055 * bk, 0.037 * bk, mix(('hips', 0.55), ('spine', 0.45))),
            ring((-0.003, 0.232, 0.0), 0.056 * bk, 0.038 * bk, mix(('spine', 0.8), ('chest', 0.2)), front_bias=0.04),
            ring((-0.003, 0.255, 0.0), 0.062 * bk, 0.041 * bk, mix(('spine', 0.3), ('chest', 0.7)), front_bias=0.08),
            ring((-0.004, 0.278, 0.0), 0.066 * bk, 0.043 * bk, {'chest': 1}, front_bias=0.1),
            ring((-0.005, 0.297, 0.0), 0.068 * bk, 0.040 * bk, {'chest': 1}, front_bias=0.04),
            ring((-0.004, 0.310, 0.0), 0.054 * bk, 0.032 * bk, {'chest': 1}),
            ring((-0.002, 0.318, 0.0), 0.025, 0.024, mix(('chest', 0.6), ('neck', 0.4))),
        ]
        mats = [self.trousers, self.trousers] + [self.jacket] * 6
        if jacket_len > 0:
            mats[1] = self.jacket
        sk.tube(mats, tr, seg=10, cap0=True)
        if collar:
            # turned-down collar
            sk.tube(self.jacket, [ring((-0.003, 0.312, 0.0), 0.03, 0.028, {'chest': 1}), ring((-0.003, 0.322, 0.0), 0.026, 0.025, mix(('chest', 0.5), ('neck', 0.5)))], seg=10)
        if coat:
            self.greatcoat(coat_len, coat_mat)
        # ---- arms
        for s in (-1, 1):
            side = 'r' if s > 0 else 'l'
            S, E, Wr = P('upperarm_' + side), P('forearm_' + side), P('hand_' + side)
            ua, fa, hd = 'upperarm_' + side, 'forearm_' + side, 'hand_' + side
            du = (E - S).normalized()
            rings = [
                ring(S - du * 0.014 + Vector((0, -0.004, -0.006 * s)), 0.026 * k, 0.027 * k, mix(('chest', 0.6), (ua, 0.4))),
                ring(S + du * 0.006, 0.0245 * k, 0.025 * k, mix(('chest', 0.25), (ua, 0.75))),
                ring(along(S, E, 0.42), 0.0205 * k, 0.021 * k, {ua: 1}),
                ring(along(S, E, 0.84), 0.0172 * k, 0.0178 * k, mix((ua, 0.85), (fa, 0.15))),
                ring(E, 0.0168 * k, 0.0172 * k, mix((ua, 0.5), (fa, 0.5))),
                ring(along(E, Wr, 0.2), 0.0172 * k, 0.017 * k, mix((fa, 0.9), (ua, 0.1))),
                ring(along(E, Wr, 0.55), 0.016 * k, 0.015 * k, {fa: 1}),
                ring(along(E, Wr, 0.86), 0.0148 * k, 0.0142 * k, {fa: 1}),
            ]
            sk.tube(sleeve, rings, seg=8, front=(1, 0, 0))
            # cuff -> wrist
            sk.tube(self.glove if gloves else self.skin, [
                ring(along(E, Wr, 0.86), 0.0122, 0.0118, {fa: 1}),
                ring(Wr, 0.0112, 0.0104, mix((fa, 0.6), (hd, 0.4))),
            ], seg=8)
            self.hand(side, self.glove if gloves else self.skin)
        # ---- neck and head
        sk.tube(self.skin, [
            ring((-0.001, 0.312, 0.0), 0.0165, 0.0165, mix(('chest', 0.4), ('neck', 0.6))),
            ring((0.001, 0.326, 0.0), 0.0152, 0.0152, {'neck': 1}),
            ring((0.003, 0.338, 0.0), 0.0148, 0.0148, mix(('neck', 0.3), ('head', 0.7))),
        ], seg=8)
        self.head()

    def hand(self, side, mat):
        """A fist: an ellipsoid along the fingers (flat across the palm normal) and the thumb."""
        sk = self.sk
        hd = 'hand_' + side
        Wr = P(hd)
        f = FOREARM_REST[side]
        palm = PALM_REST[side]
        R = basis(f, palm)  # columns: fingers, palm normal, across the knuckles
        res = sphere(self.p, mat, 1.0, at=Wr + f * 0.0155, seg=8, rings=6, rot=euler_of(R), scale=(0.0165, 0.0095, 0.0135))
        sk.rigid(res, hd)
        third = R.col[2]
        tc = Wr + f * 0.010 + third * (0.0085 if side == 'r' else -0.0085) + palm * 0.003
        res = sphere(self.p, mat, 1.0, at=tc, seg=6, rings=4, rot=euler_of(R), scale=(0.0085, 0.0055, 0.0055))
        sk.rigid(res, hd)

    def head(self, nose=True):
        sk = self.sk
        C = HEAD_C
        res = sphere(self.p, self.skin, 1.0, at=C, seg=10, rings=7, scale=(0.0255, 0.0285, 0.0228))
        sk.rigid(res, 'head')
        res = sphere(self.p, self.skin, 1.0, at=C + Vector((0.009, -0.018, 0.0)), seg=8, rings=5, scale=(0.0185, 0.0125, 0.0172))
        sk.rigid(res, 'head')
        if nose:
            sk.rigid(box(self.p, self.skin, (0.007, 0.011, 0.0065), C + Vector((0.026, -0.004, 0.0)), rot=(0, 0, -0.25)), 'head')
            sk.rigid(box(self.p, self.skin, (0.006, 0.0045, 0.03), C + Vector((0.022, 0.0065, 0.0)), rot=(0, 0, 0.1)), 'head')  # brow
        for s in (-1, 1):
            sk.rigid(box(self.p, self.skin, (0.009, 0.012, 0.004), C + Vector((-0.002, -0.001, 0.0226 * s))), 'head')
            sk.rigid(box(self.p, flat(0x1a1410, rough=0.3), (0.003, 0.004, 0.007), C + Vector((0.0232, 0.0015, 0.0092 * s))), 'head')

    def greatcoat(self, length=0.105, mat=None):
        """A long coat skirt from the waist to below the knees (follows the thighs at the hem)."""
        sk = self.sk
        cm = mat or self.jacket
        y0 = 0.214
        y1 = y0 - length
        rings = [
            ring((-0.003, y0, 0.0), 0.06, 0.042, {'hips': 1}),
            ring((-0.002, y0 - length * 0.3, 0.0), 0.066, 0.047, {'hips': 1}),
            ring((0.0, y0 - length * 0.65, 0.0), 0.071, 0.052, {'hips': 1}),
            ring((0.002, y1, 0.0), 0.075, 0.057, {'hips': 1}),
        ]
        v, f = sk.tube(cm, rings, seg=12)

        def wfn(co):
            # the hem follows the thighs a little (sides more than front / back) so the stride doesn't cut through
            kd = max(0.0, min(1.0, (y0 - 0.025 - co.y) / (length * 0.75))) * 0.6
            sz = max(-1.0, min(1.0, co.z / 0.05))
            wr = kd * max(0.0, sz)
            wl = kd * max(0.0, -sz)
            w = {'hips': 1 - wr - wl}
            if wr > 0:
                w['thigh_r'] = wr
            if wl > 0:
                w['thigh_l'] = wl
            top = sorted(w.items(), key=lambda kv: -kv[1])[:2]
            s = sum(x for _, x in top)
            return {n: x / s for n, x in top}
        sk.blend(v, wfn)
        # the coat's belt
        sk.tube(leather(0x3a2c20), [ring((-0.003, 0.214, 0.0), 0.0605, 0.0425, {'hips': 1}), ring((-0.003, 0.224, 0.0), 0.059, 0.0415, mix(('hips', 0.6), ('spine', 0.4)))], seg=12)

    # ------------------------------------------------------------------------------------------------- gear
    def rigid(self, res, bone):
        return self.sk.rigid(res, bone)

    def belt(self, mat=None, y=0.208, buckle=True):
        mat = mat or leather(0x3f3226 if self.faction == 'soviet' else 0x4a4632)
        sk = self.sk
        sk.tube(mat, [ring((-0.003, y - 0.006, 0.0), 0.058 * self.build + 0.002, 0.040 * self.build + 0.002, {'hips': 1}),
                      ring((-0.003, y + 0.006, 0.0), 0.057 * self.build + 0.002, 0.039 * self.build + 0.002, mix(('hips', 0.7), ('spine', 0.3)))], seg=12)
        if buckle:
            self.rigid(box(self.p, metal(0xb08a3a, rough=0.4, metal=0.8), (0.004, 0.011, 0.014), (0.043 * self.build, y, 0.0)), 'hips')

    def pouches(self, xs_zs, y=0.205, size=(0.016, 0.02, 0.018), mat=None, bone='hips'):
        mat = mat or fabric(WEB_SOV if self.faction == 'soviet' else WEB_ALLY, grime=0.45)
        for (x, z) in xs_zs:
            self.rigid(box(self.p, mat, size, (x, y, z), bevel=0.002), bone)
            self.rigid(box(self.p, mat, (size[0] + 0.002, 0.004, size[2] + 0.002), (x, y + size[1] / 2, z), bevel=0.001), bone)

    def straps(self, color=None, cross=False, width=0.011):
        """Webbing straps over the shoulders (decals on the torso, front and back)."""
        c = color or (WEB_SOV if self.faction == 'soviet' else WEB_ALLY)
        img = D.solid(c)
        m = self.m
        for s in (-1, 1):
            if cross:
                m.decal(img, at=(0.04, 0.265, 0.0), size=(width, 0.12), facing='+x', part='skin', depth=0.03, roll=0.6 * s, team=0)
            else:
                m.decal(img, at=(0.04, 0.268, 0.026 * s), size=(width, 0.1), facing='+x', part='skin', depth=0.03, roll=-0.12 * s, team=0)
                m.decal(img, at=(-0.04, 0.268, 0.026 * s), size=(width, 0.1), facing='-x', part='skin', depth=0.03, roll=0.12 * s, team=0)
            m.decal(img, at=(-0.004, 0.306, 0.03 * s), size=(width, 0.06), facing='+y', part='skin', depth=0.02, team=0)

    def pack(self, kind='allied'):
        if kind == 'allied':
            mat = fabric(0x4f533c, grime=0.45)
            self.rigid(box(self.p, mat, (0.03, 0.058, 0.074), (-0.058, 0.272, 0.0), bevel=0.006), 'chest')
            self.rigid(box(self.p, mat, (0.034, 0.016, 0.078), (-0.058, 0.30, 0.0), bevel=0.004), 'chest')
            self.rigid(cyl(self.p, fabric(0x6b6248), 0.012, 0.086, (-0.06, 0.312, 0.0), rot=(math.pi / 2, 0, 0), seg=8), 'chest')
            # entrenching tool
            self.rigid(box(self.p, gunmetal(0x3a3c36), (0.006, 0.03, 0.022), (-0.076, 0.258, 0.0)), 'chest')
        else:
            # veshmeshok: a soft sack tied at the top + the rolled greatcoat (skatka) over the left shoulder
            mat = fabric(0x7a6e50, grime=0.5)
            self.rigid(sphere(self.p, mat, 1.0, at=(-0.06, 0.262, 0.0), seg=8, rings=6, scale=(0.026, 0.034, 0.036)), 'chest')
            self.rigid(cyl(self.p, mat, 0.006, 0.014, (-0.058, 0.298, 0.0), seg=6), 'chest')

    def skatka(self):
        """The Soviet rolled greatcoat (skatka): a sash hugging the torso, over the left shoulder down to the right hip."""
        mat = fabric(0x6a6450, grime=0.45)
        rings = []
        n = 16
        for i in range(n + 1):
            th = 2 * math.pi * i / n
            sn = math.sin(th)
            y = 0.258 - 0.058 * sn
            a = 0.060 if y > 0.24 else 0.058
            b = 0.044 if y > 0.24 else 0.040
            x = -0.004 + math.cos(th) * (b + 0.008)
            z = sn * (a + 0.006)
            kc = max(0.0, min(1.0, (y - 0.205) / 0.05))
            rings.append(ring((x, y, z), 0.0105, 0.0105, mix(('chest', kc), ('hips', 1 - kc))))
        self.sk.tube(mat, rings, seg=5, front=(0, 1, 0))

    def canteen(self, z=0.05, y=0.2):
        self.rigid(cyl(self.p, fabric(0x4c5037), 0.012, 0.028, (-0.03, y - 0.012, z), seg=8), 'hips')
        self.rigid(cyl(self.p, metal(0x2b2b2b), 0.004, 0.006, (-0.03, y + 0.004, z), seg=6), 'hips')

    # ---- headgear (rigid on the head; profiles around the head centre)
    def helmet(self, kind='m1', mat=None):
        C = HEAD_C
        mat = mat or helmet_paint()
        if kind == 'm1':
            prof = [(0.0372, -0.006), (0.0368, -0.003), (0.0322, 0.002), (0.0318, 0.012), (0.0282, 0.024), (0.019, 0.0325), (0.009, 0.0355), (0.0, 0.0362)]
            res = lathe(self.p, mat, prof, at=C + Vector((-0.002, 0.002, 0.0)), seg=14, rot=(0, 0, 0.08))
            self.rigid(res, 'head')
            # camouflage net band + chin strap
            self.rigid(lathe(self.p, fabric(0x4a4c34), [(0.0326, 0.004), (0.0322, 0.012)], at=C + Vector((-0.002, 0.002, 0.0)), seg=16, rot=(0, 0, 0.08), cap_top=False, cap_bottom=False), 'head')
            self.m.decal(D.allied_star(), at=(0.036, 0.372, 0.0), size=0.016, facing='+x', part='skin', depth=0.012)
        elif kind == 'ssh40':
            prof = [(0.038, -0.012), (0.035, -0.008), (0.0322, -0.002), (0.0322, 0.01), (0.029, 0.024), (0.02, 0.0345), (0.009, 0.0385), (0.0, 0.0392)]
            res = lathe(self.p, mat, prof, at=C + Vector((-0.002, 0.002, 0.0)), seg=14, rot=(0, 0, 0.06))
            self.rigid(res, 'head')
            self.m.decal(D.soviet_star(), at=(0.034, 0.374, 0.0), size=0.015, facing='+x', part='skin', depth=0.012)
        elif kind == 'ushanka':
            fur = fabric(0x5a4632, grime=0.3)
            prof = [(0.033, -0.004), (0.036, 0.004), (0.036, 0.016), (0.031, 0.028), (0.016, 0.034), (0.0, 0.035)]
            self.rigid(lathe(self.p, fur, prof, at=C + Vector((-0.002, 0.003, 0.0)), seg=14), 'head')
            # ear flaps tied up, the front flap folded up with the star badge (team cockade)
            for s in (-1, 1):
                self.rigid(box(self.p, fur, (0.034, 0.024, 0.008), C + Vector((-0.004, 0.012, 0.034 * s)), rot=(0.25 * s, 0, 0), bevel=0.003), 'head')
            self.rigid(box(self.p, fur, (0.008, 0.02, 0.05), C + Vector((0.034, 0.018, 0.0)), rot=(0, 0, -0.2), bevel=0.003), 'head')
            self.m.decal(D.soviet_star(), at=(0.039, 0.374, 0.0), size=0.013, facing='+x', part='skin', depth=0.01)
            self.m.decal(D.team_paint(1.0), at=(0.0, 0.392, 0.0), size=(0.05, 0.05), facing='+y', part='skin', depth=0.006, team=1)
        elif kind == 'hardhat':
            yel = painted(0xd9a520, wear=0.4, grime=0.4, rust=0.0, rivets=False, rough=0.45, metal=0.0)
            prof = [(0.0405, -0.002), (0.040, 0.001), (0.031, 0.003), (0.030, 0.014), (0.026, 0.026), (0.016, 0.034), (0.0, 0.036)]
            self.rigid(lathe(self.p, yel, prof, at=C + Vector((0.0, 0.003, 0.0)), seg=16), 'head')
            self.rigid(box(self.p, yel, (0.05, 0.004, 0.008), C + Vector((0.0, 0.037, 0.0))), 'head')
            self.m.decal(D.team_paint(1.0), at=(0.03, 0.372, 0.0), size=(0.022, 0.012), facing='+x', part='skin', depth=0.012, team=1)
        elif kind == 'medic':
            white = painted(0xe6e3dc, wear=0.25, grime=0.35, rust=0.0, rivets=False, rough=0.5, metal=0.05)
            prof = [(0.0372, -0.006), (0.0368, -0.003), (0.0322, 0.002), (0.0318, 0.012), (0.0282, 0.024), (0.019, 0.0325), (0.009, 0.0355), (0.0, 0.0362)]
            self.rigid(lathe(self.p, white, prof, at=C + Vector((-0.002, 0.002, 0.0)), seg=14, rot=(0, 0, 0.08)), 'head')
            red = red_cross()
            self.m.decal(red, at=(0.035, 0.372, 0.0), size=0.017, facing='+x', part='skin', depth=0.012)
            for s in (-1, 1):
                self.m.decal(red, at=(0.0, 0.372, 0.033 * s), size=0.015, facing='+z' if s > 0 else '-z', part='skin', depth=0.012)
            self.m.decal(red, at=(0.0, 0.392, 0.0), size=0.017, facing='+y', part='skin', depth=0.012)
        elif kind == 'gasmask':
            prof = [(0.036, -0.008), (0.0335, -0.004), (0.032, 0.006), (0.029, 0.022), (0.02, 0.032), (0.0, 0.036)]
            self.rigid(lathe(self.p, mat, prof, at=C + Vector((-0.003, 0.002, 0.0)), seg=16), 'head')
            rub = leather(0x2a2a2a, 0.75)
            self.rigid(sphere(self.p, rub, 1.0, at=C + Vector((0.016, -0.008, 0.0)), seg=8, rings=5, scale=(0.016, 0.02, 0.022)), 'head')
            glass_m = glass(0x2b4a40)
            for s in (-1, 1):
                self.rigid(cyl(self.p, glass_m, 0.0068, 0.004, C + Vector((0.029, 0.001, 0.0095 * s)), rot=(0, 0, -math.pi / 2), seg=8), 'head')
            self.rigid(cyl(self.p, gunmetal(0x3c3c38), 0.0085, 0.012, C + Vector((0.032, -0.019, 0.0)), rot=(0, 0, -math.pi / 2 - 0.5), r2=0.0072, seg=10), 'head')
        elif kind == 'fedora':
            felt = fabric(0x2e2b28, grime=0.2)
            self.rigid(cyl(self.p, felt, 0.046, 0.003, C + Vector((0.0, 0.016, 0.0)), rot=(0, 0, 0.08), seg=16), 'head')
            self.rigid(lathe(self.p, felt, [(0.028, 0.0), (0.0275, 0.016), (0.022, 0.025), (0.0, 0.022)], at=C + Vector((0.0, 0.016, 0.0)), seg=14), 'head')
            self.rigid(lathe(self.p, fabric(0xb4b4b4, team=True), [(0.0285, 0.001), (0.0282, 0.0065)], at=C + Vector((0.0, 0.016, 0.0)), seg=14, cap_top=False, cap_bottom=False), 'head')
        elif kind == 'beanie':
            knit = fabric(0x1f2023, grime=0.2)
            self.rigid(lathe(self.p, knit, [(0.0285, -0.006), (0.029, 0.006), (0.027, 0.02), (0.018, 0.03), (0.0, 0.033)], at=C + Vector((-0.002, 0.004, 0.0)), seg=14), 'head')
        elif kind == 'cap':
            capm = fabric(0x8a8a8a, team=True)
            self.rigid(lathe(self.p, capm, [(0.0285, -0.002), (0.029, 0.008), (0.026, 0.018), (0.0, 0.022)], at=C + Vector((-0.002, 0.008, 0.0)), seg=14), 'head')
            self.rigid(box(self.p, capm, (0.022, 0.003, 0.04), C + Vector((0.032, 0.008, 0.0)), rot=(0, 0, -0.15)), 'head')
            gl_m = glass(0x5a7a8a)
            for s in (-1, 1):
                self.rigid(cyl(self.p, gl_m, 0.006, 0.006, C + Vector((0.018, 0.026, 0.009 * s)), rot=(0, 0, -math.pi / 2 + 0.4), seg=8), 'head')
            self.rigid(box(self.p, leather(0x2a2a2a), (0.04, 0.004, 0.056), C + Vector((0.004, 0.022, 0.0)), rot=(0, 0, -0.1)), 'head')
        elif kind == 'tanya':
            hair = fabric(0x2a1a12, grime=0.1)
            self.rigid(lathe(self.p, hair, [(0.0272, -0.008), (0.0285, 0.004), (0.027, 0.018), (0.017, 0.028), (0.0, 0.031)], at=C + Vector((-0.004, 0.002, 0.0)), seg=14), 'head')
            # ponytail: a short tube on the head bone
            self.rigid(cyl(self.p, hair, 0.007, 0.034, C + Vector((-0.036, -0.012, 0.0)), rot=(0, 0, 0.55), r2=0.0035, seg=8), 'head')
            self.rigid(box(self.p, fabric(0x9a2020), (0.006, 0.006, 0.01), C + Vector((-0.028, 0.004, 0.0))), 'head')


    # ---- dressing (decals: no triangles)
    def decal_band(self, color, y, h=0.012, team_=None, sides=('+x', '-x', '+z', '-z')):
        """A horizontal band around the torso (hi-vis stripes, sashes) projected from four sides."""
        img = D.solid(color)
        for f in sides:
            at = {'+x': (0.05, y, 0.0), '-x': (-0.05, y, 0.0), '+z': (0.0, y, 0.07), '-z': (0.0, y, -0.07)}[f]
            self.m.decal(img, at=at, size=(0.13, h), facing=f, part='skin', depth=0.035, team=team_ if team_ is not None else 0)

    def cross_straps(self, color, width=0.012):
        img = D.solid(color)
        for s in (-1, 1):
            self.m.decal(img, at=(0.045, 0.262, 0.0), size=(width, 0.13), facing='+x', part='skin', depth=0.035, roll=0.55 * s, team=0)
            self.m.decal(img, at=(-0.045, 0.262, 0.0), size=(width, 0.13), facing='-x', part='skin', depth=0.035, roll=0.55 * s, team=0)

    def chest_patch(self, img, at=(0.046, 0.27, 0.0), size=0.034, back=True):
        self.m.decal(img, at=at, size=size, facing='+x', part='skin', depth=0.03, team=0)
        if back:
            self.m.decal(img, at=(-at[0], at[1], at[2]), size=size, facing='-x', part='skin', depth=0.03, team=0)

    def armband(self, side='l', color=0xe6e3dc, img=None, team_=None):
        """A band around the upper arm (decal from the outside)."""
        S, E = P('upperarm_' + side), P('forearm_' + side)
        c = along(S, E, 0.45)
        z = 1 if side == 'r' else -1
        self.m.decal(img or D.solid(color), at=(c.x, c.y, c.z + 0.016 * z), size=(0.04, 0.014), facing='+z' if z > 0 else '-z', part='skin', depth=0.03,
                     roll=0.6 * z, team=team_ if team_ is not None else 0)

    def grenades(self, n=4, y=0.272):
        gr = painted(0x3d4a2c, wear=0.5, grime=0.4, rust=0.1, rivets=False, rough=0.55, metal=0.3)
        for i in range(n):
            k = (i + 0.5) / n
            z = -0.04 + 0.08 * k
            yy = y + 0.035 * (0.5 - k)
            self.rigid(sphere(self.p, gr, 0.0085, at=(0.05, yy, z), seg=6, rings=4), 'chest')

    def satchel(self, z=0.06, y=0.19, color=0x7a6e50):
        mat = fabric(color, grime=0.5)
        self.rigid(box(self.p, mat, (0.034, 0.03, 0.016), (0.0, y, z), bevel=0.004), 'hips')

    def rockets_pack(self, kind='soviet'):
        mat = fabric(0x6b6248 if kind == 'soviet' else 0x4f533c, grime=0.5)
        self.rigid(box(self.p, mat, (0.03, 0.06, 0.06), (-0.058, 0.268, 0.0), bevel=0.006), 'chest')
        war = painted(0x4b5233, wear=0.45, rivets=False, rough=0.6, metal=0.2)
        for z in (-0.016, 0.016):
            self.rigid(cyl(self.p, war, 0.011, 0.034, (-0.06, 0.312, z), seg=8, r2=0.004), 'chest')

    def apron(self, color=0x8a7a58):
        mat = fabric(color, grime=0.5)
        self.sk.tube(mat, [ring((0.004, 0.31, 0.0), 0.056, 0.045, {'chest': 1}), ring((0.006, 0.26, 0.0), 0.066, 0.047, {'chest': 1}),
                           ring((0.006, 0.22, 0.0), 0.06, 0.042, mix(('chest', 0.4), ('spine', 0.6)))], seg=12)

    def armour_vest(self):
        gm = gunmetal(0x4a4e52)
        self.sk.tube(gm, [ring((-0.004, 0.31, 0.0), 0.058, 0.04, {'chest': 1}), ring((-0.004, 0.282, 0.0), 0.07, 0.048, {'chest': 1}, front_bias=0.08),
                          ring((-0.004, 0.245, 0.0), 0.066, 0.045, mix(('chest', 0.6), ('spine', 0.4))), ring((-0.004, 0.226, 0.0), 0.06, 0.042, mix(('chest', 0.2), ('spine', 0.8)))], seg=10)
        for s in (-1, 1):
            self.rigid(sphere(self.p, gm, 1.0, at=(-0.002, 0.305, 0.06 * s), seg=6, rings=4, scale=(0.026, 0.014, 0.022)), 'chest')

    def tesla_pack(self):
        gm = gunmetal(0x45484c)
        self.rigid(box(self.p, gm, (0.038, 0.074, 0.066), (-0.066, 0.272, 0.0), bevel=0.006), 'chest')
        cop = metal(0xb06a3a, rough=0.35, metal=0.9, wear=0.2, rust=0.0)
        ins = painted(0xd8d0c0, wear=0.2, rivets=False, rough=0.5, metal=0.0)
        for z in (-0.02, 0.02):
            self.rigid(cyl(self.p, cop, 0.0095, 0.05, (-0.074, 0.33, z), seg=8), 'chest')
            for y in (0.322, 0.344):
                self.rigid(cyl(self.p, ins, 0.0125, 0.006, (-0.074, y, z), seg=8, caps=False), 'chest')
        self.rigid(sphere(self.p, light_mat(0x7ad8ff, 3.2, 'pulse'), 0.011, at=(-0.087, 0.27, 0.0), seg=8, rings=6), 'chest')

    def loot_sack(self):
        mat = fabric(0x8a7e5c, grime=0.55)
        self.rigid(sphere(self.p, mat, 1.0, at=(-0.064, 0.266, 0.0), seg=10, rings=7, scale=(0.034, 0.042, 0.04)), 'chest')
        self.rigid(cyl(self.p, mat, 0.007, 0.016, (-0.06, 0.312, 0.0), seg=6), 'chest')

    def holsters(self):
        lt = leather(0x2a2018)
        for s in (-1, 1):
            side = 'r' if s > 0 else 'l'
            H, K = P('thigh_' + side), P('shin_' + side)
            c = along(H, K, 0.35)
            self.rigid(box(self.p, lt, (0.018, 0.03, 0.008), (c.x, c.y, c.z + 0.026 * s), bevel=0.002), 'thigh_' + side)

    def mask(self, mat):
        """A bandana over the lower face (thieves)."""
        C = HEAD_C
        self.rigid(sphere(self.p, mat, 1.0, at=C + Vector((0.012, -0.014, 0.0)), seg=8, rings=5, scale=(0.02, 0.014, 0.024)), 'head')

    # ---- weapons (weapon bone frame: grip origin, +X barrel; see _gear.py)
    def wpart(self, res, bone='weapon'):
        return self.sk.rigid(res, bone)

    def W(self, x, y, z, bone='weapon'):
        base = W_BIND if bone == 'weapon' else PROP_BIND
        return (base.x + x, base.y + y, base.z + z)

    def muzzle(self, name, local, bone='weapon'):
        base = W_BIND if bone == 'weapon' else PROP_BIND
        self.points[name] = {'bone': bone, 'at': [base.x + local[0], base.y + local[1], base.z + local[2]], 'kind': 'muzzle'}

    def rifle(self, kind='ak'):
        W = self.W
        gm = gunmetal()
        if kind == 'ak':
            wd = wood()
            self.wpart(box(self.p, wd, (0.062, 0.016, 0.011), W(-0.046, 0.004, 0.0), rot=(0, 0, 0.1), bevel=0.003))       # stock
            self.wpart(box(self.p, gm, (0.07, 0.019, 0.012), W(0.02, 0.017, 0.0), bevel=0.002))                         # receiver
            self.wpart(box(self.p, wd, (0.04, 0.014, 0.014), W(0.075, 0.017, 0.0), bevel=0.003))                        # handguard
            self.wpart(cyl(self.p, gm, 0.0035, 0.06, W(0.122, 0.021, 0.0), rot=(0, 0, -math.pi / 2), seg=6))           # barrel
            self.wpart(box(self.p, gm, (0.012, 0.032, 0.009), W(0.032, -0.008, 0.0), rot=(0, 0, 0.42), bevel=0.002))    # curved mag
            self.wpart(box(self.p, wd, (0.012, 0.022, 0.009), W(0.0, -0.006, 0.0), rot=(0, 0, 0.3), bevel=0.002))      # grip
            self.wpart(box(self.p, gm, (0.003, 0.009, 0.003), W(0.148, 0.026, 0.0)))                                   # front sight
        elif kind == 'm16':
            bl = gunmetal(0x1e1f22)
            self.wpart(box(self.p, bl, (0.06, 0.018, 0.011), W(-0.046, 0.008, 0.0), bevel=0.003))
            self.wpart(box(self.p, bl, (0.07, 0.02, 0.012), W(0.02, 0.017, 0.0), bevel=0.002))
            self.wpart(box(self.p, bl, (0.05, 0.006, 0.006), W(0.018, 0.031, 0.0)))                                    # carry handle
            self.wpart(cyl(self.p, bl, 0.0078, 0.044, W(0.078, 0.018, 0.0), rot=(0, 0, -math.pi / 2), seg=8))         # handguard
            self.wpart(cyl(self.p, bl, 0.003, 0.05, W(0.124, 0.02, 0.0), rot=(0, 0, -math.pi / 2), seg=6))
            self.wpart(box(self.p, bl, (0.011, 0.03, 0.009), W(0.032, -0.008, 0.0), rot=(0, 0, 0.12), bevel=0.002))
            self.wpart(box(self.p, bl, (0.011, 0.02, 0.009), W(0.0, -0.006, 0.0), rot=(0, 0, 0.3), bevel=0.002))
            self.wpart(box(self.p, bl, (0.003, 0.014, 0.003), W(0.104, 0.03, 0.0)))
        elif kind == 'tesla':
            self.wpart(box(self.p, gm, (0.1, 0.022, 0.018), W(0.02, 0.016, 0.0), bevel=0.004))
            cop = metal(0xb06a3a, rough=0.35, metal=0.9, wear=0.2, rust=0.0)
            for x in (0.075, 0.1):
                self.wpart(cyl(self.p, cop, 0.0155, 0.009, W(x, 0.018, 0.0), rot=(0, 0, math.pi / 2), seg=8))
            self.wpart(cyl(self.p, gm, 0.004, 0.05, W(0.115, 0.018, 0.0), rot=(0, 0, -math.pi / 2), seg=6))
            self.wpart(sphere(self.p, light_mat(0x7ad8ff, 3.0, 'pulse'), 0.0065, at=W(0.142, 0.018, 0.0), seg=8, rings=6))
            self.wpart(box(self.p, gm, (0.011, 0.022, 0.009), W(0.0, -0.006, 0.0), rot=(0, 0, 0.3)))
        self.muzzle('m0', RIFLE['muzzle'])

    def launcher(self, kind='rpg'):
        W = self.W
        ty, tr = LAUNCHER['tube_y'], LAUNCHER['tube_r']
        ol = painted(0x4b5233, wear=0.45, grime=0.45, rust=0.1, rivets=False, rough=0.6, metal=0.2)
        gm = gunmetal()
        if kind == 'rpg':
            self.wpart(cyl(self.p, ol, tr * 0.8, 0.22, W(-0.02, ty, 0.0), rot=(0, 0, -math.pi / 2), seg=10))
            self.wpart(cyl(self.p, gm, tr * 0.8, 0.05, W(-0.15, ty, 0.0), rot=(0, 0, -math.pi / 2), r2=tr * 1.4, seg=10, caps=False))  # venturi
            self.wpart(lathe(self.p, ol, [(0.0, 0.0), (0.026, 0.02), (0.026, 0.035), (0.012, 0.06), (0.0, 0.07)], at=W(0.09, ty, 0.0), rot=(0, 0, -math.pi / 2), seg=10))  # warhead
            self.wpart(box(self.p, wood(), (0.03, 0.014, 0.022), W(-0.03, ty - 0.004, 0.0), bevel=0.003))
            self.wpart(box(self.p, gm, (0.012, 0.026, 0.01), W(0.0, -0.002, 0.0), rot=(0, 0, 0.25)))
            self.wpart(box(self.p, gm, (0.012, 0.022, 0.009), W(0.065, ty - 0.026, 0.0), rot=(0, 0, 0.1)))
            self.wpart(box(self.p, gm, (0.016, 0.014, 0.008), W(0.02, ty + 0.012, -0.018)))  # optic
        else:
            self.wpart(cyl(self.p, ol, tr, 0.27, W(0.0, ty, 0.0), rot=(0, 0, -math.pi / 2), seg=12))
            for x in (0.125, -0.125):
                self.wpart(cyl(self.p, painted(0x3a3e2a, wear=0.3, rivets=False), tr * 1.25, 0.03, W(x, ty, 0.0), rot=(0, 0, -math.pi / 2), seg=12))
            self.wpart(box(self.p, gm, (0.05, 0.026, 0.02), W(0.02, ty + 0.02, -0.024), bevel=0.003))  # tracker
            self.wpart(cyl(self.p, glass(0x5a7a8a), 0.006, 0.004, W(0.047, ty + 0.02, -0.024), rot=(0, 0, -math.pi / 2), seg=8))
            self.wpart(box(self.p, gm, (0.012, 0.026, 0.01), W(0.0, -0.002, 0.0), rot=(0, 0, 0.25)))
            self.wpart(box(self.p, gm, (0.012, 0.022, 0.009), W(0.065, ty - 0.026, 0.0), rot=(0, 0, 0.1)))
            self.m.decal(D.solid(0xc8b040), at=W(0.0, ty, tr * 1.01), size=(0.012, 0.03), facing='+z', part='skin', depth=0.006)
        self.muzzle('m0', LAUNCHER['muzzle'])

    def flamer(self):
        W = self.W
        gm = gunmetal()
        self.wpart(box(self.p, gm, (0.12, 0.016, 0.016), W(0.04, 0.008, 0.0), bevel=0.003))
        self.wpart(cyl(self.p, gunmetal(0x2a2a2a), 0.011, 0.03, W(0.14, 0.008, 0.0), rot=(0, 0, -math.pi / 2), r2=0.008, seg=10))
        self.wpart(box(self.p, gm, (0.011, 0.024, 0.01), W(0.0, -0.006, 0.0), rot=(0, 0, 0.3)))
        self.wpart(box(self.p, gm, (0.011, 0.022, 0.01), W(0.052, -0.008, 0.0), rot=(0, 0, 0.2)))
        self.wpart(sphere(self.p, light_mat(0xff8a2a, 3.2, 'flicker'), 0.005, at=W(0.158, 0.004, 0.0), seg=6, rings=4))
        self.muzzle('m0', FLAMER['muzzle'])
        # twin fuel tanks + pressure bottle on the back (chest)
        red = painted(0x8a2a1c, wear=0.5, grime=0.5, rust=0.2, rivets=False, rough=0.5, metal=0.3)
        for z in (-0.024, 0.024):
            self.rigid(cyl(self.p, red, 0.019, 0.1, (-0.064, 0.262, z), seg=10, bevel=0.003), 'chest')
            self.rigid(cyl(self.p, gm, 0.008, 0.012, (-0.064, 0.318, z), seg=8), 'chest')
        self.rigid(cyl(self.p, metal(0x8a8a86), 0.01, 0.08, (-0.088, 0.262, 0.0), seg=8), 'chest')
        self.rigid(box(self.p, leather(0x3a3028), (0.008, 0.09, 0.08), (-0.044, 0.262, 0.0)), 'chest')

    def pistols(self):
        bl = gunmetal(0x26272b)
        for bone in ('weapon', 'prop'):
            W = (lambda x, y, z, b=bone: self.W(x, y, z, b))
            self.wpart(box(self.p, bl, (0.05, 0.012, 0.008), W(0.018, 0.012, 0.0), bevel=0.0015), bone)
            self.wpart(box(self.p, bl, (0.01, 0.022, 0.0075), W(0.0, -0.002, 0.0), rot=(0, 0, 0.25), bevel=0.0015), bone)
            self.muzzle('m0' if bone == 'weapon' else 'm1', PISTOL['muzzle'], bone)

    def held(self, kind, bone='weapon'):
        """Fist-held items (grenade, wrench, toolbox, medkit, briefcase, oil can, crowbar): item origin = in the fist."""
        W = (lambda x, y, z: self.W(x, y, z, bone))
        if kind == 'grenade':
            gr = painted(0x3d4a2c, wear=0.5, grime=0.4, rust=0.1, rivets=False, rough=0.55, metal=0.3)
            self.wpart(sphere(self.p, gr, 0.0105, at=W(0.002, 0.0, 0.0), seg=8, rings=6), bone)
            self.wpart(box(self.p, gunmetal(), (0.004, 0.008, 0.004), W(0.002, 0.012, 0.0)), bone)
            self.muzzle('m0', (0.0, 0.0, 0.0), bone)
        elif kind == 'wrench':
            st = metal(0x8a8c8e, rough=0.35, metal=0.9, wear=0.3)
            self.wpart(box(self.p, st, (0.09, 0.008, 0.006), W(0.035, 0.0, 0.0)), bone)
            self.wpart(box(self.p, st, (0.012, 0.024, 0.007), W(0.082, 0.004, 0.0)), bone)
            self.muzzle('m0', (0.085, 0.0, 0.0), bone)
        elif kind == 'crowbar':
            st = painted(0x9a2a20, wear=0.6, rivets=False, rough=0.5, metal=0.5)
            self.wpart(box(self.p, st, (0.1, 0.006, 0.006), W(0.035, 0.0, 0.0), rot=(0, 0, 0.1)), bone)
            self.wpart(box(self.p, st, (0.006, 0.016, 0.006), W(0.085, 0.01, 0.0), rot=(0, 0, 0.4)), bone)
            self.muzzle('m0', (0.08, 0.0, 0.0), bone)
        elif kind == 'toolbox':
            rd = painted(0xa8281e, wear=0.55, grime=0.45, rust=0.15, rivets=False, rough=0.5, metal=0.4)
            self.wpart(box(self.p, rd, (0.028, 0.032, 0.06), W(0.0, -0.022, 0.0), bevel=0.003), bone)
            self.wpart(box(self.p, gunmetal(), (0.008, 0.004, 0.03), W(0.0, -0.004, 0.0)), bone)
        elif kind == 'medkit':
            wh = painted(0xe4e0d8, wear=0.3, grime=0.4, rust=0.0, rivets=False, rough=0.55, metal=0.0)
            self.wpart(box(self.p, wh, (0.026, 0.036, 0.05), W(0.0, -0.024, 0.0), bevel=0.004), bone)
            for s in (-1, 1):
                self.m.decal(red_cross(), at=W(0.0, -0.024, 0.0251 * s), size=0.022, facing='+z' if s > 0 else '-z', part='skin', depth=0.006)
        elif kind == 'briefcase':
            bk = leather(0x1e1a18, 0.45)
            self.wpart(box(self.p, bk, (0.016, 0.044, 0.062), W(0.0, -0.028, 0.0), bevel=0.003), bone)
            self.wpart(box(self.p, metal(0xb08a3a, rough=0.4), (0.018, 0.004, 0.02), W(0.0, -0.006, 0.0)), bone)
        elif kind == 'oilcan':
            rd = painted(0xa8281e, wear=0.6, rivets=False, rough=0.5, metal=0.4)
            self.wpart(cyl(self.p, rd, 0.012, 0.03, W(0.0, -0.016, 0.0), seg=8), bone)
            self.wpart(cyl(self.p, metal(0xb08a3a), 0.002, 0.04, W(0.012, 0.004, 0.0), rot=(0, 0, -0.6), seg=5), bone)

    def finish(self, set='rifle', height=0.39, radius=0.16):
        self.m.set_meta(height=height, radius=radius, set=set, points=self.points, rig='human')


def red_cross():
    cv = D.Canvas(64, 64)
    cv.rect(0, 0, 64, 64, D.lin(0xe8e4dc))
    cv.rect(24, 8, 40, 56, D.lin(0xb0201a))
    cv.rect(8, 24, 56, 40, D.lin(0xb0201a))
    return cv.image()
