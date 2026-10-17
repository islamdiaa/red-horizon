"""Shared infantry weapon / prop geometry constants (weapon-bone local frames) used by both the soldier models
(_soldier.py builds the meshes around them) and the clips (_clips.py puts the hands on the grips).

Weapon-bone frame: origin = the right hand's grip point (palm centre on the pistol grip), +X = the barrel / tube
direction, +Y = the weapon's top. Grips: (wrist position, fingers direction, palm normal) in that frame.
Model units (the soldier is ~0.385 tall).
"""

# assault rifle (AK-47 / M16): grip at the origin, bore at y = +0.02
RIFLE = {
    'grip_r': ((-0.010, -0.011, 0.004), (0.55, -0.83, 0.0), (0.0, 0.0, -1.0)),
    'grip_l': ((0.060, -0.006, -0.010), (0.45, 0.30, 0.84), (0.0, 0.70, 0.70)),
    'butt': (-0.078, 0.006, 0.0),
    'muzzle': (0.158, 0.021, 0.0),
    'mag': (0.030, -0.030, 0.0),
}

# shock trooper's tesla gun: rifle-like, a little shorter
TESLA = dict(RIFLE, muzzle=(0.150, 0.022, 0.0))

# flamethrower wand: held at the hip, long nozzle
FLAMER = {
    'grip_r': ((-0.010, -0.011, 0.004), (0.55, -0.83, 0.0), (0.0, 0.0, -1.0)),
    'grip_l': ((0.052, -0.010, -0.010), (0.40, 0.30, 0.86), (0.0, 0.70, 0.70)),
    'butt': (-0.05, 0.004, 0.0),
    'muzzle': (0.17, 0.012, 0.0),
}

# shoulder-fired launcher (RPG-7 / Dragon): the right hand on the trigger grip (origin), the tube above it
LAUNCHER = {
    'grip_r': ((-0.010, -0.012, 0.004), (0.50, -0.86, 0.0), (0.0, 0.0, -1.0)),
    'grip_l': ((0.065, -0.012, -0.008), (0.50, -0.80, 0.30), (0.0, 0.0, 1.0)),
    'tube_y': 0.034,       # tube axis height over the grip
    'tube_r': 0.019,
    'shoulder': (-0.045, 0.012, 0.0),  # where the tube rests on the shoulder (its underside)
    'muzzle': (0.15, 0.034, 0.0),
    'rear': (-0.15, 0.034, 0.0),
}

# pistol (Tanya; one per hand: weapon = right, prop = left)
PISTOL = {
    'grip_r': ((-0.008, -0.010, 0.003), (0.50, -0.86, 0.0), (0.0, 0.0, -1.0)),
    'grip_l': ((-0.008, -0.010, -0.003), (0.50, -0.86, 0.0), (0.0, 0.0, 1.0)),
    'muzzle': (0.052, 0.012, 0.0),
}

# hand-held items (grenade, kits): held in the fist, the item's centre at the origin
FIST_R = ((-0.014, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, -1.0))
FIST_L = ((-0.014, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0))
