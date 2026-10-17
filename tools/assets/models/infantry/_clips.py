"""Clips of the shared humanoid rig (kit.rig.HUMAN), authored as key poses + procedural layers (kit.anim).

Names are '<set>.<state>'; the game picks the set per soldier type (src/render/models/infantry-hd-anim.ts):
    rifle      e1, shok         idle idle2 idle3 walk run aim fire crouch_aim crouch_fire reload
    flamer     e4               (rifle clips) + aim fire (hip)
    launcher   e3               idle walk run aim fire reload (kneeling)
    pistol     e7               idle walk run aim fire fire2 (right / left gun)
    unarmed    e6 medi spy thf mech     idle idle2 idle3 walk run use
    grenade    e2               (unarmed clips) + aim throw
    common     para, death.back death.front death.blown death.burn death.electro
Loops close on their first frame. Every clip's meta carries what the game needs: `stride` (model units travelled
per cycle, for foot-locked playback rates), `release` / `shot` (event times).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit.anim import (RUN, TAU, WALK, Clip, HumanBody, Keys, M4, V, basis, clamp, ease, grip_world, kick, lean,  # noqa: E402
                      legs_for_gait, noise1, rx, ry, rz, slerp3, smooth)
from kit.rig import I3  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from _gear import FIST_L, FIST_R, FLAMER, LAUNCHER, PISTOL, RIFLE  # noqa: E402

HIP_Y = 0.192
BREATH = 2.0  # seconds per breath: every looping stance clip lasts a whole number of breaths
IDLE = 4.0
ANKLE_Y = 0.024
REACH = {'worst': 0.0, 'clip': ''}
_CUR = ['']


def wrot(fwd, up=(0.0, 1.0, 0.0)):
    return basis(V(fwd).normalized(), V(up))


PER_CLIP = {}


def note_reach(e):
    if e > PER_CLIP.get(_CUR[0], 0.0):
        PER_CLIP[_CUR[0]] = e
    if e > REACH['worst']:
        REACH['worst'] = e
        REACH['clip'] = _CUR[0]


# ---------------------------------------------------------------------------------------------------------
# building blocks


def stand(t, hips=None, yaw=0.0, lean_=0.03, roll=0.0, spine_yaw=0.0, chest_yaw=0.0, breathe=1.0, feet=None,
          foot_yaw=(0.14, -0.14), crouch=0.0, chest_lean=0.0, neck=I3, head=I3):
    """Upright stance. feet = ((x, z) left, (x, z) right) planted; crouch lowers the hips (bends the knees)."""
    b = HumanBody()
    br = math.sin(t * TAU / BREATH) * breathe
    hp = V(hips) if hips is not None else V(0.0, HIP_Y - 0.005 - crouch, 0.0)
    hp.y += br * 0.0008
    b.torso(hp, ry(yaw) @ lean(lean_ * 0.35) @ rx(roll),
            spine=ry(spine_yaw) @ lean(lean_ * 0.3 + br * 0.006),
            chest=ry(chest_yaw) @ lean(lean_ * 0.35 + chest_lean - br * 0.012),
            neck=neck, head=head)
    fl, fr = feet if feet is not None else ((0.012, -0.040), (-0.010, 0.044))
    b.leg('l', (fl[0], ANKLE_Y, fl[1]), ry(foot_yaw[0] + yaw * 0.3))
    b.leg('r', (fr[0], ANKLE_Y, fr[1]), ry(foot_yaw[1] + yaw * 0.3))
    return b


def chest_m(b, pos, rot=I3):
    """A matrix given in the chest frame -> world."""
    return b.W['chest'] @ M4(pos, rot)


def chest_dir(b, d):
    return (b.R['chest'] @ V(d)).normalized()


def hold(b, W, spec, right=True, left=True, pole_r=None, pole_l=None, left_free=None):
    """Weapon bone at W, hands on its grips (IK). left_free: (wrist, hand rot, pole) when the left hand is elsewhere."""
    b.weapon(W)
    if right:
        wr, f, p = grip_world(W, *spec['grip_r'])
        note_reach(b.arm_ik('r', wr, b.hand_like('r', f, p), pole_r if pole_r is not None else chest_dir(b, (-0.35, -0.75, 0.55))))
    if left_free is not None:
        note_reach(b.arm_ik('l', left_free[0], left_free[1], left_free[2]))
    elif left:
        wr, f, p = grip_world(W, *spec['grip_l'])
        note_reach(b.arm_ik('l', wr, b.hand_like('l', f, p), pole_l if pole_l is not None else chest_dir(b, (-0.15, -0.9, -0.45))))


def arms_down(b, t=0.0, swing_l=0.0, swing_r=0.0, bend=0.28, out=0.2, side_l=None, side_r=None, bend_fwd=0.8):
    """Relaxed arms hanging at the sides (swing: + forwards, radians)."""
    for side, sw in (('l', swing_l), ('r', swing_r)):
        s = 1 if side == 'r' else -1
        o = out + (side_l if side == 'l' and side_l is not None else side_r if side == 'r' and side_r is not None else 0.0)
        d = b.R['chest'] @ (rz(sw) @ V(0.02, -0.97, o * s))
        b.arm_fk(side, d, bend + max(0.0, sw) * bend_fwd)


def no_props(b):
    b.weapon(None)
    b.prop(None)


def prop_in_left(b, offset=(0.0, 0.0, 0.0)):
    """Left-hand prop held in the fist (toolbox, medkit, briefcase, second pistol rests)."""
    hw = b.W['hand_l']
    b.prop(hw @ M4(V(FIST_L[0]) * -1 + V(offset)))


def fist_r(b):
    hw = b.W['hand_r']
    return hw @ M4(V(FIST_R[0]) * -1)


def dropped(t, t0, t1, W0, W1, arc=0.06):
    """A prop falling from W0 (at t0) to W1 (at t1) with a little toss arc."""
    if t <= t0:
        return W0
    k = clamp((t - t0) / max(1e-6, t1 - t0), 0, 1)
    kk = k * k
    p = W0.translation.lerp(W1.translation, kk)
    p.y += arc * math.sin(math.pi * k) * (1 - k)
    r = slerp3(W0.to_3x3().normalized(), W1.to_3x3().normalized(), smooth(k))
    s = W1.to_scale()[0] if k >= 1 else 1.0
    return M4(p, r, s)


def gait_body(t, g, lean_extra=0.0, arms_swing=0.0):
    """Hips + legs for gait g at time t (one cycle = g.period)."""
    ph = (t / g.period) % 1.0
    dy, dz, yaw, roll = g.hips(ph)
    b = HumanBody()
    lean_ = g.lean + lean_extra
    hy = HIP_Y - (0.012 if g.run else 0.006) + dy
    b.torso(V(0.0, hy, dz), ry(yaw) @ lean(lean_ * 0.45) @ rx(roll),
            spine=ry(-yaw * 0.6) @ lean(lean_ * 0.3) @ rx(-roll * 0.6),
            chest=ry(-yaw * 0.7) @ lean(lean_ * 0.25 + 0.02 * math.sin(TAU * 2 * ph)) @ rx(-roll * 0.3))
    legs_for_gait(b, g, ph, ANKLE_Y)
    # head: stabilised, looking ahead
    b.look(0.0, 0.06 if g.run else 0.02)
    return b, ph


# ---------------------------------------------------------------------------------------------------------
# rifle


def rifle_low(b, t=0.0, sway=1.0, raise_=0.0):
    """Low ready: across the body, muzzle forward-down-left (chest frame)."""
    n = noise1(t, 2.0, IDLE) * 0.012 * sway
    rot = wrot((0.78, -0.26 + raise_ * 0.25 + n, -0.57), (0.35, 0.93, 0.1))
    return chest_m(b, (0.046, -0.022 + raise_ * 0.02, 0.022), rot)


def rifle_port(b, t=0.0):
    """Port arms while running: across the chest, muzzle up-left."""
    rot = wrot((0.66, 0.16, -0.73), (0.25, 0.95, 0.15))
    return chest_m(b, (0.052, -0.012, 0.03), rot)


def rifle_shoulder(b, pitch=-0.04, kick_=0.0, climb=0.0, wob=(0.0, 0.0)):
    """Shouldered aim along world +X: the butt in the right shoulder pocket (chest frame), cheek to the stock."""
    fwd = V(math.cos(pitch + climb), math.sin(pitch + climb), 0.0)
    fwd = (ry(wob[0]) @ fwd)
    fwd.y += wob[1]
    rot = wrot(fwd)
    pocket = b.W['chest'] @ V(0.016, 0.047, 0.044)
    grip = pocket - rot @ V(RIFLE['butt']) - fwd * kick_
    return M4(grip, rot)


def aim_stance(t, crouch=False, breathe=1.0):
    if crouch:
        return kneel(t)
    return stand(t, yaw=-0.28, spine_yaw=-0.1, chest_yaw=-0.1, lean_=0.10, feet=((0.045, -0.032), (-0.03, 0.05)),
                 foot_yaw=(0.25, -0.5), breathe=breathe)


def kneel(t, breathe=1.0, yaw=-0.32):
    """Right knee down, left foot forward (kneeling fire)."""
    b = HumanBody()
    br = math.sin(t * TAU / BREATH) * breathe
    hp = V(-0.02, 0.112 + br * 0.0008, 0.012)
    b.torso(hp, ry(yaw) @ lean(0.06), spine=ry(-0.08) @ lean(0.04 + br * 0.006), chest=ry(-0.1) @ lean(0.05 - br * 0.01))
    b.leg('l', (0.085, ANKLE_Y, -0.036), ry(0.25), pole=V(1, 0.6, -0.1))
    b.leg('r', (-0.115, 0.03, 0.05), ry(-0.3) @ rz(-0.9), pole=V(0.4, -1, 0.0))
    return b


def look_at_aim(b, pitch=0.12):
    b.look(0.0, pitch)


def c_rifle_idle(t):
    shift = math.sin(t * TAU / IDLE)
    b = stand(t, hips=V(0.0, HIP_Y - 0.006, shift * 0.004), roll=-shift * 0.02, yaw=0.04)
    b.look(0.08 * math.sin(t * TAU / IDLE + 1), 0.04)
    hold(b, rifle_low(b, t), RIFLE)
    b.prop(None)
    return b.pose()


def c_rifle_idle2(t):
    """Look around: left, then right, back."""
    look = Keys([(0.0, 0.0), (0.7, 0.75), (1.6, 0.7), (2.2, -0.7), (3.1, -0.75), (3.6, 0.0), (4.0, 0.0)])(t)
    b = stand(t, yaw=look * 0.12, chest_yaw=look * 0.15)
    b.look(look, 0.02 - abs(look) * 0.03)
    hold(b, rifle_low(b, t), RIFLE)
    b.prop(None)
    return b.pose()


def c_rifle_idle3(t):
    """Shift weight and check the rifle (raise it, glance at it, lower it)."""
    up = Keys([(0.0, 0.0), (0.7, 1.0), (2.3, 1.0), (3.1, 0.0), (4.0, 0.0)])(t)
    shift = Keys([(0.0, 0.0), (0.8, 1.0), (2.8, 1.0), (3.8, 0.0), (4.0, 0.0)])(t)
    b = stand(t, hips=V(0.0, HIP_Y - 0.007, -0.006 * shift), roll=0.03 * shift)
    W = rifle_low(b, t, raise_=up)
    if up > 0:
        W = W @ M4((0, 0, 0), rx(-0.5 * up) @ rz(0.25 * up))
    b.look(0.25 * up, 0.35 * up + 0.03)
    hold(b, W, RIFLE)
    b.prop(None)
    return b.pose()


def c_rifle_walk(t):
    b, ph = gait_body(t, WALK)
    hold(b, rifle_low(b, t, sway=0.0), RIFLE)
    b.prop(None)
    return b.pose()


def c_rifle_run(t):
    b, ph = gait_body(t, RUN)
    W = rifle_port(b, t)
    W = W @ M4((0, 0.004 * math.sin(TAU * 2 * ph), 0), rz(0.05 * math.sin(TAU * 2 * ph)))
    hold(b, W, RIFLE)
    b.prop(None)
    return b.pose()


def c_rifle_aim(t, crouch=False):
    b = aim_stance(t, crouch)
    wob = (noise1(t, 1.0, 2.0) * 0.012, noise1(t, 4.0, 2.0) * 0.006)
    hold(b, rifle_shoulder(b, wob=wob), RIFLE, pole_r=chest_dir(b, (-0.3, -0.55, 0.8)), pole_l=chest_dir(b, (-0.1, -1.0, -0.15)))
    b.look(0.05, 0.2)
    b.prop(None)
    return b.pose()


def c_rifle_fire(t, crouch=False):
    k = kick(t, 0.0, 0.025, 0.22)
    # the shoulder takes the kick: chest rocks back, the muzzle climbs, everything settles back into the aim
    b = _aim_with_recoil(k, crouch)
    hold(b, rifle_shoulder(b, kick_=0.012 * k, climb=0.09 * k), RIFLE, pole_r=chest_dir(b, (-0.3, -0.55, 0.8)), pole_l=chest_dir(b, (-0.1, -1.0, -0.15)))
    b.look(0.05, 0.2 - 0.05 * k)
    b.prop(None)
    return b.pose()


def _aim_with_recoil(k, crouch):
    if crouch:
        b = HumanBody()
        hp = V(-0.02 - 0.004 * k, 0.112, 0.012)
        b.torso(hp, ry(-0.32) @ lean(0.06), spine=ry(-0.08) @ lean(0.04), chest=ry(-0.1) @ lean(0.05 - 0.06 * k))
        b.leg('l', (0.085, ANKLE_Y, -0.036), ry(0.25), pole=V(1, 0.6, -0.1))
        b.leg('r', (-0.115, 0.03, 0.05), ry(-0.3) @ rz(-0.9), pole=V(0.4, -1, 0.0))
        return b
    return stand(0.0, hips=V(-0.003 * k, HIP_Y - 0.005, 0.0), yaw=-0.28, spine_yaw=-0.1, chest_yaw=-0.1, lean_=0.10,
                 chest_lean=-0.06 * k, feet=((0.045, -0.032), (-0.03, 0.05)), foot_yaw=(0.25, -0.5), breathe=0.0)


def c_rifle_reload(t):
    """Tilt the rifle, swap the magazine with the left hand, charge it, back to the ready (1.6 s)."""
    tilt = Keys([(0.0, 0.0), (0.25, 1.0), (1.3, 1.0), (1.6, 0.0)])(t)
    b = stand(t, yaw=-0.12, lean_=0.06, chest_yaw=-0.05)
    W = rifle_low(b, t, sway=0.0, raise_=0.6 * tilt)
    W = W @ M4((0.0, 0.0, 0.0), rx(0.7 * tilt) @ rz(0.35 * tilt))
    mag = W @ V(RIFLE['mag'])
    pouch = b.W['chest'] @ V(0.05, -0.05, -0.035)
    # left hand path: grip -> magazine -> pouch -> magazine -> handguard
    k_mag = Keys([(0.0, 0.0), (0.3, 1.0), (0.45, 1.0), (0.7, 2.0), (0.85, 2.0), (1.1, 1.0), (1.25, 1.0), (1.5, 0.0)])(t)
    wr_g, f_g, p_g = grip_world(W, *RIFLE['grip_l'])
    hand_mag = (mag - V(0, 0.012, 0) - (W.to_3x3() @ V(0.0, 0.01, 0.0)))
    if k_mag <= 1:
        wr = wr_g.lerp(hand_mag, k_mag)
    else:
        wr = hand_mag.lerp(pouch, k_mag - 1)
    hr = b.hand_like('l', f_g.lerp(V(0.2, 0.9, 0.3), min(1, k_mag)), p_g.lerp(V(0.2, 0.3, 0.9), min(1, k_mag)))
    hold(b, W, RIFLE, left_free=(wr, hr, chest_dir(b, (-0.2, -0.9, -0.5))))
    b.look(0.25 * tilt, 0.35 * tilt + 0.04)
    b.prop(None)
    return b.pose()


# ---------------------------------------------------------------------------------------------------------
# flamethrower (hip-held wand)


def flamer_hip(b, sweep=0.0, kick_=0.0):
    rot = wrot(ry(sweep) @ V(1.0, -0.12 + kick_ * 0.05, 0.0))
    return M4(b.W['hips'].translation + b.R['hips'] @ V(0.052, 0.075, 0.034) + V(-0.004 * kick_, 0, 0), rot)


def c_flamer_aim(t):
    b = stand(t, yaw=-0.18, lean_=0.08, feet=((0.04, -0.035), (-0.03, 0.05)), foot_yaw=(0.2, -0.4), crouch=0.006)
    hold(b, flamer_hip(b, noise1(t, 3, 2.0) * 0.04), FLAMER)
    b.look(0.1, 0.1)
    b.prop(None)
    return b.pose()


def c_flamer_fire(t):
    """A sweeping burst (0.8 s): the wand sways across the target, the body braces."""
    sweep = math.sin(t / 0.8 * TAU) * 0.16
    k = 0.6 + 0.4 * math.sin(t * 40.0)
    b = stand(0.0, yaw=-0.18 + sweep * 0.4, lean_=0.12, feet=((0.04, -0.035), (-0.03, 0.05)), foot_yaw=(0.2, -0.4), crouch=0.008, breathe=0.0)
    hold(b, flamer_hip(b, sweep, k * 0.4), FLAMER)
    b.look(0.1 + sweep * 0.5, 0.1)
    b.prop(None)
    return b.pose()


# ---------------------------------------------------------------------------------------------------------
# launcher (rocket soldier: kneels to fire)


def launcher_shoulder(b, pitch=0.0, kick_=0.0):
    """Tube on the right shoulder, aimed along world +X."""
    fwd = V(math.cos(pitch), math.sin(pitch), 0.0)
    rot = wrot(fwd)
    sh = b.W['chest'] @ V(0.004, 0.052, 0.05)
    grip = sh - rot @ V(LAUNCHER['shoulder']) - fwd * kick_
    return M4(grip, rot)


def launcher_carry(b, t=0.0):
    """Carried on the right shoulder pointing forward-up."""
    rot = b.R['chest'] @ wrot((0.85, 0.5, -0.12))
    sh = b.W['chest'] @ V(0.0, 0.052, 0.05)
    grip = sh - rot @ V(LAUNCHER['shoulder'])
    return M4(grip, rot)


def c_launcher_idle(t):
    shift = math.sin(t * TAU / IDLE)
    b = stand(t, hips=V(0.0, HIP_Y - 0.006, shift * 0.004), roll=-shift * 0.02)
    b.look(0.1 * math.sin(t * TAU / IDLE + 1), 0.03)
    W = launcher_carry(b, t)
    hold(b, W, LAUNCHER, left=False)
    arms_down(b, swing_l=0.05)
    hold(b, W, LAUNCHER, left=False)
    b.prop(None)
    return b.pose()


def c_launcher_walk(t):
    b, ph = gait_body(t, WALK)
    W = launcher_carry(b, t)
    arms_down(b, swing_l=0.25 * math.cos(TAU * ph + math.pi) * -1)
    hold(b, W, LAUNCHER, left=False)
    b.prop(None)
    return b.pose()


def c_launcher_run(t):
    b, ph = gait_body(t, RUN)
    W = launcher_carry(b, t)
    arms_down(b, swing_l=-0.6 * math.cos(TAU * ph), bend=1.3)
    hold(b, W, LAUNCHER, left=False)
    b.prop(None)
    return b.pose()


def c_launcher_aim(t):
    b = kneel(t, yaw=-0.2)
    hold(b, launcher_shoulder(b, 0.03 + noise1(t, 5, 2.0) * 0.01), LAUNCHER, pole_r=chest_dir(b, (-0.3, -0.8, 0.5)), pole_l=chest_dir(b, (0.1, -1.0, -0.2)))
    b.look(0.12, 0.05)
    b.prop(None)
    return b.pose()


def c_launcher_fire(t):
    k = kick(t, 0.0, 0.02, 0.35)
    b = kneel(0.0, breathe=0.0, yaw=-0.2)
    b.torso(b.W['hips'].translation + V(-0.006 * k, 0, 0), b.R['hips'], spine=ry(-0.08) @ lean(0.04), chest=ry(-0.06) @ lean(0.05 - 0.08 * k))
    hold(b, launcher_shoulder(b, 0.03 + 0.08 * k, kick_=0.01 * k), LAUNCHER, pole_r=chest_dir(b, (-0.3, -0.8, 0.5)), pole_l=chest_dir(b, (0.1, -1.0, -0.2)))
    b.look(0.12, 0.05 - 0.06 * k)
    b.prop(None)
    return b.pose()


def c_launcher_reload(t):
    """Kneeling: tube down, a rocket from the back pack into the muzzle, tube back up (1.4 s)."""
    down = Keys([(0.0, 0.0), (0.25, 1.0), (1.1, 1.0), (1.4, 0.0)])(t)
    b = kneel(t, yaw=-0.2)
    W = launcher_shoulder(b, 0.03)
    if down > 0:
        Wl = M4(b.W['chest'] @ V(0.035, -0.07, 0.035), b.R['chest'] @ wrot((0.4, 0.9, -0.15), (-0.9, 0.4, 0.0)))
        r = slerp3(W.to_3x3(), Wl.to_3x3(), down)
        W = M4(W.translation.lerp(Wl.translation, down), r)
    reach = Keys([(0.0, 0.0), (0.3, 0.0), (0.55, 1.0), (0.8, 2.0), (1.0, 2.0), (1.3, 0.0)])(t)
    back = b.W['chest'] @ V(-0.035, -0.02, -0.07)
    muz = W @ (V(LAUNCHER['muzzle']) + V(0.01, 0.0, -0.02))
    wr_g, f_g, p_g = grip_world(W, *LAUNCHER['grip_l'])
    if reach <= 1:
        wr = wr_g.lerp(back, reach)
    else:
        wr = back.lerp(muz, reach - 1)
    hold(b, W, LAUNCHER, left_free=(wr, b.hand_like('l', V(0.3, 0.2, 0.9), V(0, 1, 0)), chest_dir(b, (-0.3, -0.8, -0.5))))
    b.look(0.2 * down, 0.2 * down + 0.05)
    b.prop(None)
    return b.pose()


# ---------------------------------------------------------------------------------------------------------
# pistols (Tanya)


def pistols(b, aim=1.0, kick_r=0.0, kick_l=0.0, t=0.0):
    """Both guns: aim=1 extended forward at eye level, 0 = held low at the hips."""
    out = []
    for side, kk in (('r', kick_r), ('l', kick_l)):
        s = 1 if side == 'r' else -1
        hi = V(0.115 - 0.01 * kk, 0.318 + 0.012 * kk, 0.03 * s)
        lo = b.W['hips'].translation + b.R['hips'] @ V(0.05, 0.0, 0.09 * s)
        p = lo.lerp(hi, smooth(aim))
        fwd = V(1.0, -0.1 + 0.25 * kk, 0.0).lerp(V(0.75, -0.65, 0.12 * s), 1 - smooth(aim)).normalized()
        out.append(M4(p, wrot(fwd)))
    return out


def hold_pistols(b, Wr, Wl, pole_r=None, pole_l=None):
    b.weapon(Wr)
    b.prop(Wl)
    wr, f, p = grip_world(Wr, *PISTOL['grip_r'])
    note_reach(b.arm_ik('r', wr, b.hand_like('r', f, p), pole_r if pole_r is not None else chest_dir(b, (-0.3, -0.9, 0.4))))
    wl, f, p = grip_world(Wl, *PISTOL['grip_l'])
    note_reach(b.arm_ik('l', wl, b.hand_like('l', f, p), pole_l if pole_l is not None else chest_dir(b, (-0.3, -0.9, -0.4))))


def c_pistol_idle(t):
    shift = math.sin(t * TAU / IDLE)
    b = stand(t, hips=V(0.0, HIP_Y - 0.006, shift * 0.005), roll=-shift * 0.025, feet=((0.01, -0.045), (-0.01, 0.048)))
    b.look(0.12 * math.sin(t * TAU / IDLE + 1.2), 0.02)
    Wr, Wl = pistols(b, 0.0)
    hold_pistols(b, Wr, Wl)
    return b.pose()


def c_pistol_walk(t):
    b, ph = gait_body(t, WALK)
    Wr, Wl = pistols(b, 0.0)
    sw = 0.012 * math.sin(TAU * ph)
    hold_pistols(b, Wr @ M4((sw, 0, 0)), Wl @ M4((-sw, 0, 0)))
    return b.pose()


def c_pistol_run(t):
    b, ph = gait_body(t, RUN)
    Wr, Wl = pistols(b, 0.35)
    sw = 0.02 * math.sin(TAU * ph)
    hold_pistols(b, Wr @ M4((sw, 0.01, 0)), Wl @ M4((-sw, 0.01, 0)))
    return b.pose()


def c_pistol_aim(t):
    b = stand(t, lean_=0.06, feet=((0.03, -0.045), (-0.02, 0.05)), foot_yaw=(0.2, -0.3), crouch=0.006)
    Wr, Wl = pistols(b, 1.0)
    w = noise1(t, 7, 2.0) * 0.006
    hold_pistols(b, Wr @ M4((0, w, 0)), Wl @ M4((0, -w, 0)), chest_dir(b, (-0.2, -1.0, 0.3)), chest_dir(b, (-0.2, -1.0, -0.3)))
    b.look(0.0, 0.08)
    return b.pose()


def _pistol_fire(t, right):
    k = kick(t, 0.0, 0.02, 0.16)
    b = stand(0.0, lean_=0.06, feet=((0.03, -0.045), (-0.02, 0.05)), foot_yaw=(0.2, -0.3), crouch=0.006, breathe=0.0,
              chest_yaw=0.06 * k * (1 if right else -1))
    Wr, Wl = pistols(b, 1.0, k if right else 0.0, 0.0 if right else k)
    hold_pistols(b, Wr, Wl, chest_dir(b, (-0.2, -1.0, 0.3)), chest_dir(b, (-0.2, -1.0, -0.3)))
    b.look(0.0, 0.08)
    return b.pose()


# ---------------------------------------------------------------------------------------------------------
# unarmed (engineer, medic, spy, thief, mechanic) and the grenadier


def c_unarmed_idle(t, prop='none'):
    shift = math.sin(t * TAU / IDLE)
    b = stand(t, hips=V(0.0, HIP_Y - 0.006, shift * 0.005), roll=-shift * 0.025)
    b.look(0.1 * math.sin(t * TAU / IDLE + 1), 0.03)
    arms_down(b, swing_l=0.02 * math.sin(t * TAU / IDLE), swing_r=-0.02 * math.sin(t * TAU / IDLE), bend=0.3)
    _unarmed_props(b)
    return b.pose()


def _unarmed_props(b):
    b.weapon(fist_r(b))
    prop_in_left(b)


def c_unarmed_idle2(t):
    look = Keys([(0.0, 0.0), (0.8, 0.8), (1.7, 0.75), (2.3, -0.75), (3.2, -0.8), (3.7, 0.0), (4.0, 0.0)])(t)
    b = stand(t, yaw=look * 0.12, chest_yaw=look * 0.15)
    b.look(look, 0.03)
    arms_down(b, bend=0.3)
    _unarmed_props(b)
    return b.pose()


def c_unarmed_idle3(t):
    """Stretch: roll the shoulders, hands on the hips, look up."""
    k = Keys([(0.0, 0.0), (0.8, 1.0), (2.8, 1.0), (3.6, 0.0), (4.0, 0.0)])(t)
    b = stand(t, lean_=0.03 - 0.06 * k, chest_lean=-0.05 * k)
    b.look(0.0, -0.25 * k + 0.03)
    for side in ('l', 'r'):
        s = 1 if side == 'r' else -1
        hipp = b.W['hips'].translation + b.R['hips'] @ V(0.0, 0.02, 0.06 * s)
        rest = b.W['chest'] @ V(0.02, -0.08, 0.075 * s)
        wr = rest.lerp(hipp + V(0.0, 0.0, 0.012 * s), k)
        note_reach(b.arm_ik(side, wr, b.hand_like(side, V(0.3, -0.6, -0.7 * s).lerp(V(0.2, -1, 0), 1 - k), V(-0.7, 0, -0.3 * s)), chest_dir(b, (-0.4, -0.2, 1.0 * s))))
    _unarmed_props(b)
    return b.pose()


def c_unarmed_walk(t):
    b, ph = gait_body(t, WALK)
    sw = 0.32 * math.cos(TAU * ph)
    arms_down(b, swing_l=-sw, swing_r=sw, bend=0.35)
    _unarmed_props(b)
    return b.pose()


def c_unarmed_run(t):
    b, ph = gait_body(t, RUN, lean_extra=0.03)
    sw = 0.62 * math.cos(TAU * ph)
    arms_down(b, swing_l=-sw, swing_r=sw, bend=1.25, out=0.12, bend_fwd=0.25)
    _unarmed_props(b)
    return b.pose()


def c_unarmed_use(t):
    """Kneel and work (repairs, first aid, wiring): alternating hand motions, 1.2 s loop."""
    b = HumanBody()
    hp = V(-0.01, 0.112, 0.012)
    b.torso(hp, ry(0.0) @ lean(0.3), spine=lean(0.18), chest=lean(0.14 + 0.03 * math.sin(t / 1.2 * TAU * 2)))
    b.leg('l', (0.085, ANKLE_Y, -0.036), ry(0.15), pole=V(1, 0.6, -0.1))
    b.leg('r', (-0.11, 0.03, 0.05), ry(-0.2) @ rz(-0.9), pole=V(0.4, -1, 0.0))
    b.look(0.0, 0.5)
    ph = t / 1.2 * TAU
    work = V(0.095, 0.1, 0.0)
    hr = work + V(0.012 * math.sin(ph * 2), 0.03 * max(0.0, math.sin(ph * 2)), 0.025)
    hl = work + V(0.01 * math.cos(ph), 0.008 * math.sin(ph), -0.03)
    note_reach(b.arm_ik('r', hr, b.hand_like('r', V(0.7, -0.6, -0.2), V(-0.2, -0.3, -0.9)), chest_dir(b, (-0.2, -0.8, 0.6))))
    note_reach(b.arm_ik('l', hl, b.hand_like('l', V(0.7, -0.6, 0.2), V(-0.2, -0.3, 0.9)), chest_dir(b, (-0.2, -0.8, -0.6))))
    _unarmed_props(b)
    return b.pose()


def grenade_cocked(b, t=0.0):
    """Right arm cocked back over the shoulder with the grenade, left arm pointing at the target."""
    hr = b.W['chest'] @ V(-0.055, 0.105, 0.075)
    note_reach(b.arm_ik('r', hr, b.hand_like('r', V(-0.2, 1.0, 0.1), V(0.6, 0.2, -0.7)), chest_dir(b, (-0.3, -0.4, 1.0))))
    hl = b.W['chest'] @ V(0.11, 0.05, -0.03)
    note_reach(b.arm_ik('l', hl, b.hand_like('l', V(1, 0.15, 0.1), V(0, -0.3, 1)), chest_dir(b, (-0.2, -0.8, -0.6))))


def c_grenade_aim(t):
    b = stand(t, yaw=-0.35, spine_yaw=-0.12, chest_yaw=-0.12, lean_=-0.02, feet=((0.05, -0.03), (-0.04, 0.05)), foot_yaw=(0.3, -0.6))
    grenade_cocked(b, t)
    b.look(0.0, 0.05)
    b.weapon(fist_r(b))
    prop_in_left(b)
    return b.pose()


def c_grenade_throw(t):
    """Whip the arm over (release at 0.16 s), follow through, a new grenade from the belt, cock again (0.9 s)."""
    k = Keys([(0.0, 0.0), (0.07, -0.1), (0.2, 1.0, 'out'), (0.4, 1.15), (0.75, 0.0)])(t)
    tw = Keys([(0.0, 0.0), (0.07, -0.15), (0.22, 1.0, 'out'), (0.45, 1.0), (0.8, 0.0)])(t)
    b = stand(0.0, yaw=-0.35 + 0.55 * tw, spine_yaw=-0.12 + 0.2 * tw, chest_yaw=-0.12 + 0.25 * tw, lean_=-0.02 + 0.22 * max(0, tw),
              feet=((0.05, -0.03), (-0.04, 0.05)), foot_yaw=(0.3, -0.6), breathe=0.0)
    cocked = b.W['chest'] @ V(-0.055, 0.105, 0.075)
    over = b.W['chest'] @ V(0.06, 0.12, 0.05)
    down = b.W['chest'] @ V(0.07, -0.04, 0.0)
    if k < 0:
        hr = cocked + V(-0.01 * -k / 0.1, 0, 0)
    elif k <= 1:
        hr = cocked.lerp(over, min(1, k * 1.6)).lerp(down, max(0, k - 0.6) / 0.4)
    else:
        hr = down
    if t > 0.45:
        hr = hr.lerp(cocked, smooth((t - 0.45) / 0.3))
    note_reach(b.arm_ik('r', hr, b.hand_like('r', V(-0.2, 1.0, 0.1).lerp(V(1, -0.5, 0), smooth(k)), V(0.6, 0.2, -0.7).lerp(V(0, -0.5, -0.8), smooth(k))), chest_dir(b, (-0.3, -0.4, 1.0))))
    hl = (b.W['chest'] @ V(0.11, 0.05, -0.03)).lerp(b.W['chest'] @ V(-0.01, -0.07, -0.08), smooth(max(0, k)))
    note_reach(b.arm_ik('l', hl, b.hand_like('l', V(1, 0.15, 0.1), V(0, -0.3, 1)), chest_dir(b, (-0.2, -0.8, -0.6))))
    b.look(0.3 * tw, 0.05)
    # the grenade leaves the hand at the release and a new one appears from the belt
    vis = 0.0 if 0.16 <= t < 0.55 else (smooth((t - 0.55) / 0.12) if t < 0.67 else 1.0)
    b.weapon(fist_r(b), vis if vis > 0.001 else 0.0)
    prop_in_left(b)
    return b.pose()


# ---------------------------------------------------------------------------------------------------------
# paratrooper


def c_para(t):
    sw = math.sin(t * TAU / 2.0)
    b = HumanBody()
    b.torso(V(0.0, HIP_Y, 0.0), rx(0.03 * sw) @ lean(-0.04), spine=lean(0.0), chest=lean(-0.02))
    for side in ('l', 'r'):
        s = 1 if side == 'r' else -1
        wr = b.W['chest'] @ V(-0.005, 0.15, 0.055 * s)
        note_reach(b.arm_ik(side, wr, b.hand_like(side, V(0, 1, 0), V(0.0, 0.0, -s)), chest_dir(b, (-0.3, -0.2, 1.0 * s))))
    kick_ = math.sin(t * TAU / 2.0 + 0.6)
    b.leg('l', (0.015 + 0.012 * kick_, 0.03, -0.03), lean(-0.4), pole=V(1, 0, 0))
    b.leg('r', (0.005 - 0.012 * kick_, 0.036, 0.03), lean(-0.35), pole=V(1, 0, 0))
    b.look(0.25 * math.sin(t * TAU / 2.0 + 2), 0.15)
    # the rifle slung across the chest
    b.weapon(chest_m(b, (0.04, -0.02, 0.0), wrot((0.4, -0.75, -0.55), (0.6, 0.4, 0.7))))
    b.prop(None)
    return b.pose()


# ---------------------------------------------------------------------------------------------------------
# deaths (full-body, end lying on the ground; the game may hand 'blown' to its ragdoll at the start)


def _weapon_ground(x, z, yaw):
    return M4(V(x, 0.011, z), ry(yaw) @ rx(math.pi / 2))


class DeathKeys:
    """Key poses of a death: hips (pos, euler world: yaw, lean, roll), spine/chest lean, neck/head turn,
    feet (pos, foot lean), arms (upper dir in world, bend)."""

    def __init__(self, keys):
        self.k = {name: Keys([(t, v) for t, v in pts]) for name, pts in keys.items()}

    def __call__(self, name, t):
        return self.k[name](t)


def death_pose(t, K, weapon_from=None, weapon_to=None, drop=(0.15, 0.5), set_='rifle'):
    hp = V(K('hips', t))
    hr = K('hrot', t)
    sp = K('spine', t)
    ch = K('chest', t)
    hd = K('head', t)
    b = HumanBody()
    b.torso(hp, ry(hr[0]) @ lean(hr[1]) @ rx(hr[2]), spine=lean(sp[0]) @ rx(sp[1]), chest=lean(ch[0]) @ rx(ch[1]),
            head=ry(hd[0]) @ lean(hd[1]) @ rx(hd[2]))
    for side in ('l', 'r'):
        f = K('foot_' + side, t)
        b.leg(side, (f[0], f[1], f[2]), ry(hr[0]) @ lean(f[3]), pole=b.R['hips'] @ V(1, 0.15 * f[4], 0) if len(f) > 4 else None)
    for side in ('l', 'r'):
        a = K('arm_' + side, t)
        d = V(a[0], a[1], a[2])
        b.arm_fk(side, d, a[3])
    # the weapon drops out of the hand
    if weapon_from is not None and weapon_to is not None:
        Wh = weapon_from(b)
        b.weapon(dropped(t, drop[0], drop[1], Wh, weapon_to))
    else:
        b.weapon(fist_r(b))
    prop_in_left(b)
    return b.pose()


def held_rifle(b):
    hw = b.W['hand_r']
    # the grip in the right hand (inverse of grip_r)
    wr, f, p = RIFLE['grip_r']
    R = b.hand_like('r', V(f), V(p))
    # weapon rotation such that hand = W_rot @ grip-frame: approximate with the hand's rotation relative to the rest grip
    Wrot = hw.to_3x3().normalized() @ R.transposed()
    pos = hw.translation - Wrot @ V(wr)
    return M4(pos, Wrot)


def _death_back():
    D = 1.3
    K = DeathKeys({
        'hips': [(0.0, (0.0, HIP_Y - 0.005, 0.0)), (0.12, (-0.012, HIP_Y - 0.004, 0.0)), (0.35, (-0.05, 0.13, 0.0)),
                 (0.62, (-0.12, 0.034, 0.004)), (0.72, (-0.125, 0.04, 0.004)), (0.85, (-0.13, 0.033, 0.004)), (D, (-0.13, 0.033, 0.004))],
        'hrot': [(0.0, (0.0, 0.03, 0.0)), (0.12, (0.05, -0.12, 0.0)), (0.35, (0.12, -0.6, 0.05)), (0.62, (0.18, -1.52, 0.08)),
                 (0.72, (0.18, -1.45, 0.08)), (0.85, (0.18, -1.55, 0.08)), (D, (0.18, -1.55, 0.08))],
        'spine': [(0.0, (0.0, 0.0)), (0.12, (-0.25, 0.0)), (0.35, (0.1, 0.0)), (0.62, (0.0, 0.0)), (D, (-0.04, 0.0))],
        'chest': [(0.0, (0.0, 0.0)), (0.12, (-0.25, 0.05)), (0.35, (0.15, 0.0)), (0.62, (0.0, 0.0)), (0.72, (0.1, 0.0)), (D, (-0.03, 0.0))],
        'head': [(0.0, (0.0, 0.0, 0.0)), (0.12, (0.0, -0.4, 0.0)), (0.35, (0.0, 0.35, 0.0)), (0.62, (0.0, -0.2, 0.0)),
                 (0.75, (0.3, 0.2, 0.4)), (D, (0.45, 0.0, 0.5))],
        'foot_l': [(0.0, (0.012, ANKLE_Y, -0.04, 0.0)), (0.35, (0.03, ANKLE_Y, -0.045, 0.2)), (0.62, (0.04, 0.03, -0.06, 0.5, 1)), (D, (0.03, 0.028, -0.065, 0.6, 1))],
        'foot_r': [(0.0, (-0.01, ANKLE_Y, 0.044, 0.0)), (0.2, (0.02, 0.05, 0.05, 0.1)), (0.62, (0.0, 0.05, 0.075, 0.6, 1)), (D, (-0.01, 0.034, 0.08, 0.7, 1))],
        'arm_l': [(0.0, (0.1, -0.9, -0.3, 0.6)), (0.12, (0.2, -0.3, -0.9, 0.3)), (0.4, (-0.5, 0.4, -0.8, 0.5)), (0.62, (-0.3, -0.15, -1.0, 0.4)), (D, (-0.25, -0.2, -1.0, 0.5))],
        'arm_r': [(0.0, (0.1, -0.9, 0.3, 0.6)), (0.12, (0.3, -0.1, 0.9, 0.4)), (0.4, (-0.4, 0.5, 0.8, 0.6)), (0.62, (-0.1, -0.2, 1.0, 0.3)), (D, (0.0, -0.25, 1.0, 0.6))],
    })
    return D, K


def _death_front():
    D = 1.5
    K = DeathKeys({
        'hips': [(0.0, (0.0, HIP_Y - 0.005, 0.0)), (0.15, (0.008, HIP_Y - 0.01, 0.0)), (0.5, (0.02, 0.1, 0.0)),
                 (0.8, (0.06, 0.08, 0.0)), (1.05, (0.12, 0.034, 0.0)), (1.15, (0.125, 0.038, 0.0)), (D, (0.125, 0.032, 0.0))],
        'hrot': [(0.0, (0.0, 0.03, 0.0)), (0.15, (0.0, 0.25, 0.0)), (0.5, (-0.1, 0.35, -0.05)), (0.8, (-0.15, 0.9, -0.1)),
                 (1.05, (-0.2, 1.5, -0.1)), (D, (-0.2, 1.52, -0.1))],
        'spine': [(0.0, (0.0, 0.0)), (0.15, (0.35, 0.0)), (0.5, (0.3, 0.0)), (0.8, (0.2, 0.0)), (1.05, (0.0, 0.0)), (D, (0.02, 0.0))],
        'chest': [(0.0, (0.0, 0.0)), (0.15, (0.3, 0.0)), (0.5, (0.25, 0.0)), (1.05, (0.05, 0.0)), (D, (0.05, 0.0))],
        'head': [(0.0, (0.0, 0.0, 0.0)), (0.15, (0.0, 0.4, 0.0)), (0.8, (0.0, 0.2, 0.0)), (1.05, (0.5, -0.3, -0.6)), (D, (0.6, -0.4, -0.7))],
        'foot_l': [(0.0, (0.012, ANKLE_Y, -0.04, 0.0)), (0.5, (-0.04, 0.03, -0.045, -0.9, -1)), (1.05, (-0.13, 0.03, -0.05, -1.4, -1)), (D, (-0.14, 0.028, -0.055, -1.4, -1))],
        'foot_r': [(0.0, (-0.01, ANKLE_Y, 0.044, 0.0)), (0.5, (-0.06, 0.03, 0.05, -0.9, -1)), (1.05, (-0.15, 0.03, 0.06, -1.4, -1)), (D, (-0.155, 0.03, 0.065, -1.4, -1))],
        'arm_l': [(0.0, (0.1, -0.9, -0.3, 0.6)), (0.15, (0.4, -0.8, -0.2, 1.2)), (0.8, (0.6, -0.8, -0.3, 0.4)), (1.05, (0.8, -0.2, -0.6, 0.6)), (D, (0.7, -0.25, -0.65, 0.8))],
        'arm_r': [(0.0, (0.1, -0.9, 0.3, 0.6)), (0.15, (0.4, -0.8, 0.2, 1.4)), (0.8, (0.5, -0.8, 0.4, 0.3)), (1.05, (0.2, -0.3, 0.95, 0.2)), (D, (0.1, -0.3, 1.0, 0.3))],
    })
    return D, K


def _death_blown():
    """Thrown back and up, a half tumble, landing on the back (the game's ragdoll usually takes over at t = 0)."""
    D = 1.4
    K = DeathKeys({
        'hips': [(0.0, (0.0, HIP_Y - 0.005, 0.0)), (0.1, (-0.04, 0.24, 0.0)), (0.35, (-0.17, 0.33, 0.01)), (0.65, (-0.3, 0.1, 0.02)),
                 (0.75, (-0.33, 0.06, 0.02)), (0.85, (-0.34, 0.04, 0.02)), (D, (-0.35, 0.033, 0.02))],
        'hrot': [(0.0, (0.0, 0.03, 0.0)), (0.1, (0.0, -0.4, 0.0)), (0.35, (0.2, -1.4, 0.2)), (0.65, (0.25, -1.9, 0.2)), (0.75, (0.25, -1.65, 0.15)),
                 (0.85, (0.25, -1.5, 0.12)), (D, (0.25, -1.55, 0.12))],
        'spine': [(0.0, (0.0, 0.0)), (0.1, (-0.3, 0.0)), (0.35, (0.3, 0.0)), (0.65, (0.2, 0.0)), (D, (-0.02, 0.0))],
        'chest': [(0.0, (0.0, 0.0)), (0.1, (-0.3, 0.1)), (0.35, (0.3, 0.0)), (0.65, (0.1, 0.0)), (D, (-0.03, 0.0))],
        'head': [(0.0, (0.0, 0.0, 0.0)), (0.1, (0.0, -0.6, 0.0)), (0.35, (0.0, 0.4, 0.0)), (0.75, (0.2, -0.2, 0.3)), (D, (0.6, 0.0, 0.6))],
        'foot_l': [(0.0, (0.012, ANKLE_Y, -0.04, 0.0)), (0.1, (0.0, 0.09, -0.06, 0.3)), (0.35, (-0.02, 0.24, -0.07, 0.6, 1)), (0.65, (-0.05, 0.1, -0.07, 0.6, 1)), (0.8, (-0.12, 0.03, -0.075, 0.6, 1)), (D, (-0.13, 0.03, -0.08, 0.6, 1))],
        'foot_r': [(0.0, (-0.01, ANKLE_Y, 0.044, 0.0)), (0.1, (-0.03, 0.08, 0.06, 0.3)), (0.35, (-0.05, 0.26, 0.07, 0.6, 1)), (0.65, (-0.08, 0.12, 0.08, 0.6, 1)), (0.8, (-0.15, 0.035, 0.08, 0.7, 1)), (D, (-0.16, 0.034, 0.085, 0.7, 1))],
        'arm_l': [(0.0, (0.1, -0.9, -0.3, 0.6)), (0.1, (-0.2, 0.4, -0.9, 0.3)), (0.35, (-0.6, 0.6, -0.6, 0.6)), (0.7, (-0.4, -0.1, -1.0, 0.3)), (D, (-0.3, -0.25, -1.0, 0.4))],
        'arm_r': [(0.0, (0.1, -0.9, 0.3, 0.6)), (0.1, (-0.2, 0.5, 0.85, 0.3)), (0.35, (-0.5, 0.7, 0.6, 0.6)), (0.7, (-0.3, -0.1, 1.0, 0.3)), (D, (-0.2, -0.25, 1.0, 0.5))],
    })
    return D, K


def _death_burn():
    """Stagger and flail in the flames (to 1.3 s), drop to the knees, collapse forward."""
    D = 2.4
    base = _death_front()[1]
    flail = lambda t, ph: math.sin(t * 13 + ph) * max(0.0, 1 - max(0.0, t - 1.2) / 0.4)  # noqa: E731

    def fn_keys(t):
        return base
    K = DeathKeys({
        'hips': [(0.0, (0.0, HIP_Y - 0.005, 0.0)), (0.4, (0.03, HIP_Y - 0.012, 0.02)), (0.8, (0.04, HIP_Y - 0.015, -0.02)),
                 (1.2, (0.06, HIP_Y - 0.02, 0.0)), (1.6, (0.08, 0.1, 0.0)), (2.0, (0.14, 0.034, 0.0)), (2.1, (0.145, 0.038, 0.0)), (D, (0.145, 0.032, 0.0))],
        'hrot': [(0.0, (0.0, 0.03, 0.0)), (0.4, (0.5, 0.2, 0.1)), (0.8, (-0.4, 0.25, -0.1)), (1.2, (0.2, 0.3, 0.0)), (1.6, (0.1, 0.5, 0.0)),
                 (2.0, (0.1, 1.5, -0.05)), (D, (0.1, 1.52, -0.05))],
        'spine': [(0.0, (0.0, 0.0)), (0.4, (-0.2, 0.2)), (0.8, (0.3, -0.2)), (1.2, (0.2, 0.1)), (1.6, (0.3, 0.0)), (2.0, (0.0, 0.0)), (D, (0.02, 0.0))],
        'chest': [(0.0, (0.0, 0.0)), (0.4, (-0.3, 0.2)), (0.8, (0.3, -0.25)), (1.2, (0.1, 0.0)), (1.6, (0.3, 0.0)), (2.0, (0.05, 0.0)), (D, (0.05, 0.0))],
        'head': [(0.0, (0.0, 0.0, 0.0)), (0.4, (0.6, -0.5, 0.2)), (0.8, (-0.6, -0.3, -0.2)), (1.2, (0.3, 0.3, 0.0)), (2.0, (-0.5, -0.3, 0.6)), (D, (-0.6, -0.4, 0.7))],
        'foot_l': [(0.0, (0.012, ANKLE_Y, -0.04, 0.0)), (0.3, (0.05, ANKLE_Y, -0.05, 0.0)), (0.6, (0.06, 0.05, -0.04, 0.0)), (0.9, (0.09, ANKLE_Y, -0.03, 0.0)),
                   (1.6, (-0.03, 0.03, -0.045, -0.9, -1)), (2.0, (-0.11, 0.03, -0.05, -1.4, -1)), (D, (-0.12, 0.028, -0.055, -1.4, -1))],
        'foot_r': [(0.0, (-0.01, ANKLE_Y, 0.044, 0.0)), (0.45, (0.06, 0.05, 0.05, 0.0)), (0.7, (0.1, ANKLE_Y, 0.04, 0.0)), (1.1, (0.07, ANKLE_Y, 0.05, 0.0)),
                   (1.6, (-0.05, 0.03, 0.05, -0.9, -1)), (2.0, (-0.13, 0.03, 0.06, -1.4, -1)), (D, (-0.135, 0.03, 0.065, -1.4, -1))],
        'arm_l': [(0.0, (0.1, -0.9, -0.3, 0.6)), (0.2, (0.2, 0.8, -0.5, 1.4)), (0.5, (0.5, 0.5, -0.6, 0.6)), (0.8, (-0.2, 0.9, -0.3, 1.2)), (1.1, (0.4, 0.7, -0.5, 1.6)),
                  (1.6, (0.6, -0.6, -0.4, 0.6)), (2.0, (0.8, -0.2, -0.6, 0.6)), (D, (0.7, -0.25, -0.65, 0.8))],
        'arm_r': [(0.0, (0.1, -0.9, 0.3, 0.6)), (0.25, (0.4, 0.6, 0.5, 1.2)), (0.55, (-0.2, 0.9, 0.3, 1.5)), (0.85, (0.5, 0.6, 0.5, 0.8)), (1.15, (0.0, 0.9, 0.4, 1.6)),
                  (1.6, (0.5, -0.7, 0.4, 0.5)), (2.0, (0.2, -0.3, 0.95, 0.2)), (D, (0.1, -0.3, 1.0, 0.3))],
    })
    del flail, fn_keys
    return D, K


def _death_electro():
    """Rigid spasm (back arched, arms stiff and out) for 0.7 s, then a stiff collapse backwards."""
    D = 1.6
    K = DeathKeys({
        'hips': [(0.0, (0.0, HIP_Y - 0.005, 0.0)), (0.1, (0.0, HIP_Y + 0.004, 0.0)), (0.7, (-0.005, HIP_Y + 0.004, 0.0)), (1.0, (-0.06, 0.12, 0.0)),
                 (1.25, (-0.13, 0.034, 0.0)), (1.35, (-0.135, 0.04, 0.0)), (D, (-0.135, 0.033, 0.0))],
        'hrot': [(0.0, (0.0, 0.03, 0.0)), (0.1, (0.0, -0.12, 0.0)), (0.7, (0.0, -0.16, 0.0)), (1.0, (0.05, -0.8, 0.0)), (1.25, (0.05, -1.55, 0.0)), (D, (0.05, -1.55, 0.0))],
        'spine': [(0.0, (0.0, 0.0)), (0.1, (-0.3, 0.0)), (0.7, (-0.32, 0.0)), (1.0, (-0.1, 0.0)), (D, (-0.05, 0.0))],
        'chest': [(0.0, (0.0, 0.0)), (0.1, (-0.3, 0.0)), (0.7, (-0.32, 0.0)), (1.0, (-0.1, 0.0)), (D, (-0.05, 0.0))],
        'head': [(0.0, (0.0, 0.0, 0.0)), (0.1, (0.0, -0.6, 0.0)), (0.7, (0.0, -0.65, 0.0)), (1.25, (0.3, 0.0, 0.3)), (D, (0.35, 0.0, 0.35))],
        'foot_l': [(0.0, (0.012, ANKLE_Y, -0.04, 0.0)), (0.7, (0.012, ANKLE_Y, -0.045, 0.0)), (1.25, (0.03, 0.03, -0.05, 0.6, 1)), (D, (0.03, 0.03, -0.05, 0.6, 1))],
        'foot_r': [(0.0, (-0.01, ANKLE_Y, 0.044, 0.0)), (0.7, (-0.01, ANKLE_Y, 0.05, 0.0)), (1.25, (0.02, 0.03, 0.06, 0.6, 1)), (D, (0.02, 0.03, 0.06, 0.6, 1))],
        'arm_l': [(0.0, (0.1, -0.9, -0.3, 0.6)), (0.1, (0.1, -0.2, -1.0, 0.05)), (0.7, (0.1, -0.15, -1.0, 0.05)), (1.25, (-0.3, -0.2, -1.0, 0.3)), (D, (-0.3, -0.25, -1.0, 0.35))],
        'arm_r': [(0.0, (0.1, -0.9, 0.3, 0.6)), (0.1, (0.1, -0.2, 1.0, 0.05)), (0.7, (0.1, -0.15, 1.0, 0.05)), (1.25, (-0.2, -0.2, 1.0, 0.3)), (D, (-0.2, -0.25, 1.0, 0.35))],
    })
    return D, K


def death_clip(name, maker, set_weapon=True, jitter=0.0):
    D, K = maker()
    wg = _weapon_ground(0.03, 0.12, 0.4) if name != 'death.front' else _weapon_ground(0.06, 0.1, -0.3)

    def fn(t):
        tt = t
        if jitter and t < 0.7:
            # electric spasm: high-frequency tremor on top of the key poses
            tt = t
        p = death_pose(tt, K, held_rifle if set_weapon else None, wg if set_weapon else None)
        if jitter and t < 0.7:
            j = jitter * math.sin(t * 90.0)
            for n in ('hips', 'spine', 'chest'):
                m = p[n].copy()
                m.translation.x += j * 0.004
                p[n] = m
        return p
    return Clip(name, D, fn, loop=False, fps=20)


# ---------------------------------------------------------------------------------------------------------


def clips():
    C = []

    def add(name, dur, fn, loop=False, fps=20, **meta):
        C.append(Clip(name, dur, (lambda f, n: (lambda t: (_CUR.__setitem__(0, n), f(t))[1]))(fn, name), loop=loop, fps=fps, **meta))

    add('rifle.idle', IDLE, c_rifle_idle, True, 10)
    add('rifle.idle2', 4.0, c_rifle_idle2, True, 10)
    add('rifle.idle3', IDLE, c_rifle_idle3, True, 10)
    add('rifle.walk', WALK.period, c_rifle_walk, True, 20, stride=WALK.stride)
    add('rifle.run', RUN.period, c_rifle_run, True, 24, stride=RUN.stride)
    add('rifle.aim', 2.0, c_rifle_aim, True, 10)
    add('rifle.fire', 0.35, c_rifle_fire, False, 30, shot=0.0)
    add('rifle.crouch_aim', 2.0, lambda t: c_rifle_aim(t, True), True, 10)
    add('rifle.crouch_fire', 0.35, lambda t: c_rifle_fire(t, True), False, 30, shot=0.0)
    add('rifle.reload', 1.6, c_rifle_reload, False, 20)
    add('flamer.aim', 2.0, c_flamer_aim, True, 10)
    add('flamer.fire', 0.8, c_flamer_fire, True, 24)
    add('launcher.idle', IDLE, c_launcher_idle, True, 10)
    add('launcher.walk', WALK.period, c_launcher_walk, True, 20, stride=WALK.stride)
    add('launcher.run', RUN.period, c_launcher_run, True, 24, stride=RUN.stride)
    add('launcher.aim', 2.0, c_launcher_aim, True, 10)
    add('launcher.fire', 0.5, c_launcher_fire, False, 30, shot=0.0)
    add('launcher.reload', 1.4, c_launcher_reload, False, 20)
    add('pistol.idle', IDLE, c_pistol_idle, True, 10)
    add('pistol.walk', WALK.period, c_pistol_walk, True, 20, stride=WALK.stride)
    add('pistol.run', RUN.period, c_pistol_run, True, 24, stride=RUN.stride)
    add('pistol.aim', 2.0, c_pistol_aim, True, 10)
    add('pistol.fire', 0.3, lambda t: _pistol_fire(t, True), False, 30, shot=0.0)
    add('pistol.fire2', 0.3, lambda t: _pistol_fire(t, False), False, 30, shot=0.0)
    add('unarmed.idle', IDLE, c_unarmed_idle, True, 10)
    add('unarmed.idle2', 4.0, c_unarmed_idle2, True, 10)
    add('unarmed.idle3', IDLE, c_unarmed_idle3, True, 10)
    add('unarmed.walk', WALK.period, c_unarmed_walk, True, 20, stride=WALK.stride)
    add('unarmed.run', RUN.period, c_unarmed_run, True, 24, stride=RUN.stride)
    add('unarmed.use', 1.2, c_unarmed_use, True, 15)
    add('grenade.aim', 2.0, c_grenade_aim, True, 10)
    add('grenade.throw', 0.9, c_grenade_throw, False, 30, release=0.16)
    add('para', 2.0, c_para, True, 10)
    for name, mk, jit in (('death.back', _death_back, 0.0), ('death.front', _death_front, 0.0), ('death.blown', _death_blown, 0.0),
                          ('death.burn', _death_burn, 0.0), ('death.electro', _death_electro, 1.0)):
        c = death_clip(name, mk, jitter=jit)
        add(name, c.duration, c.fn, False, 20)
    return C
