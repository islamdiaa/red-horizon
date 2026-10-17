"""Rock layouts shared by the plain and snow variants (rock_outcrop / rock_wall / boulder [_snow])."""
from _nature import *  # noqa: F401,F403


def outcrop(m, snow=False):
    """Layered outcrop: four stacked slabs stepping back unevenly, flat-ish tops, ~1.0 wide, ~0.55 high."""
    m.set_meta(height=0.56, radius=0.5)
    m.look(dirt_h=0.05, ao_distance=0.28)
    st = stone(tex='cliff_side', scale=1.6, seed=1, snow=1.0 if snow else 0.0)
    cap = snow_mat(1) if snow else None
    strata(m, [
        (-0.08, 0.15, 0.5, 0.43, (0.0, 0.0), None, 0.12),
        (0.135, 0.3, 0.42, 0.36, (-0.05, 0.04), None, 0.14),
        (0.285, 0.44, 0.31, 0.27, (-0.02, -0.04), None, 0.15),
        (0.425, 0.555, 0.19, 0.17, (-0.08, 0.0), None, 0.16),
    ], st, snow=snow, cap_mat=cap, seed=1)
    debris(m, st, [((0.43, 0.02, 0.25), (0.16, 0.14, 0.13)), ((-0.36, 0.01, -0.33), (0.13, 0.1, 0.12))], seed=1,
           snow=0.8 if snow else 0.0)


def wall(m, snow=False):
    """Cliff-edge wall segment: elongated strata ~1.4 long (x) x 0.8 deep (z) x 0.8 high, a steep face on +Z
    (the strata fronts nearly flush), stepping down towards the back."""
    m.set_meta(height=0.8, radius=0.7)
    m.look(dirt_h=0.05, ao_distance=0.3)
    st = stone(tex='cliff_side', scale=1.5, seed=2, snow=1.0 if snow else 0.0)
    cap = snow_mat(2) if snow else None
    strata(m, [
        (-0.1, 0.19, 0.7, 0.4, (0.0, 0.0), 0.36, 0.08),
        (0.18, 0.39, 0.66, 0.34, (0.02, 0.05), 0.38, 0.09),
        (0.38, 0.59, 0.58, 0.28, (-0.03, 0.1), 0.37, 0.1),
        (0.58, 0.79, 0.45, 0.22, (0.04, 0.14), 0.35, 0.12),
    ], st, snow=snow, cap_mat=cap, seed=2, n=15)
    debris(m, st, [((0.5, 0.02, 0.48), (0.17, 0.15, 0.14)), ((-0.42, 0.01, 0.5), (0.12, 0.1, 0.1))], seed=2,
           snow=0.8 if snow else 0.0)


def boulders(m, snow=False):
    """Chunky boulder cluster: one big rock and three smaller ones, ~1.0 wide, ~0.6 high."""
    m.set_meta(height=0.6, radius=0.52)
    m.look(dirt_h=0.05, ao_distance=0.28)
    st = stone(tex='rock_face', scale=1.3, band=0.05, contrast=1.3, seed=3, snow=1.0 if snow else 0.0, cracks=0.8)
    sn = 1.0 if snow else 0.0
    hull_rock(m.root, st, (0.04, 0.1, -0.02), (0.82, 1.0, 0.74), 31, npts=24, cuts=1, amp=0.045, shade=1.0, snow=sn, yaw=0.3)
    hull_rock(m.root, st, (-0.36, 0.04, 0.24), (0.36, 0.44, 0.34), 32, npts=16, cuts=1, amp=0.05, shade=0.9, snow=sn, yaw=1.1)
    hull_rock(m.root, st, (0.38, 0.03, 0.28), (0.3, 0.32, 0.28), 33, npts=14, cuts=1, amp=0.05, shade=1.08, snow=sn, yaw=2.3)
    hull_rock(m.root, st, (-0.25, 0.03, -0.36), (0.28, 0.34, 0.26), 34, npts=14, cuts=1, amp=0.05, shade=0.95, snow=sn, yaw=0.7)
